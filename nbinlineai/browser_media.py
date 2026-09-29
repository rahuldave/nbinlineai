"""Owned, volatile browser operations and media for one Jupyter Server process.

Authenticated handlers run on the server event loop; file saves also use worker
threads. Shared operation, quota, and lifecycle state is protected by one lock.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import mimetypes
import os
import secrets
import stat
import threading
import time
import weakref
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import wraps
from pathlib import Path, PurePosixPath
from typing import Any

from .browser_media_provenance import TRANSFORMS, validated_provenance

HEARTBEAT_SECONDS = 30
OWNER_LEASE_SECONDS = 90
PERMISSION_SECONDS = 120
MEDIA_IDLE_SECONDS = 600
STATUS_SECONDS = 300
MAX_NOTEBOOK_BYTES = 100 * 1024 * 1024
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_SERVER_BYTES = 256 * 1024 * 1024
MAX_RECORDS = 512
MAX_OWNERS = 64
MAX_IMAGE_PIXELS = 16_000_000
MAX_IMAGE_SIDE = 4096
MAX_BATCH_PIXELS = 32_000_000
MAX_STATUS_CHARS = 3_500
TERMINAL = frozenset({'completed', 'cancelled', 'failed', 'expired'})
STATES = TERMINAL | {'waiting_for_user', 'running', 'paused', 'saving'}


class MediaError(ValueError):
    """Safe API error with a stable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message[:500])
        self.code = code


def _locked(method):
    """Serialize short shared-state operations; never wrap slow file I/O."""
    @wraps(method)
    def call(self, *args, **kwargs):
        with self._state_lock:
            return method(self, *args, **kwargs)
    return call


@dataclass(frozen=True)
class Owner:
    session_id: str
    kernel_id: str
    notebook_path: str
    model_id: str
    client_id: str
    secret: str


@dataclass
class Operation:
    id: str
    owner: Owner
    request_id: str
    signature: str
    name: str
    notebook_path: str
    status: str
    created: float
    updated: float
    result: dict[str, Any] = field(default_factory=dict)
    error: dict[str, str] | None = None
    media_id: str | None = None
    saved_descriptor: dict[str, Any] | None = None
    deadline: float | None = None
    upload_signature: str | None = None
    batch_total: int | None = None
    batch_media_ids: list[str] = field(default_factory=list)
    batch_signatures: dict[int, str] = field(default_factory=dict)
    batch_pixels: int = 0
    batch_save_to: str | None = None
    batch_finished: bool = False
    batch_finishing: bool = False
    batch_done: threading.Event = field(default_factory=threading.Event, repr=False)
    cancelled: threading.Event = field(default_factory=threading.Event, repr=False)


@dataclass
class SaveFlight:
    signature: tuple[str, str]
    done: threading.Event = field(default_factory=threading.Event)
    result: dict[str, Any] | None = None
    error: Exception | None = None


@dataclass
class Media:
    id: str
    owner: Owner
    data: bytes
    mime_type: str
    sha256: str
    expires: float
    metadata: dict[str, Any] = field(default_factory=dict)
    path: str | None = None
    provenance: dict[str, Any] | None = None

    def descriptor(self) -> dict[str, Any]:
        return {'media_id': self.id, 'mime_type': self.mime_type,
                'bytes': len(self.data), 'sha256': self.sha256,
                'expires_at': self.expires, **self.metadata,
                **({'path': self.path} if self.path else {})}


class MediaRegistry:
    """Server-owned operation and byte store; never tied to a prompt lifetime."""

    def __init__(self, root: str | Path | None, clock=time.time):
        self.root = Path(root).resolve(strict=True) if root is not None else None
        root_flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
        self._root_fd = os.open(self.root, root_flags) if self.root is not None else None
        self._file_primitives = (hasattr(os, 'O_NOFOLLOW') and
                                 all(function in os.supports_dir_fd for function in
                                     (os.open, os.mkdir, os.unlink, os.link, os.stat)) and
                                 os.link in os.supports_follow_symlinks)
        if self._root_fd is not None:
            weakref.finalize(self, os.close, self._root_fd)
        self.clock = clock
        self.owners: dict[tuple[str, str], Owner] = {}
        self.leases: dict[Owner, float] = {}
        self.operations: dict[str, Operation] = {}
        self.requests: dict[tuple[Owner, str], str] = {}
        self.media: dict[str, Media] = {}
        self.inflight_bytes = 0
        self.inflight_by_session: dict[str, int] = {}
        self.save_requests: dict[tuple[Owner, str], tuple[str, str, dict[str, Any], float]] = {}
        self.save_flights: dict[tuple[Owner, str], SaveFlight] = {}
        self.reserved_save_bytes = 0
        self.reserved_save_by_session: dict[str, int] = {}
        self.owner_cancelled: dict[Owner, threading.Event] = {}
        self.current_paths: dict[Owner, str] = {}
        self._state_lock = threading.RLock()
        self._published_inodes: dict[str, tuple[int, int, int]] = {}
        self.recording_claims: dict[Owner, str] = {}
        # Serializes asynchronous session-path snapshots before recorder admission.
        self.recording_admission_lock = asyncio.Lock()

    def _now(self) -> float:
        return float(self.clock())

    def _transform_record(self, owner: Owner, op: Operation, metadata: dict[str, Any],
                          *, index: int | None = None, save_to: str | None | object = ...) -> dict[str, Any]:
        """Bind a derivative's claimed source hash to the frozen owned request."""
        try:
            kwargs = {'index': index}
            if save_to is not ...:
                kwargs['save_to'] = save_to
            record = validated_provenance(op.name, op.signature, metadata,
                                          metadata.get('source_sha256'), **kwargs)
            reference = json.loads(op.signature)[1]['media']
            if 'media_id' in reference:
                source = self.media_ref(owner, reference['media_id'])
                if source.sha256 != record['source_sha256']:
                    raise MediaError('stale_target', 'Source media changed')
            return record
        except MediaError:
            raise
        except (ValueError, TypeError, KeyError) as exc:
            raise MediaError('invalid_argument', str(exc)) from exc

    def _root_matches(self) -> bool:
        if self._root_fd is None or self.root is None:
            return False
        try:
            configured = os.stat(self.root)
            anchored = os.fstat(self._root_fd)
            return (configured.st_dev, configured.st_ino) == (anchored.st_dev, anchored.st_ino)
        except OSError:
            return False

    def file_media_supported(self) -> bool:
        """Report whether this filesystem has the primitives needed for anchored media I/O."""
        return bool(self._root_fd is not None and self._file_primitives and self._root_matches())

    def _admit_bytes(self, session_id: str, additional: int) -> None:
        """Check the combined resident, in-flight, and save-reserved budgets under lock."""
        resident = sum(len(media.data) for media in self.media.values())
        notebook_resident = sum(len(media.data) for media in self.media.values()
                                if media.owner.session_id == session_id)
        if (resident + self.inflight_bytes + self.reserved_save_bytes + additional > MAX_SERVER_BYTES or
                notebook_resident + self.inflight_by_session.get(session_id, 0) +
                self.reserved_save_by_session.get(session_id, 0) + additional > MAX_NOTEBOOK_BYTES):
            raise MediaError('limit_exceeded', 'Browser media memory limit exceeded')

    @_locked
    def reserve_ingress(self, owner: Owner, size: int) -> None:
        self.require(owner)
        self._admit_bytes(owner.session_id, size)
        self.inflight_bytes += size
        self.inflight_by_session[owner.session_id] = self.inflight_by_session.get(owner.session_id, 0) + size

    @_locked
    def release_ingress(self, owner: Owner, size: int) -> None:
        self.inflight_bytes -= size
        current = self.inflight_by_session.get(owner.session_id, 0) - size
        if current > 0:
            self.inflight_by_session[owner.session_id] = current
        else:
            self.inflight_by_session.pop(owner.session_id, None)

    @_locked
    def reserve_file_read(self, owner: Owner, size: int) -> None:
        self.require(owner)
        self._admit_bytes(owner.session_id, size)
        self.reserved_save_bytes += size
        self.reserved_save_by_session[owner.session_id] = (
            self.reserved_save_by_session.get(owner.session_id, 0) + size)

    @_locked
    def release_file_read(self, owner: Owner, size: int) -> None:
        self.reserved_save_bytes -= size
        remaining = self.reserved_save_by_session.get(owner.session_id, 0) - size
        if remaining > 0:
            self.reserved_save_by_session[owner.session_id] = remaining
        else:
            self.reserved_save_by_session.pop(owner.session_id, None)

    @_locked
    def bind(self, session_id: str, kernel_id: str, notebook_path: str, model_id: str,
             client_id: str, secret: str | None = None) -> Owner:
        if not all(isinstance(v, str) and v for v in (session_id, kernel_id, notebook_path, model_id, client_id)):
            raise MediaError('invalid_argument', 'Invalid notebook or browser binding')
        if len(client_id) > 100 or len(session_id) > 100 or len(kernel_id) > 100:
            raise MediaError('invalid_argument', 'Binding identifier is too long')
        self.sweep()
        key = (session_id, client_id)
        existing = self.owners.get(key)
        if existing is not None:
            if (existing.kernel_id != kernel_id or existing.model_id != model_id
                    or not secret or not secrets.compare_digest(existing.secret, secret)):
                raise MediaError('stale_target', 'Browser owner or notebook changed')
            self.leases[existing] = self._now() + OWNER_LEASE_SECONDS
            self.current_paths[existing] = notebook_path
            return existing
        if secret:
            raise MediaError('stale_target', 'Browser owner expired')
        if len(self.owners) >= MAX_OWNERS:
            raise MediaError('limit_exceeded', 'Too many browser owners')
        owner = Owner(session_id, kernel_id, notebook_path, model_id, client_id, secrets.token_urlsafe(32))
        self.owners[key] = owner
        self.owner_cancelled[owner] = threading.Event()
        self.current_paths[owner] = notebook_path
        self.leases[owner] = self._now() + OWNER_LEASE_SECONDS
        return owner

    @_locked
    def require(self, owner: Owner) -> None:
        self.sweep()
        if self.owners.get((owner.session_id, owner.client_id)) is not owner:
            raise MediaError('stale_target', 'Browser owner expired')
        if self.leases.get(owner, 0) <= self._now():
            self.expire_owner(owner)
            raise MediaError('stale_target', 'Browser owner expired')

    @_locked
    def heartbeat(self, owner: Owner) -> None:
        self.require(owner)
        self.leases[owner] = self._now() + OWNER_LEASE_SECONDS

    @_locked
    def close_owner(self, session_id: str, client_id: str, model_id: str, secret: str | None) -> None:
        """Revoke exactly one old owner without consulting its former live kernel."""
        if not all(isinstance(value, str) and value for value in
                   (session_id, client_id, model_id, secret)):
            raise MediaError('stale_target', 'Browser owner credential is unavailable')
        owner = self.owners.get((session_id, client_id))
        if (owner is None or owner.model_id != model_id or
                not secrets.compare_digest(owner.secret, secret)):
            raise MediaError('stale_target', 'Browser owner is unavailable')
        self.expire_owner(owner)

    @_locked
    def create(self, owner: Owner, request_id: str, name: str, arguments: dict[str, Any],
               *, waiting: bool = False) -> Operation:
        self.require(owner)
        if not isinstance(request_id, str) or not 0 < len(request_id) <= 100:
            raise MediaError('invalid_argument', 'Invalid request ID')
        if not isinstance(name, str) or not 0 < len(name) <= 100 or not isinstance(arguments, dict):
            raise MediaError('invalid_argument', 'Invalid operation')
        try:
            signature = json.dumps([name, arguments], sort_keys=True, separators=(',', ':'), allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise MediaError('invalid_argument', 'Invalid operation arguments') from exc
        if len(signature) > 16_000:
            raise MediaError('limit_exceeded', 'Operation arguments are too large')
        previous = self.requests.get((owner, request_id))
        if previous:
            operation = self.operations[previous]
            if operation.signature != signature:
                raise MediaError('invalid_argument', 'Request ID was reused with different arguments')
            return operation
        if len(self.operations) >= MAX_RECORDS:
            raise MediaError('limit_exceeded', 'Too many retained browser operations')
        now = self._now()
        operation = Operation(secrets.token_urlsafe(24), owner, request_id, signature,
                              name, self.current_paths.get(owner, owner.notebook_path),
                              'waiting_for_user' if waiting else 'running', now, now,
                              deadline=now + PERMISSION_SECONDS if waiting else None)
        self.operations[operation.id] = operation
        self.requests[(owner, request_id)] = operation.id
        return operation

    @_locked
    def operation(self, owner: Owner, operation_id: str) -> Operation:
        self.require(owner)
        op = self.operations.get(operation_id)
        if op is None or op.owner is not owner:
            raise MediaError('stale_target', 'Operation is unavailable')
        return op

    @_locked
    def recording_owners(self) -> tuple[Owner, ...]:
        """Snapshot claims for a fresh server-session lookup before admission."""
        self.sweep()
        return tuple(self.recording_claims)

    @_locked
    def claim_recording(self, owner: Owner, operation_id: str,
                        session_paths: dict[Owner, str] | None = None) -> dict[str, Any]:
        """Admit one recorder for the server's current canonical notebook path."""
        op = self.operation(owner, operation_id)
        if op.name not in {'start_recording', 'record_camera', 'record_microphone'} or op.status != 'running':
            raise MediaError('stale_target', 'Recording operation is unavailable')
        paths = session_paths if session_paths is not None else {}
        if session_paths is not None and any(claimed not in paths for claimed in self.recording_claims):
            raise MediaError('stale_target', 'Recording session path is unavailable')
        current_path = paths.get(owner, self.current_paths.get(owner, owner.notebook_path))
        if not isinstance(current_path, str) or not current_path:
            raise MediaError('stale_target', 'Notebook path is unavailable')
        for claimed_owner, claimed_operation in self.recording_claims.items():
            claimed_path = paths.get(claimed_owner)
            if claimed_path is None:
                # A caller with no fresh snapshot may safely use only the frozen
                # session identity; HTTP admission always supplies every path.
                claimed_path = self.current_paths.get(claimed_owner, claimed_owner.notebook_path)
            if claimed_path == current_path and (claimed_owner, claimed_operation) != (owner, operation_id):
                raise MediaError('busy', 'A recording is already active in this notebook')
            if claimed_owner.session_id == owner.session_id and claimed_operation != operation_id:
                raise MediaError('busy', 'A recording is already active in this notebook')
        self.current_paths.update(paths)
        self.recording_claims[owner] = operation_id
        return self.status(owner, operation_id)

    def _drop_recording(self, op: Operation) -> None:
        if self.recording_claims.get(op.owner) == op.id:
            self.recording_claims.pop(op.owner, None)

    @_locked
    def status(self, owner: Owner, operation_id: str) -> dict[str, Any]:
        op = self.operation(owner, operation_id)
        result: dict[str, Any] = {'operation_id': op.id, 'status': op.status}
        if op.result:
            result['result'] = op.result
        if op.error:
            result['error'] = op.error
        if op.media_id:
            media = self.media.get(op.media_id)
            if media:
                result['media'] = media.descriptor()
        if op.saved_descriptor is not None:
            result['media'] = op.saved_descriptor
        if op.batch_total is not None:
            descriptors = [self.media[media_id].descriptor() for media_id in op.batch_media_ids
                           if media_id in self.media]
            result['result'] = {**result.get('result', {}), 'media_count': len(descriptors),
                                'expected_count': op.batch_total}
            page, next_cursor = self._media_page(descriptors, 0, result)
            result['media'] = page
            if next_cursor is not None:
                result['next_media_cursor'] = next_cursor
        return result

    @staticmethod
    def _media_page(descriptors: list[dict[str, Any]], cursor: int,
                    base: dict[str, Any]) -> tuple[list[dict[str, Any]], int | None]:
        page: list[dict[str, Any]] = []
        for descriptor in descriptors[cursor:]:
            candidate = [*page, descriptor]
            if len(json.dumps({**base, 'media': candidate, 'next_media_cursor': cursor + len(candidate)})) > MAX_STATUS_CHARS:
                if not page:
                    raise MediaError('limit_exceeded', 'Media descriptor exceeds reply limit')
                break
            page = candidate
        next_cursor = cursor + len(page) if cursor + len(page) < len(descriptors) else None
        return page, next_cursor

    @_locked
    def media_page(self, owner: Owner, operation_id: str, cursor: int = 0) -> dict[str, Any]:
        op = self.operation(owner, operation_id)
        if op.batch_total is None or isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0:
            raise MediaError('invalid_argument', 'Invalid batch cursor')
        descriptors = [self.media[media_id].descriptor() for media_id in op.batch_media_ids
                       if media_id in self.media]
        page, next_cursor = self._media_page(descriptors, cursor, {})
        return {'media': page, 'next_media_cursor': next_cursor}

    @_locked
    def transition(self, owner: Owner, operation_id: str, status: str,
                   result: dict[str, Any] | None = None, error: dict[str, str] | None = None) -> dict[str, Any]:
        op = self.operation(owner, operation_id)
        if status not in STATES:
            raise MediaError('invalid_argument', 'Invalid operation status')
        if op.status in TERMINAL:
            if status == op.status:
                return self.status(owner, operation_id)
            raise MediaError('stale_target', 'Operation already ended')
        if result is not None:
            if not isinstance(result, dict) or len(json.dumps(result)) > 1500:
                raise MediaError('limit_exceeded', 'Operation result is too large')
            if {'media', 'path', 'sha256', 'bytes', 'media_id'} & result.keys():
                raise MediaError('invalid_argument', 'Operation result contains reserved media fields')
            op.result = result
        if error is not None:
            if not isinstance(error, dict) or len(json.dumps(error)) > 500:
                raise MediaError('invalid_argument', 'Invalid operation error')
            op.error = error
        permitted = {
            'waiting_for_user': {'running', 'cancelled', 'failed', 'expired'},
            'running': {'paused', 'saving', 'completed', 'cancelled', 'failed', 'expired'},
            'paused': {'running', 'saving', 'completed', 'cancelled', 'failed', 'expired'},
            'saving': {'completed', 'cancelled', 'failed', 'expired'},
        }
        if status not in permitted[op.status] and status != op.status:
            raise MediaError('invalid_argument', 'Invalid operation state transition')
        if status == 'completed' and not op.media_id and not op.result:
            raise MediaError('invalid_argument', 'Completed operation needs a result')
        op.status = status
        op.updated = self._now()
        op.deadline = None
        if status in TERMINAL:
            self._drop_recording(op)
        return self.status(owner, operation_id)

    def cancel(self, owner: Owner, operation_id: str) -> dict[str, Any]:
        with self._state_lock:
            op = self.operation(owner, operation_id)
            if op.status not in TERMINAL:
                op.cancelled.set()
                op.status = 'cancelled'
                op.error = {'code': 'cancelled', 'message': 'Operation cancelled'}
                op.updated = self._now()
                self._drop_recording(op)
                if op.media_id:
                    self.media.pop(op.media_id, None)
                for media_id in op.batch_media_ids:
                    self.media.pop(media_id, None)
            return self.status(owner, operation_id)

    def upload(self, owner: Owner, operation_id: str, data: bytes, mime_type: str,
               sha256: str, *, metadata: dict[str, Any] | None = None,
               save_to: str | None = None, defer_save: bool = False,
               ingress_credit: int = 0) -> dict[str, Any]:
        op = self.operation(owner, operation_id)
        if not isinstance(data, bytes) or not 0 < len(data) <= MAX_UPLOAD_BYTES:
            raise MediaError('limit_exceeded', 'Media size exceeds operation limit')
        digest = hashlib.sha256(data).hexdigest()
        if not isinstance(sha256, str) or not secrets.compare_digest(digest, sha256):
            raise MediaError('stale_target', 'Media hash mismatch')
        if not isinstance(mime_type, str) or not 0 < len(mime_type) <= 100:
            raise MediaError('invalid_argument', 'Invalid MIME type')
        mime_parts = mime_type.split(';', 1)
        base_mime = mime_parts[0].strip().lower()
        if '/' not in base_mime:
            raise MediaError('invalid_argument', 'Invalid MIME type')
        mime_type = base_mime + (';' + mime_parts[1].strip() if len(mime_parts) > 1 and mime_parts[1].strip() else '')
        if op.name in {'start_recording', 'record_camera', 'record_microphone'}:
            signatures = {
                'audio/webm': data.startswith(b'\x1a\x45\xdf\xa3'),
                'video/webm': data.startswith(b'\x1a\x45\xdf\xa3'),
                'audio/mp4': len(data) >= 12 and data[4:8] == b'ftyp',
                'video/mp4': len(data) >= 12 and data[4:8] == b'ftyp',
                'audio/ogg': data.startswith(b'OggS'),
            }
            if not signatures.get(base_mime, False):
                raise MediaError('invalid_argument', 'Encoded recording MIME does not match its container')
        if mime_type.startswith(('audio/', 'video/')) and save_to is None and len(data) > 16 * 1024 * 1024:
            raise MediaError('limit_exceeded', 'In-memory recording exceeds 16 MiB')
        if metadata is None:
            metadata = {}
        if not isinstance(metadata, dict) or len(json.dumps(metadata)) > 1000:
            raise MediaError('invalid_argument', 'Invalid media metadata')
        allowed_metadata = {'duration_seconds', 'stop_reason', 'source_sha256', 'transform'}
        if set(metadata) - allowed_metadata:
            raise MediaError('invalid_argument', 'Media metadata has unsupported fields')
        duration = metadata.get('duration_seconds')
        if duration is not None and (isinstance(duration, bool) or not isinstance(duration, (int, float))
                                     or not 0 <= duration <= 300):
            raise MediaError('invalid_argument', 'Invalid media duration')
        if (mime_type.startswith(('audio/', 'video/')) and duration is not None and
                save_to is None and duration > 60):
            raise MediaError('limit_exceeded', 'In-memory recording exceeds 60 seconds')
        if 'stop_reason' in metadata and metadata['stop_reason'] not in {'user', 'duration', 'size', 'source_ended'}:
            raise MediaError('invalid_argument', 'Invalid recording stop reason')
        for key in ('source_sha256', 'transform'):
            if key in metadata and (not isinstance(metadata[key], str) or len(metadata[key]) > 100):
                raise MediaError('invalid_argument', 'Invalid media provenance')
        declared_metadata = metadata.copy()
        if mime_type.startswith('image/') and mime_type != 'image/svg+xml':
            try:
                from PIL import Image
                with Image.open(io.BytesIO(data)) as image:
                    width, height = image.size
                    if (width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE
                            or width * height > MAX_IMAGE_PIXELS):
                        raise MediaError('limit_exceeded', 'Image exceeds pixel limits')
                    image.verify()
                    detected = Image.MIME.get(image.format)
                    if detected != mime_type:
                        raise MediaError('invalid_argument', 'Encoded image MIME does not match bytes')
                    metadata = {**metadata, 'width': width, 'height': height}
            except MediaError:
                raise
            except Exception as exc:
                raise MediaError('invalid_argument', 'Encoded image is invalid') from exc
        upload_signature = json.dumps([digest, mime_type, len(data), save_to, metadata],
                                      sort_keys=True, separators=(',', ':'))
        with self._state_lock:
            self.require(owner)
            if (not 0 <= ingress_credit <= len(data) or
                    ingress_credit > self.inflight_by_session.get(owner.session_id, 0)):
                raise MediaError('invalid_argument', 'Invalid upload reservation')
            if op.upload_signature is not None:
                if op.upload_signature != upload_signature:
                    raise MediaError('invalid_argument', 'Upload payload changed under the same operation')
                return self.status(owner, operation_id)
            if op.status in TERMINAL:
                raise MediaError('stale_target', 'Operation already ended')
            if op.batch_total is not None:
                raise MediaError('invalid_argument', 'Batch operations require upload_part')
            provenance = None
            if op.name in TRANSFORMS:
                if op.name == 'extract_frames' or mime_type != 'image/png':
                    raise MediaError('invalid_argument', 'Single derivative needs a PNG crop or annotation')
                provenance = self._transform_record(owner, op, declared_metadata, save_to=save_to)
            self._admit_bytes(owner.session_id, len(data) - ingress_credit)
            media = Media(secrets.token_urlsafe(24), owner, data, mime_type, digest,
                          self._now() + MEDIA_IDLE_SECONDS, metadata, provenance=provenance)
            self.media[media.id] = media
            op.media_id = media.id
            op.upload_signature = upload_signature
            if save_to is not None:
                op.status = 'saving'
            else:
                op.status = 'completed'
                self._drop_recording(op)
            op.updated = self._now()
        if save_to is not None and not defer_save:
            path: str | None = None
            sidecar: str | None = None
            try:
                owner_cancelled = self.owner_cancelled.get(owner)
                path, sidecar = self._save_with_provenance(
                    owner, media, save_to,
                    lambda: not op.cancelled.is_set() and owner_cancelled is not None and
                    not owner_cancelled.is_set(), notebook_path=op.notebook_path)
                with self._state_lock:
                    if op.cancelled.is_set() or owner_cancelled is None or owner_cancelled.is_set():
                        raise MediaError('cancelled', 'Media save was cancelled')
                    media.path = path
                    if sidecar is not None:
                        media.metadata['sidecar_path'] = sidecar
                    if op.status not in TERMINAL:
                        op.status = 'completed'
                        op.updated = self._now()
                        self._drop_recording(op)
                    self._forget_saved(path)
                    if sidecar is not None:
                        self._forget_saved(sidecar)
            except Exception:
                if path is not None:
                    self._unlink_saved(path)
                if sidecar is not None:
                    self._unlink_saved(sidecar)
                with self._state_lock:
                    self.media.pop(media.id, None)
                    op.media_id = None
                    if op.status not in TERMINAL:
                        op.status = 'failed'
                        op.error = {'code': 'save_failed', 'message': 'Media could not be saved'}
                        op.updated = self._now()
                        self._drop_recording(op)
                raise
        return self.status(owner, operation_id)

    @_locked
    def begin_batch(self, owner: Owner, operation_id: str, total: int) -> dict[str, Any]:
        op = self.operation(owner, operation_id)
        if isinstance(total, bool) or not isinstance(total, int) or not 1 <= total <= 12:
            raise MediaError('invalid_argument', 'Batch size must be 1 through 12')
        if op.name in TRANSFORMS and op.name != 'extract_frames':
            raise MediaError('invalid_argument', 'Only frame extraction accepts a batch')
        if op.name == 'extract_frames':
            try:
                requested = json.loads(op.signature)[1]['timestamps']
            except (TypeError, ValueError, KeyError, IndexError) as exc:
                raise MediaError('invalid_argument', 'Invalid frame request') from exc
            if not isinstance(requested, list) or len(requested) != total:
                raise MediaError('invalid_argument', 'Frame count differs from frozen request')
        if op.status in TERMINAL or op.media_id:
            raise MediaError('stale_target', 'Operation already has a result')
        if op.batch_total is not None and op.batch_total != total:
            raise MediaError('invalid_argument', 'Batch size changed')
        op.batch_total = total
        return self.status(owner, operation_id)

    def upload_part(self, owner: Owner, operation_id: str, index: int, data: bytes,
                    mime_type: str, sha256: str, metadata: dict[str, Any] | None = None,
                    ingress_credit: int = 0) -> dict[str, Any]:
        op = self.operation(owner, operation_id)
        if op.batch_total is None:
            raise MediaError('stale_target', 'Batch operation is unavailable')
        if not isinstance(data, bytes) or not 0 < len(data) <= MAX_UPLOAD_BYTES:
            raise MediaError('limit_exceeded', 'Batch part exceeds its bounds')
        digest = hashlib.sha256(data).hexdigest()
        if digest != sha256:
            raise MediaError('stale_target', 'Batch media hash mismatch')
        if not isinstance(mime_type, str) or not 0 < len(mime_type) <= 100 or '/' not in mime_type:
            raise MediaError('invalid_argument', 'Batch part has invalid MIME type')
        if metadata is None:
            metadata = {}
        if not isinstance(metadata, dict) or len(json.dumps(metadata)) > 1000:
            raise MediaError('invalid_argument', 'Invalid batch metadata')
        if op.name == 'extract_frames':
            if mime_type != 'image/png':
                raise MediaError('invalid_argument', 'Decoded frames must be PNG images')
            provenance = self._transform_record(owner, op, metadata, index=index)
        else:
            if metadata:
                raise MediaError('invalid_argument', 'Batch metadata is only supported for decoded frames')
            provenance = None
        signature = json.dumps([digest, mime_type, len(data), metadata], separators=(',', ':'))
        with self._state_lock:
            if index in op.batch_signatures:
                if op.batch_signatures[index] == signature:
                    return self.status(owner, operation_id)
                raise MediaError('invalid_argument', 'Batch part changed under the same index')
        width = height = 0
        if mime_type.startswith('image/') and mime_type != 'image/svg+xml':
            from PIL import Image
            try:
                with Image.open(io.BytesIO(data)) as image:
                    width, height = image.size
                    if width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS:
                        raise MediaError('limit_exceeded', 'Image exceeds pixel limits')
                    image.verify()
                    if Image.MIME.get(image.format) != mime_type:
                        raise MediaError('invalid_argument', 'Encoded image MIME does not match bytes')
            except MediaError:
                raise
            except Exception as exc:
                raise MediaError('invalid_argument', 'Encoded image is invalid') from exc
        with self._state_lock:
            self.require(owner)
            if (not 0 <= ingress_credit <= len(data) or
                    ingress_credit > self.inflight_by_session.get(owner.session_id, 0)):
                raise MediaError('invalid_argument', 'Invalid upload reservation')
            if isinstance(index, bool) or not isinstance(index, int) or index != len(op.batch_media_ids):
                if index in op.batch_signatures:
                    if op.batch_signatures[index] == signature:
                        return self.status(owner, operation_id)
                    raise MediaError('invalid_argument', 'Batch part changed under the same index')
                raise MediaError('invalid_argument', 'Batch parts must arrive in order')
            if op.status in TERMINAL:
                raise MediaError('stale_target', 'Batch operation is unavailable')
            if index >= op.batch_total:
                raise MediaError('limit_exceeded', 'Batch part exceeds its bounds')
            if op.batch_pixels + width * height > MAX_BATCH_PIXELS:
                raise MediaError('limit_exceeded', 'Batch exceeds decoded-pixel limit')
            if op.name == 'extract_frames':
                # Pixel verification runs outside this lock. The source may have
                # been released while PIL inspected the encoded part.
                provenance = self._transform_record(owner, op, metadata, index=index)
            self._admit_bytes(owner.session_id, len(data) - ingress_credit)
            media = Media(secrets.token_urlsafe(24), owner, data, mime_type, digest,
                          self._now() + MEDIA_IDLE_SECONDS,
                          {**metadata, **({'width': width, 'height': height} if width and height else {})},
                          provenance=provenance)
            self.media[media.id] = media
            op.batch_media_ids.append(media.id)
            op.batch_signatures[index] = signature
            op.batch_pixels += width * height
            op.updated = self._now()
            return self.status(owner, operation_id)

    def finish_batch(self, owner: Owner, operation_id: str, save_to: str | None = None) -> dict[str, Any]:
        with self._state_lock:
            op = self.operation(owner, operation_id)
            if op.name == 'extract_frames':
                try:
                    requested_save = json.loads(op.signature)[1]['save_to']
                except (TypeError, ValueError, KeyError, IndexError) as exc:
                    raise MediaError('invalid_argument', 'Invalid frame request') from exc
                if requested_save != save_to:
                    raise MediaError('invalid_argument', 'Frame destination differs from frozen request')
            if op.batch_finished and op.batch_save_to != save_to:
                raise MediaError('invalid_argument', 'Batch destination changed')
            if op.batch_total is None or len(op.batch_media_ids) != op.batch_total:
                raise MediaError('invalid_argument', 'Batch is incomplete')
            if op.status in TERMINAL:
                return self.status(owner, operation_id)
            if op.batch_finishing:
                wait_for_first = True
            else:
                wait_for_first = False
                op.batch_finished = True
                op.batch_finishing = True
                op.batch_save_to = save_to
                if save_to is not None:
                    op.status = 'saving'
            owner_cancelled = self.owner_cancelled.get(owner)
            batch_media = [self.media[media_id] for media_id in op.batch_media_ids]
        if wait_for_first:
            op.batch_done.wait()
            return self.status(owner, operation_id)
        saved: list[str] = []
        committed = False
        try:
            if save_to is not None:
                batch_directory = save_to
                if op.name == 'extract_frames' and save_to == 'auto':
                    batch_directory = (PurePosixPath(op.notebook_path).parent / 'media' /
                                       f'frames-{op.id[:16]}').as_posix()
                for index, media in enumerate(batch_media):
                    extension = mimetypes.guess_extension(media.mime_type) or '.bin'
                    destination = ('auto' if save_to == 'auto' and op.name != 'extract_frames' else
                                   f'{batch_directory.rstrip("/")}/part-{index + 1:02d}{extension}')
                    path, sidecar = self._save_with_provenance(
                        owner, media, destination,
                        lambda: not op.cancelled.is_set() and
                        owner_cancelled is not None and not owner_cancelled.is_set(),
                        notebook_path=op.notebook_path)
                    saved.append(path)
                    if sidecar is not None:
                        saved.append(sidecar)
                        media.metadata['sidecar_path'] = sidecar
                    media.path = path
            with self._state_lock:
                if op.cancelled.is_set() or owner_cancelled is None or owner_cancelled.is_set():
                    raise MediaError('cancelled', 'Batch finalization was cancelled')
                op.status = 'completed'
                op.updated = self._now()
                committed = True
                for path in saved:
                    self._forget_saved(path)
            return self.status(owner, operation_id)
        except Exception:
            if not committed:
                for path in saved:
                    self._unlink_saved(path)
                with self._state_lock:
                    for media_id in op.batch_media_ids:
                        self.media.pop(media_id, None)
                    if op.status not in TERMINAL:
                        op.status = 'failed'
                        op.error = {'code': 'save_failed', 'message': 'Batch media could not be saved'}
                        op.updated = self._now()
            raise
        finally:
            with self._state_lock:
                op.batch_finishing = False
                op.batch_done.set()

    @_locked
    def _unlink_saved(self, relative: str) -> None:
        """Roll back only the created inode in its original anchored directory."""
        published = self._published_inodes.pop(relative, None)
        if published is None:
            return
        directory_fd, device, inode = published
        posix = PurePosixPath(relative)
        try:
            current = os.stat(posix.name, dir_fd=directory_fd, follow_symlinks=False)
            if (current.st_dev, current.st_ino) == (device, inode):
                os.unlink(posix.name, dir_fd=directory_fd)
        except OSError:
            pass
        finally:
            os.close(directory_fd)

    @_locked
    def _forget_saved(self, relative: str) -> None:
        published = self._published_inodes.pop(relative, None)
        if published is not None:
            os.close(published[0])

    def _destination(self, owner: Owner, save_to: str, mime_type: str,
                     notebook_path: str | None = None) -> Path:
        if self.root is None:
            raise MediaError('unsupported', 'This Jupyter contents backend cannot save browser media')
        if not isinstance(save_to, str) or not save_to:
            raise MediaError('invalid_argument', 'save_to must name a destination')
        if len(save_to) > 500:
            raise MediaError('limit_exceeded', 'save_to is too long')
        notebook_dir = PurePosixPath(notebook_path or owner.notebook_path).parent
        base_mime = mime_type.split(';', 1)[0].strip().lower()
        recording_suffixes = {
            'audio/webm': ('.weba', '.webm'), 'video/webm': ('.webm',),
            'audio/mp4': ('.m4a', '.mp4'), 'video/mp4': ('.mp4',),
            'audio/ogg': ('.ogg',),
        }
        data_suffixes = {
            'application/vnd.dataresource+json': ('.json',),
            'application/json': ('.json',), 'text/plain': ('.txt',),
            'text/markdown': ('.md', '.markdown'),
        }
        suffix = (recording_suffixes[base_mime][0] if base_mime in recording_suffixes else
                  data_suffixes[base_mime][0] if base_mime in data_suffixes else
                  mimetypes.guess_extension(base_mime) or '.bin')
        if save_to == 'auto':
            relative = notebook_dir / 'media' / f'capture-{secrets.token_hex(8)}{suffix}'
        else:
            relative = PurePosixPath(save_to)
            if relative.is_absolute() or '..' in relative.parts or '\\' in save_to:
                raise MediaError('invalid_argument', 'save_to must be inside the server root')
            guessed, _ = mimetypes.guess_type(relative.name)
            allowed_suffixes = recording_suffixes.get(base_mime, data_suffixes.get(base_mime))
            if (relative.suffix.lower() not in allowed_suffixes
                    if allowed_suffixes else guessed != base_mime):
                raise MediaError('invalid_argument', 'Destination extension does not match media MIME')
        path = self.root.joinpath(*relative.parts)
        if len(relative.as_posix()) > 500:
            raise MediaError('limit_exceeded', 'Saved media path is too long')
        if not path.resolve(strict=False).is_relative_to(self.root):
            raise MediaError('invalid_argument', 'save_to escapes the server root')
        return path

    def _save(self, owner: Owner, media: Media, save_to: str,
              still_active=lambda: True, *, notebook_path: str | None = None) -> str:
        if self._root_fd is None:
            raise MediaError('unsupported', 'This server has no supported filesystem media root')
        if not self._root_matches():
            raise MediaError('stale_target', 'Configured media root changed')
        if not self.file_media_supported():
            raise MediaError('unsupported', 'This server filesystem cannot safely save browser media')
        path = self._destination(owner, save_to, media.mime_type, notebook_path)
        relative = path.relative_to(self.root)
        # Walk anchored directory descriptors on POSIX: a symlink swap cannot
        # redirect the final create outside the root after validation.
        dir_flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
        directory_fd = os.dup(self._root_fd)
        try:
            for component in relative.parts[:-1]:
                try:
                    os.mkdir(component, 0o700, dir_fd=directory_fd)
                except FileExistsError:
                    pass
                next_fd = os.open(component, dir_flags, dir_fd=directory_fd)
                os.close(directory_fd)
                directory_fd = next_fd
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
            temporary = f'.nbinlineai-{secrets.token_hex(12)}.part'
            try:
                fd = os.open(temporary, flags, 0o600, dir_fd=directory_fd)
            except OSError as exc:
                raise MediaError('save_failed', 'Could not create temporary media file') from exc
            published = False
            try:
                with os.fdopen(fd, 'wb') as stream:
                    for start in range(0, len(media.data), 1024 * 1024):
                        if not still_active():
                            raise MediaError('cancelled', 'Save was cancelled')
                        stream.write(media.data[start:start + 1024 * 1024])
                    created = os.fstat(stream.fileno())
                if not still_active():
                    raise MediaError('cancelled', 'Save was cancelled')
                anchor_fd = os.dup(directory_fd)
                try:
                    os.link(temporary, relative.name, src_dir_fd=directory_fd,
                            dst_dir_fd=directory_fd, follow_symlinks=False)
                except FileExistsError as exc:
                    os.close(anchor_fd)
                    raise MediaError('path_conflict', 'Destination already exists') from exc
                except Exception:
                    os.close(anchor_fd)
                    raise
                with self._state_lock:
                    self._published_inodes[relative.as_posix()] = (anchor_fd, created.st_dev, created.st_ino)
                published = True
                if not still_active() or not self._root_matches():
                    raise MediaError('cancelled', 'Save was cancelled or its root changed')
            finally:
                try:
                    os.unlink(temporary, dir_fd=directory_fd)
                except OSError:
                    try:
                        os.unlink(temporary, dir_fd=directory_fd)
                    except OSError:
                        pass
                    if published:
                        self._unlink_saved(relative.as_posix())
                    raise
                if published and (not still_active() or not self._root_matches()):
                    self._unlink_saved(relative.as_posix())
                    raise MediaError('cancelled', 'Save was cancelled or its root changed')
        except (OSError, NotImplementedError) as exc:
            raise MediaError('save_failed', 'Filesystem cannot safely save this path') from exc
        finally:
            os.close(directory_fd)
        return relative.as_posix()

    def _save_with_provenance(self, owner: Owner, media: Media, save_to: str,
                              still_active=lambda: True, *,
                              notebook_path: str | None = None) -> tuple[str, str | None]:
        """Publish a derivative last, after its exclusive anchored JSON sidecar."""
        if media.provenance is None:
            return self._save(owner, media, save_to, still_active,
                              notebook_path=notebook_path), None
        destination = self._destination(owner, save_to, media.mime_type, notebook_path)
        relative = destination.relative_to(self.root).as_posix()
        sidecar_path = f'{relative}.json'
        record = {**media.provenance, 'output_sha256': media.sha256,
                  'output_mime_type': media.mime_type, 'output_bytes': len(media.data)}
        data = (json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode('utf-8')
        if len(data) > 16_384:
            raise MediaError('limit_exceeded', 'Transformation sidecar exceeds its bound')
        sidecar = Media('', owner, data, 'application/json', hashlib.sha256(data).hexdigest(),
                        self._now() + MEDIA_IDLE_SECONDS)
        saved_sidecar: str | None = None
        try:
            saved_sidecar = self._save(owner, sidecar, sidecar_path, still_active,
                                       notebook_path=notebook_path)
            saved_media = self._save(owner, media, relative, still_active,
                                     notebook_path=notebook_path)
            return saved_media, saved_sidecar
        except Exception:
            if saved_sidecar is not None:
                self._unlink_saved(saved_sidecar)
            raise

    @_locked
    def media_ref(self, owner: Owner, media_id: str, *, consume: bool = False) -> Media:
        self.require(owner)
        media = self.media.get(media_id)
        if media is None or media.owner is not owner:
            raise MediaError('stale_target', 'Media reference expired')
        if consume:
            media.expires = self._now() + MEDIA_IDLE_SECONDS
        return media

    def resolve_ref(self, owner: Owner, reference: dict[str, Any],
                    reserve: Callable[[int], None] | None = None) -> tuple[bytes, str, str]:
        """Read exact owned memory or server-root file bytes for a downstream family."""
        self.require(owner)
        if not isinstance(reference, dict):
            raise MediaError('invalid_argument', 'MediaRef must be an object')
        if set(reference) == {'media_id'}:
            media = self.media_ref(owner, reference['media_id'], consume=True)
            return media.data, media.mime_type, media.sha256
        if set(reference) != {'path', 'sha256'}:
            raise MediaError('invalid_argument', 'MediaRef needs a media_id or exact path and hash')
        if self._root_fd is None:
            raise MediaError('unsupported', 'This server has no supported filesystem media root')
        if not self._root_matches():
            raise MediaError('stale_target', 'Configured media root changed')
        if not self.file_media_supported():
            raise MediaError('unsupported', 'This server filesystem cannot safely read saved media')
        relative = reference['path']
        expected = reference['sha256']
        if (not isinstance(relative, str) or not 0 < len(relative) <= 500 or
                not isinstance(expected, str) or len(expected) != 64):
            raise MediaError('invalid_argument', 'Invalid saved media reference')
        posix = PurePosixPath(relative)
        if posix.is_absolute() or '..' in posix.parts or '\\' in relative:
            raise MediaError('invalid_argument', 'Saved media path escapes the server root')
        flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
        directory_fd = os.dup(self._root_fd)
        try:
            for part in posix.parts[:-1]:
                next_fd = os.open(part, flags, dir_fd=directory_fd)
                os.close(directory_fd)
                directory_fd = next_fd
            file_fd = os.open(posix.name, os.O_RDONLY | os.O_NONBLOCK |
                              getattr(os, 'O_NOFOLLOW', 0), dir_fd=directory_fd)
            with os.fdopen(file_fd, 'rb') as stream:
                file_stat = os.fstat(stream.fileno())
                if not stat.S_ISREG(file_stat.st_mode):
                    raise MediaError('unsupported', 'MediaRef must be a regular file')
                if file_stat.st_size > MAX_UPLOAD_BYTES:
                    raise MediaError('limit_exceeded', 'Saved media exceeds 50 MiB')
                if reserve is not None:
                    reserve(file_stat.st_size)
                data = stream.read(file_stat.st_size + 1)
        except OSError as exc:
            raise MediaError('stale_target', 'Saved media file is unavailable') from exc
        finally:
            os.close(directory_fd)
        if not self._root_matches():
            raise MediaError('stale_target', 'Configured media root changed')
        if len(data) != file_stat.st_size:
            raise MediaError('stale_target', 'Saved media file changed during reading')
        actual = hashlib.sha256(data).hexdigest()
        if not secrets.compare_digest(actual, expected):
            raise MediaError('stale_target', 'Saved media hash changed')
        mime_type = mimetypes.guess_type(posix.name)[0] or 'application/octet-stream'
        return data, mime_type, actual

    def save_media(self, owner: Owner, reference: dict[str, Any] | str, save_to: str = 'auto',
                   request_id: str | None = None) -> dict[str, Any]:
        if not isinstance(request_id, str) or not 0 < len(request_id) <= 100:
            raise MediaError('invalid_argument', 'save_media needs a request ID')
        if isinstance(reference, str):
            reference = {'media_id': reference}
        if not isinstance(reference, dict) or set(reference) not in ({'media_id'}, {'path', 'sha256'}):
            raise MediaError('invalid_argument', 'save_media needs an exact MediaRef')
        if 'media_id' in reference and (not isinstance(reference['media_id'], str) or
                                        not 0 < len(reference['media_id']) <= 100):
            raise MediaError('invalid_argument', 'Invalid media_id')
        signature = json.dumps(reference, sort_keys=True, separators=(',', ':'))
        key = (owner, request_id)
        with self._state_lock:
            self.require(owner)
            previous = self.save_requests.get(key)
            if previous:
                if previous[:2] != (signature, save_to):
                    raise MediaError('invalid_argument', 'Save request ID was reused with different arguments')
                return previous[2]
            op_id = self.requests.get(key)
            operation = self.operations.get(op_id) if op_id else None
            if operation is not None and operation.name == 'save_media' and operation.status in TERMINAL:
                raise MediaError('stale_target', 'Save operation already ended')
            flight = self.save_flights.get(key)
            if flight:
                if flight.signature != (signature, save_to):
                    raise MediaError('invalid_argument', 'Save request ID was reused with different arguments')
                wait_for_first = True
            else:
                if len(self.save_requests) + len(self.save_flights) >= MAX_RECORDS:
                    raise MediaError('limit_exceeded', 'Too many retained save requests')
                flight = SaveFlight((signature, save_to))
                self.save_flights[key] = flight
                wait_for_first = False
            owner_cancelled = self.owner_cancelled.get(owner)
            request_path = (operation.notebook_path if operation is not None
                            else self.current_paths.get(owner, owner.notebook_path))
        if wait_for_first:
            flight.done.wait()
            if flight.error is not None:
                raise flight.error
            assert flight.result is not None
            return flight.result
        reserved = 0
        path: str | None = None
        sidecar: str | None = None
        try:
            new_media = 'path' in reference
            if new_media:
                def reserve_file(size: int) -> None:
                    nonlocal reserved
                    self.reserve_file_read(owner, size)
                    reserved = size

                data, mime_type, sha256 = self.resolve_ref(owner, reference, reserve_file)
                media = Media(secrets.token_hex(16), owner, data, mime_type, sha256,
                              self._now() + MEDIA_IDLE_SECONDS)
            else:
                media = self.media_ref(owner, reference['media_id'], consume=True)
            active = lambda: (owner_cancelled is not None and not owner_cancelled.is_set() and
                              (operation is None or (operation.status == 'saving' and
                                                     not operation.cancelled.is_set())) and
                              (new_media or self.media.get(media.id) is media))
            path, sidecar = self._save_with_provenance(owner, media, save_to, active,
                                                      notebook_path=request_path)
            with self._state_lock:
                if not active():
                    raise MediaError('cancelled', 'Media save lost its owner or source')
                if new_media:
                    self.release_file_read(owner, reserved)
                    reserved = 0
                    media.path = path
                    self.media[media.id] = media
                if sidecar is not None:
                    media.metadata['sidecar_path'] = sidecar
                descriptor = {**media.descriptor(), 'path': path}
                if operation is not None:
                    operation.saved_descriptor = descriptor
                    operation.status = 'completed'
                    operation.updated = self._now()
                self.save_requests[key] = (signature, save_to, descriptor, self._now())
                flight.result = descriptor
                self._forget_saved(path)
                if sidecar is not None:
                    self._forget_saved(sidecar)
            return descriptor
        except Exception as exc:
            if path is not None:
                self._unlink_saved(path)
            if sidecar is not None:
                self._unlink_saved(sidecar)
            with self._state_lock:
                if operation is not None and operation.status not in TERMINAL:
                    operation.status = 'failed'
                    operation.error = {'code': exc.code if isinstance(exc, MediaError) else 'save_failed',
                                       'message': str(exc)[:300] if isinstance(exc, MediaError) else 'Media save failed'}
                    operation.updated = self._now()
                flight.error = exc
            raise
        finally:
            with self._state_lock:
                if reserved:
                    self.release_file_read(owner, reserved)
                self.save_flights.pop(key, None)
                flight.done.set()

    @_locked
    def release_media(self, owner: Owner, media_id: str) -> None:
        with self._state_lock:
            self.media_ref(owner, media_id)
            self.media.pop(media_id, None)

    @_locked
    def expire_owner(self, owner: Owner) -> None:
        self.owner_cancelled.pop(owner, threading.Event()).set()
        self.current_paths.pop(owner, None)
        self.owners.pop((owner.session_id, owner.client_id), None)
        self.leases.pop(owner, None)
        for op in self.operations.values():
            if op.owner is owner and op.status not in TERMINAL:
                op.cancelled.set()
                op.status = 'expired'
                op.error = {'code': 'stale_target', 'message': 'Browser owner disconnected'}
                op.updated = self._now()
                self._drop_recording(op)
        for media_id, media in list(self.media.items()):
            if media.owner is owner:
                self.media.pop(media_id, None)
        for key in list(self.save_requests):
            if key[0] is owner:
                self.save_requests.pop(key, None)

    @_locked
    def sweep(self) -> None:
        now = self._now()
        for owner, expiry in list(self.leases.items()):
            if expiry <= now:
                self.expire_owner(owner)
        for op in self.operations.values():
            if op.deadline is not None and op.deadline <= now and op.status == 'waiting_for_user':
                op.status = 'expired'
                op.error = {'code': 'timeout', 'message': 'Permission request timed out'}
                op.updated = now
                self._drop_recording(op)
        for media_id, media in list(self.media.items()):
            if media.expires <= now:
                self.media.pop(media_id, None)
        for op_id, op in list(self.operations.items()):
            if op.status in TERMINAL and op.updated + STATUS_SECONDS <= now:
                self.operations.pop(op_id, None)
                self.requests.pop((op.owner, op.request_id), None)
        for key, record in list(self.save_requests.items()):
            if record[3] + STATUS_SECONDS <= now:
                self.save_requests.pop(key, None)

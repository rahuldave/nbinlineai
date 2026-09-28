"""Owned, volatile browser operations and media for one Jupyter Server process.

All methods run on the server event loop. The caller authenticates the Jupyter
session and supplies an owner secret retained only by its browser tab.
"""

from __future__ import annotations

import hashlib
import io
import json
import mimetypes
import os
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

HEARTBEAT_SECONDS = 30
OWNER_LEASE_SECONDS = 90
PERMISSION_SECONDS = 120
MEDIA_IDLE_SECONDS = 600
STATUS_SECONDS = 300
MAX_NOTEBOOK_BYTES = 100 * 1024 * 1024
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_RECORDS = 512
MAX_OWNERS = 64
MAX_IMAGE_PIXELS = 16_000_000
MAX_IMAGE_SIDE = 4096
TERMINAL = frozenset({'completed', 'cancelled', 'failed', 'expired'})
STATES = TERMINAL | {'waiting_for_user', 'running', 'paused', 'saving'}


class MediaError(ValueError):
    """Safe API error with a stable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message[:500])
        self.code = code


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
    status: str
    created: float
    updated: float
    result: dict[str, Any] = field(default_factory=dict)
    error: dict[str, str] | None = None
    media_id: str | None = None
    deadline: float | None = None


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

    def descriptor(self) -> dict[str, Any]:
        return {'media_id': self.id, 'mime_type': self.mime_type,
                'bytes': len(self.data), 'sha256': self.sha256,
                'expires_at': self.expires, **self.metadata,
                **({'path': self.path} if self.path else {})}


class MediaRegistry:
    """Server-owned operation and byte store; never tied to a prompt lifetime."""

    def __init__(self, root: str | Path | None, clock=time.time):
        self.root = Path(root).resolve(strict=True) if root is not None else None
        self.clock = clock
        self.owners: dict[tuple[str, str], Owner] = {}
        self.leases: dict[Owner, float] = {}
        self.operations: dict[str, Operation] = {}
        self.requests: dict[tuple[Owner, str], str] = {}
        self.media: dict[str, Media] = {}

    def _now(self) -> float:
        return float(self.clock())

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
            return existing
        if secret:
            raise MediaError('stale_target', 'Browser owner expired')
        if len(self.owners) >= MAX_OWNERS:
            raise MediaError('limit_exceeded', 'Too many browser owners')
        owner = Owner(session_id, kernel_id, notebook_path, model_id, client_id, secrets.token_urlsafe(32))
        self.owners[key] = owner
        self.leases[owner] = self._now() + OWNER_LEASE_SECONDS
        return owner

    def require(self, owner: Owner) -> None:
        self.sweep()
        if self.owners.get((owner.session_id, owner.client_id)) is not owner:
            raise MediaError('stale_target', 'Browser owner expired')
        if self.leases.get(owner, 0) <= self._now():
            self.expire_owner(owner)
            raise MediaError('stale_target', 'Browser owner expired')

    def heartbeat(self, owner: Owner) -> None:
        self.require(owner)
        self.leases[owner] = self._now() + OWNER_LEASE_SECONDS

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
                              name, 'waiting_for_user' if waiting else 'running', now, now,
                              deadline=now + PERMISSION_SECONDS if waiting else None)
        self.operations[operation.id] = operation
        self.requests[(owner, request_id)] = operation.id
        return operation

    def operation(self, owner: Owner, operation_id: str) -> Operation:
        self.require(owner)
        op = self.operations.get(operation_id)
        if op is None or op.owner is not owner:
            raise MediaError('stale_target', 'Operation is unavailable')
        return op

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
        return result

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
            if not isinstance(result, dict) or len(json.dumps(result)) > 2800:
                raise MediaError('limit_exceeded', 'Operation result is too large')
            op.result = result
        if error is not None:
            if not isinstance(error, dict) or len(json.dumps(error)) > 500:
                raise MediaError('invalid_argument', 'Invalid operation error')
            op.error = error
        op.status = status
        op.updated = self._now()
        op.deadline = None
        return self.status(owner, operation_id)

    def cancel(self, owner: Owner, operation_id: str) -> dict[str, Any]:
        op = self.operation(owner, operation_id)
        if op.status not in TERMINAL:
            op.status = 'cancelled'
            op.error = {'code': 'cancelled', 'message': 'Operation cancelled'}
            op.updated = self._now()
        return self.status(owner, operation_id)

    def upload(self, owner: Owner, operation_id: str, data: bytes, mime_type: str,
               sha256: str, *, metadata: dict[str, Any] | None = None,
               save_to: str | None = None) -> dict[str, Any]:
        op = self.operation(owner, operation_id)
        if op.status in TERMINAL:
            raise MediaError('stale_target', 'Operation already ended')
        if not isinstance(data, bytes) or not 0 < len(data) <= MAX_UPLOAD_BYTES:
            raise MediaError('limit_exceeded', 'Media size exceeds operation limit')
        digest = hashlib.sha256(data).hexdigest()
        if not isinstance(sha256, str) or not secrets.compare_digest(digest, sha256):
            raise MediaError('stale_target', 'Media hash mismatch')
        if not isinstance(mime_type, str) or not 0 < len(mime_type) <= 100:
            raise MediaError('invalid_argument', 'Invalid MIME type')
        if metadata is None:
            metadata = {}
        if not isinstance(metadata, dict) or len(json.dumps(metadata)) > 1000:
            raise MediaError('invalid_argument', 'Invalid media metadata')
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
        notebook_use = sum(len(m.data) for m in self.media.values()
                           if m.owner.session_id == owner.session_id)
        if notebook_use + len(data) > MAX_NOTEBOOK_BYTES:
            raise MediaError('limit_exceeded', 'Notebook media memory limit exceeded')
        media = Media(secrets.token_urlsafe(24), owner, data, mime_type, digest,
                      self._now() + MEDIA_IDLE_SECONDS, metadata)
        self.media[media.id] = media
        op.media_id = media.id
        if save_to is not None:
            op.status = 'saving'
            try:
                media.path = self._save(owner, media, save_to)
            except Exception:
                self.media.pop(media.id, None)
                op.media_id = None
                op.status = 'failed'
                op.error = {'code': 'save_failed', 'message': 'Media could not be saved'}
                op.updated = self._now()
                raise
        op.status = 'completed'
        op.updated = self._now()
        return self.status(owner, operation_id)

    def _destination(self, owner: Owner, save_to: str, mime_type: str) -> Path:
        if self.root is None:
            raise MediaError('unsupported', 'This Jupyter contents backend cannot save browser media')
        if not isinstance(save_to, str) or not save_to:
            raise MediaError('invalid_argument', 'save_to must name a destination')
        notebook_dir = PurePosixPath(owner.notebook_path).parent
        suffix = mimetypes.guess_extension(mime_type.split(';', 1)[0]) or '.bin'
        if save_to == 'auto':
            relative = notebook_dir / 'media' / f'capture-{secrets.token_hex(8)}{suffix}'
        else:
            relative = PurePosixPath(save_to)
            if relative.is_absolute() or '..' in relative.parts or '\\' in save_to:
                raise MediaError('invalid_argument', 'save_to must be inside the server root')
        path = self.root.joinpath(*relative.parts)
        if not path.resolve(strict=False).is_relative_to(self.root):
            raise MediaError('invalid_argument', 'save_to escapes the server root')
        return path

    def _save(self, owner: Owner, media: Media, save_to: str) -> str:
        path = self._destination(owner, save_to, media.mime_type)
        relative = path.relative_to(self.root)
        # Walk anchored directory descriptors on POSIX: a symlink swap cannot
        # redirect the final create outside the root after validation.
        dir_flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
        directory_fd = os.open(self.root, dir_flags)
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
            try:
                fd = os.open(relative.name, flags, 0o600, dir_fd=directory_fd)
            except FileExistsError as exc:
                raise MediaError('path_conflict', 'Destination already exists') from exc
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(media.data)
            except BaseException:
                os.unlink(relative.name, dir_fd=directory_fd)
                raise
        except (OSError, NotImplementedError) as exc:
            raise MediaError('save_failed', 'Filesystem cannot safely save this path') from exc
        finally:
            os.close(directory_fd)
        return relative.as_posix()

    def media_ref(self, owner: Owner, media_id: str, *, consume: bool = False) -> Media:
        self.require(owner)
        media = self.media.get(media_id)
        if media is None or media.owner is not owner:
            raise MediaError('stale_target', 'Media reference expired')
        if consume:
            media.expires = self._now() + MEDIA_IDLE_SECONDS
        return media

    def save_media(self, owner: Owner, media_id: str, save_to: str = 'auto') -> dict[str, Any]:
        media = self.media_ref(owner, media_id, consume=True)
        path = self._save(owner, media, save_to)
        media.path = path
        return media.descriptor()

    def release_media(self, owner: Owner, media_id: str) -> None:
        self.media_ref(owner, media_id)
        self.media.pop(media_id, None)

    def expire_owner(self, owner: Owner) -> None:
        self.owners.pop((owner.session_id, owner.client_id), None)
        self.leases.pop(owner, None)
        for op in self.operations.values():
            if op.owner is owner and op.status not in TERMINAL:
                op.status = 'expired'
                op.error = {'code': 'stale_target', 'message': 'Browser owner disconnected'}
                op.updated = self._now()
        for media_id, media in list(self.media.items()):
            if media.owner is owner:
                self.media.pop(media_id, None)

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
        for media_id, media in list(self.media.items()):
            if media.expires <= now:
                self.media.pop(media_id, None)
        for op_id, op in list(self.operations.items()):
            if op.status in TERMINAL and op.updated + STATUS_SECONDS <= now:
                self.operations.pop(op_id, None)
                self.requests.pop((op.owner, op.request_id), None)

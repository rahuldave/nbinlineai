"""Nonblocking, execution-bound Python receipts for browser media operations."""

from __future__ import annotations

import asyncio
import hashlib
import io
import uuid
from dataclasses import dataclass, field
from typing import Any

from comm import create_comm
from IPython import get_ipython

COMM_TARGET = 'nbinlineai.browser_media.v1'


@dataclass
class MediaClip:
    """A bounded encoded audio or video result retained in Python."""

    data: bytes
    mime_type: str
    duration_seconds: float | None = None


@dataclass
class BrowserReceipt:
    """Mutable result that updates from browser messages without blocking a cell."""

    operation_id: str | None = None
    status: str = 'running'
    result: Any = None
    media: dict[str, Any] | list[dict[str, Any]] | None = None
    error: dict[str, str] | None = None
    _comm: Any = field(default=None, repr=False)

    def __repr__(self) -> str:
        return f'BrowserReceipt(operation_id={self.operation_id!r}, status={self.status!r})'


def _origin() -> tuple[str, str]:
    shell = get_ipython()
    kernel = getattr(shell, 'kernel', None)
    if kernel is None:
        raise RuntimeError('Browser tools require an active Jupyter Python kernel')
    parent = kernel.get_parent()
    if not isinstance(parent, dict):
        raise TypeError('Could not identify the executing notebook cell')
    header = parent.get('header', {})
    metadata = parent.get('metadata', {})
    request_id = header.get('msg_id') if isinstance(header, dict) else None
    cell_id = metadata.get('cellId') if isinstance(metadata, dict) else None
    if (not isinstance(request_id, str) or not request_id or
            not isinstance(cell_id, str) or not cell_id or
            header.get('msg_type') != 'execute_request'):
        raise RuntimeError('Browser tools require a code cell run in nbinlineai JupyterLab')
    return request_id, cell_id


def request_browser_operation(name: str, arguments: dict[str, Any]) -> BrowserReceipt:
    """Start a browser operation and return before any permission or capture."""
    request_id, cell_id = _origin()
    try:
        asyncio.get_running_loop()
    except RuntimeError as exc:
        raise RuntimeError('Browser tools require the Jupyter kernel event loop') from exc
    receipt = BrowserReceipt()
    operation_request_id = uuid.uuid4().hex
    comm = create_comm(target_name=COMM_TARGET, data={
        'version': 1, 'execute_request_id': request_id,
        'source_cell_id': cell_id, 'request_id': operation_request_id,
        'name': name, 'arguments': arguments,
    })
    receipt._comm = comm

    def update(message: dict[str, Any]) -> None:
        data = message.get('content', {}).get('data', {})
        if not isinstance(data, dict):
            return
        if isinstance(data.get('operation_id'), str):
            receipt.operation_id = data['operation_id']
        status = data.get('status')
        if isinstance(status, str):
            receipt.status = status
        media = data.get('media')
        if isinstance(media, (dict, list)):
            receipt.media = media
        error = data.get('error')
        if isinstance(error, dict):
            receipt.error = error
        result = data.get('result')
        if result is not None:
            receipt.result = result
        buffers = message.get('buffers', [])
        if buffers and receipt.media:
            descriptors = receipt.media if isinstance(receipt.media, list) else [receipt.media]
            try:
                if len(buffers) != len(descriptors):
                    raise ValueError('Media buffer count did not match descriptors')
                decoded = []
                for descriptor, buffer in zip(descriptors, buffers, strict=True):
                    if not isinstance(descriptor, dict):
                        raise TypeError('Invalid media descriptor')
                    raw = bytes(buffer)
                    if (descriptor.get('bytes') != len(raw) or
                            hashlib.sha256(raw).hexdigest() != descriptor.get('sha256')):
                        raise ValueError('Media bytes did not match the descriptor')
                    mime = descriptor.get('mime_type', '')
                    if isinstance(mime, str) and mime.startswith('image/') and mime != 'image/svg+xml':
                        from PIL import Image
                        image = Image.open(io.BytesIO(raw))
                        image.load()
                        decoded.append(image)
                    elif mime == 'image/svg+xml':
                        decoded.append(raw.decode('utf-8'))
                    elif isinstance(mime, str) and mime.startswith(('audio/', 'video/')):
                        decoded.append(MediaClip(raw, mime, descriptor.get('duration_seconds')))
                    else:
                        decoded.append(raw)
                receipt.result = decoded if isinstance(receipt.media, list) else decoded[0]
            except Exception as exc:  # noqa: BLE001 - a bad encoded result is a failed receipt
                receipt.status = 'failed'
                receipt.error = {'code': 'stale_target', 'message': f'Media could not be decoded: {exc}'[:500]}
        if receipt.status in {'completed', 'failed', 'cancelled', 'expired'}:
            comm.close()
            receipt._comm = None

    def closed(_message: dict[str, Any]) -> None:
        if receipt.status not in {'completed', 'failed', 'cancelled', 'expired'}:
            receipt.status = 'expired'
            receipt.error = {'code': 'stale_target', 'message': 'Browser result channel closed'}
        receipt._comm = None

    comm.on_msg(update)
    comm.on_close(closed)
    return receipt

"""Validated still-image attachment descriptors; never notebook pixel storage."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import Any

from PIL import Image

from .browser_media import MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, MediaError, Owner

IMAGE_MIMES = frozenset({'image/png', 'image/jpeg', 'image/webp', 'image/gif'})
DETAILS = frozenset({'auto', 'low', 'high'})
SHA256 = re.compile(r'[0-9a-f]{64}\Z')
MAX_ATTACHMENT_GRANTS = 256
MAX_OWNER_GRANTS = 8


@dataclass(frozen=True)
class AttachmentGrant:
    id: str
    owner: Owner
    question_cell_id: str
    media_id: str
    sha256: str
    mime_type: str
    detail: str


def validate_detail(detail: Any) -> str:
    if detail not in DETAILS or not isinstance(detail, str):
        raise MediaError('invalid_argument', 'detail must be auto, low, or high')
    return detail


def validate_question(question_cell_id: Any) -> str:
    if not isinstance(question_cell_id, str) or not 0 < len(question_cell_id) <= 200:
        raise MediaError('invalid_argument', 'Expected an identified AI question cell')
    return question_cell_id


def still_image_info(data: bytes, mime_type: str) -> dict[str, Any]:
    """Verify actual encoded pixels without changing or recompressing the bytes."""
    if not isinstance(mime_type, str):
        raise MediaError('provider_unsupported', 'Only still images can be attached')
    base_mime = mime_type.split(';', 1)[0].strip().lower()
    if base_mime not in IMAGE_MIMES:
        raise MediaError('provider_unsupported', 'Only PNG, JPEG, WebP, or GIF still images can be attached')
    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            if (width <= 0 or height <= 0 or width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE
                    or width * height > MAX_IMAGE_PIXELS):
                raise MediaError('limit_exceeded', 'Attached image exceeds the pixel limits')
            actual = Image.MIME.get(image.format)
            if actual != base_mime or getattr(image, 'n_frames', 1) != 1:
                raise MediaError('provider_unsupported', 'Attachment must be a matching still image')
            image.verify()
    except MediaError:
        raise
    except Exception as exc:
        raise MediaError('invalid_argument', 'Attached image is invalid') from exc
    return {'mime_type': base_mime, 'bytes': len(data), 'width': width, 'height': height}


def validate_confirmation(value: Any, question_cell_id: str) -> dict[str, Any]:
    """Accept only compact source references from the current question metadata."""
    if not isinstance(value, dict) or value.get('version') != 1 or value.get('question_cell_id') != question_cell_id:
        raise MediaError('stale_target', 'Confirmed attachment does not match this AI question')
    detail = validate_detail(value.get('detail'))
    digest = value.get('sha256')
    if not isinstance(digest, str) or not SHA256.fullmatch(digest):
        raise MediaError('invalid_argument', 'Attachment hash is invalid')
    kind = value.get('kind')
    if kind == 'memory' and set(value) == {
            'version', 'kind', 'question_cell_id', 'grant_id', 'sha256', 'detail'}:
        grant_id = value['grant_id']
        if isinstance(grant_id, str) and 0 < len(grant_id) <= 100:
            return {**value, 'detail': detail}
    if kind == 'saved' and set(value) == {
            'version', 'kind', 'question_cell_id', 'path', 'sha256', 'detail'}:
        path = value['path']
        if isinstance(path, str) and 0 < len(path) <= 500:
            return {**value, 'detail': detail}
    raise MediaError('invalid_argument', 'Attachment confirmation is invalid')

"""Import, preview, play, and use the clipboard in the originating notebook.

Direct Python calls return mutable receipts; inspect them in a later cell.
File selection, copy, paste, and some playback need a visible user action.
Model tools receive a bounded initial status rather than later media bytes.
"""

from __future__ import annotations

import math

from .browser_receipt import BrowserReceipt, request_browser_operation


def _media_ref(
    media: dict,  # Owned MediaRef with media_id, or an exact saved path and SHA-256 hash.
) -> dict[str, str]:  # Validated memory ID or exact saved-file reference.
    """Keep only a bounded memory ID or exact saved-file reference."""
    if not isinstance(media, dict):
        raise TypeError('media must be a MediaRef dictionary')
    if isinstance(media.get('media_id'), str) and 0 < len(media['media_id']) <= 100:
        return {'media_id': media['media_id']}
    if (isinstance(media.get('path'), str) and media['path'] and
            len(media['path']) <= 500 and isinstance(media.get('sha256'), str) and
            len(media['sha256']) == 64 and all(ch in '0123456789abcdef' for ch in media['sha256'])):
        return {'path': media['path'], 'sha256': media['sha256']}
    raise TypeError('media needs a media_id or exact path and sha256')


def _save_to(
    value: str | None,  # Optional destination to validate.
) -> str | None:  # The validated destination or None.
    """Validate an optional media destination."""
    if value is not None and (not isinstance(value, str) or not value):
        raise ValueError('save_to must be None, auto, or a nonempty server-relative path')
    return value


def _preview_id(
    value: str,  # Preview ID to validate.
) -> str:  # The validated preview ID.
    """Require a bounded nonempty preview ID."""
    if not isinstance(value, str) or not value or len(value) > 100:
        raise ValueError('preview_id must be a nonempty identifier')
    return value


def choose_file(
    accept: str = '',  # Browser file-input accept filter, at most 200 characters.
    multiple: bool = False,  # Whether the user may select multiple files, at most twelve.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a file chooser for an explicit user selection."""
    if not isinstance(accept, str) or len(accept) > 200:
        raise ValueError('accept must be at most 200 characters')
    if not isinstance(multiple, bool):
        raise TypeError('multiple must be a boolean')
    return request_browser_operation('choose_file', {
        'accept': accept, 'multiple': multiple, 'save_to': _save_to(save_to)})


def open_media(
    media: dict,  # Owned MediaRef with media_id, or an exact saved path and SHA-256 hash.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a notebook preview for an exact owned media reference."""
    return request_browser_operation('open_media', {'media': _media_ref(media)})


def play_media(
    preview_id: str,  # ID returned by open_media for an owned preview.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request playback of an owned audio or video preview."""
    return request_browser_operation('play_media', {'preview_id': _preview_id(preview_id)})


def pause_media(
    preview_id: str,  # ID returned by open_media for an owned preview.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Pause an owned audio/video preview."""
    return request_browser_operation('pause_media', {'preview_id': _preview_id(preview_id)})


def seek_media(
    preview_id: str,  # ID returned by open_media for an owned preview.
    seconds: float,  # Finite seek time in seconds within the decoded clip duration.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Seek an owned preview to an in-range time in seconds."""
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds):
        raise ValueError('seconds must be a finite number')
    return request_browser_operation('seek_media', {
        'preview_id': _preview_id(preview_id), 'seconds': float(seconds)})


def set_media_volume(
    preview_id: str,  # ID returned by open_media for an owned preview.
    level: float,  # Finite volume level from 0 through 1, subject to browser support.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Set preview volume between zero and one when the browser permits it."""
    if isinstance(level, bool) or not isinstance(level, (int, float)) or not math.isfinite(level) or not 0 <= level <= 1:
        raise ValueError('level must be a finite number from 0 through 1')
    return request_browser_operation('set_media_volume', {
        'preview_id': _preview_id(preview_id), 'level': float(level)})


def close_media(
    preview_id: str,  # ID returned by open_media for an owned preview.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Close an owned preview without deleting its input media or file."""
    return request_browser_operation('close_media', {'preview_id': _preview_id(preview_id)})


def copy_text(
    text: str,  # Text to offer for an explicit copy click, at most 8000 characters.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Show an explicit copy control for bounded text."""
    if not isinstance(text, str) or len(text) > 8_000:
        raise ValueError('text must be at most 8,000 characters')
    return request_browser_operation('copy_text', {'text': text})


def paste_content(
    accept: str = 'text,image',  # Accepted clipboard kinds: text, image, or both.
    save_to: str | None = None,  # None for text; image paste may use auto or a server-root-relative path.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Offer a paste target for bounded text or one raster image.

    Text paste requires save_to=None. Image paste may save a new file.
    """
    if not isinstance(accept, str) or accept not in {'text', 'image', 'text,image', 'image,text'}:
        raise ValueError('accept must be text, image, or text,image')
    return request_browser_operation('paste_content', {'accept': accept, 'save_to': _save_to(save_to)})


BROWSER_PLAYBACK_TOOL_FUNCTIONS = {
    'choose_file': choose_file,
    'open_media': open_media,
    'play_media': play_media,
    'pause_media': pause_media,
    'seek_media': seek_media,
    'set_media_volume': set_media_volume,
    'close_media': close_media,
    'copy_text': copy_text,
    'paste_content': paste_content,
}

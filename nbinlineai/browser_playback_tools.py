"""Notebook and model-facing import, playback, and clipboard controls."""

from __future__ import annotations

import math

from .browser_receipt import BrowserReceipt, request_browser_operation


def _media_ref(media: dict) -> dict[str, str]:
    if not isinstance(media, dict):
        raise TypeError('media must be a MediaRef dictionary')
    if isinstance(media.get('media_id'), str) and 0 < len(media['media_id']) <= 100:
        return {'media_id': media['media_id']}
    if (isinstance(media.get('path'), str) and media['path'] and
            len(media['path']) <= 500 and isinstance(media.get('sha256'), str) and
            len(media['sha256']) == 64 and all(ch in '0123456789abcdef' for ch in media['sha256'])):
        return {'path': media['path'], 'sha256': media['sha256']}
    raise TypeError('media needs a media_id or exact path and sha256')


def _save_to(value: str | None) -> str | None:
    if value is not None and (not isinstance(value, str) or not value):
        raise ValueError('save_to must be None, auto, or a nonempty server-relative path')
    return value


def _preview_id(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 100:
        raise ValueError('preview_id must be a nonempty identifier')
    return value


def choose_file(accept: str = '', multiple: bool = False, save_to: str | None = None) -> BrowserReceipt:
    """Show a file chooser and import selected files without an implicit save."""
    if not isinstance(accept, str) or len(accept) > 200:
        raise ValueError('accept must be at most 200 characters')
    if not isinstance(multiple, bool):
        raise TypeError('multiple must be a boolean')
    return request_browser_operation('choose_file', {
        'accept': accept, 'multiple': multiple, 'save_to': _save_to(save_to)})


def open_media(media: dict) -> BrowserReceipt:
    """Open an exact owned media reference in a notebook preview."""
    return request_browser_operation('open_media', {'media': _media_ref(media)})


def play_media(preview_id: str) -> BrowserReceipt:
    """Play an owned audio/video preview, requesting a click when needed."""
    return request_browser_operation('play_media', {'preview_id': _preview_id(preview_id)})


def pause_media(preview_id: str) -> BrowserReceipt:
    """Pause an owned audio/video preview."""
    return request_browser_operation('pause_media', {'preview_id': _preview_id(preview_id)})


def seek_media(preview_id: str, seconds: float) -> BrowserReceipt:
    """Seek an owned preview to an in-range time in seconds."""
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds):
        raise ValueError('seconds must be a finite number')
    return request_browser_operation('seek_media', {
        'preview_id': _preview_id(preview_id), 'seconds': float(seconds)})


def set_media_volume(preview_id: str, level: float) -> BrowserReceipt:
    """Set preview volume between zero and one when the browser permits it."""
    if isinstance(level, bool) or not isinstance(level, (int, float)) or not math.isfinite(level) or not 0 <= level <= 1:
        raise ValueError('level must be a finite number from 0 through 1')
    return request_browser_operation('set_media_volume', {
        'preview_id': _preview_id(preview_id), 'level': float(level)})


def close_media(preview_id: str) -> BrowserReceipt:
    """Close an owned preview without deleting its input media or file."""
    return request_browser_operation('close_media', {'preview_id': _preview_id(preview_id)})


def copy_text(text: str) -> BrowserReceipt:
    """Show an explicit copy control for bounded text."""
    if not isinstance(text, str) or len(text) > 8_000:
        raise ValueError('text must be at most 8,000 characters')
    return request_browser_operation('copy_text', {'text': text})


def paste_content(accept: str = 'text,image', save_to: str | None = None) -> BrowserReceipt:
    """Show an explicit paste target for bounded text or one raster image."""
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

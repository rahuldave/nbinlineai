"""Notebook and model-facing browser media control functions."""

from .browser_receipt import BrowserReceipt, request_browser_operation


def browser_capabilities() -> BrowserReceipt:
    """Report browser media availability and limits without prompting for permission."""
    return request_browser_operation('browser_capabilities', {})


def operation_status(operation_id: str) -> BrowserReceipt:
    """Read a browser operation's current state without waiting or extending media expiry."""
    return request_browser_operation('operation_status', {'operation_id': operation_id})


def cancel_operation(operation_id: str) -> BrowserReceipt:
    """Cancel an unfinished browser operation owned by this notebook client."""
    return request_browser_operation('cancel_operation', {'operation_id': operation_id})


def save_media(media: dict, save_to: str = 'auto') -> BrowserReceipt:
    """Save an owned memory result or exact saved-file reference to a new file."""
    if not isinstance(save_to, str) or not save_to:
        raise ValueError('save_to must name a destination; None is invalid for save_media')
    if not isinstance(media, dict):
        raise TypeError('media must be a memory or saved-file MediaRef')
    if isinstance(media.get('media_id'), str):
        reference = {'media_id': media['media_id']}
    elif isinstance(media.get('path'), str) and isinstance(media.get('sha256'), str):
        reference = {'path': media['path'], 'sha256': media['sha256']}
    else:
        raise TypeError('media must contain a media_id or exact path and sha256')
    return request_browser_operation('save_media', {'media': reference, 'save_to': save_to})


def release_media(media_id: str) -> BrowserReceipt:
    """Release owned temporary media bytes; existing Python copies stay available."""
    return request_browser_operation('release_media', {'media_id': media_id})


BROWSER_MEDIA_TOOL_FUNCTIONS = {
    'browser_capabilities': browser_capabilities,
    'operation_status': operation_status,
    'cancel_operation': cancel_operation,
    'save_media': save_media,
    'release_media': release_media,
}

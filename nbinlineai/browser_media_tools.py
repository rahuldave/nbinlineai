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
    """Save an owned in-memory media result to a new server-root-relative file."""
    if not isinstance(media, dict) or not isinstance(media.get('media_id'), str):
        raise TypeError('media must be a live media descriptor')
    return request_browser_operation('save_media', {'media_id': media['media_id'], 'save_to': save_to})


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

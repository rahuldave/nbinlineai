"""Browser media controls for notebook cells and AI tool calls.

Direct Python calls return a mutable receipt promptly, before browser work
finishes. Inspect that same receipt in a later cell. An AI tool returns a fixed
status snapshot. Use a later operation_status call to check work in progress.
"""

from .browser_receipt import BrowserReceipt, request_browser_operation


def browser_capabilities() -> BrowserReceipt:  # Receipt for a browser capabilities request.
    """Report browser media availability and limits without prompting for access.

    The direct Python receipt updates as the browser replies. Its initial
    status does not establish the completed capabilities result.
    """
    return request_browser_operation('browser_capabilities', {})


def operation_status(
    operation_id: str,  # Owned browser operation identifier.
) -> BrowserReceipt:  # Receipt for a browser status request.
    """Read an owned operation's current state without waiting or extending expiry.

    A completed lookup receipt means the lookup finished. Read its result to
    learn the original operation's state. The lookup does not fetch media bytes.
    """
    return request_browser_operation('operation_status', {'operation_id': operation_id})


def cancel_operation(
    operation_id: str,  # Owned unfinished browser operation identifier.
) -> BrowserReceipt:  # Receipt for a browser cancellation request.
    """Cancel unfinished browser work owned by this notebook client.

    Completed effects, including saved files, remain after cancellation.
    """
    return request_browser_operation('cancel_operation', {'operation_id': operation_id})


def save_media(
    media: dict,  # Owned memory reference or exact path and SHA-256 saved-file reference.
    save_to: str = 'auto',  # Destination name; auto chooses a new file.
) -> BrowserReceipt:  # Receipt for an asynchronous browser save request.
    """Save owned memory media or an exact saved-file reference to a new file.

    The Jupyter server writes under its root. The destination must be
    new. Existing files remain intact. The direct call returns before the
    browser finishes, so inspect its receipt in a later cell.
    """
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


def release_media(
    media_id: str,  # Owned temporary media identifier.
) -> BrowserReceipt:  # Receipt for a browser media-release request.
    """Release owned temporary media bytes and dependent previews.

    Already saved files and Python copies remain available.
    """
    return request_browser_operation('release_media', {'media_id': media_id})


BROWSER_MEDIA_TOOL_FUNCTIONS = {
    'browser_capabilities': browser_capabilities,
    'operation_status': operation_status,
    'cancel_operation': cancel_operation,
    'save_media': save_media,
    'release_media': release_media,
}

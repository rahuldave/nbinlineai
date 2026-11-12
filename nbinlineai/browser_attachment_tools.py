"""Ask the user to attach one exact still image to a live AI question.

Direct Python calls return mutable receipts. The visible confirmation changes
question metadata after rechecking the source and question; it does not run
the question. Model tools receive only a bounded initial status.
"""

from .browser_receipt import BrowserReceipt, request_browser_operation


def attach_media(
    media: dict,  # Owned MediaRef with media_id, or an exact saved path and SHA-256 hash.
    question_cell_id: str,  # Stable ID of the live AI question that will receive the image.
    detail: str = 'auto',  # Image detail: auto, low, or high, subject to provider support.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Ask the user to confirm attaching exact image bytes to one AI question.

    Confirmation changes that question's metadata but never runs the question.
    The receipt reports the confirmed hash or a refusal.
    """
    if not isinstance(media, dict):
        raise TypeError('media must be a memory or saved-file MediaRef')
    if isinstance(media.get('media_id'), str):
        reference = {'media_id': media['media_id']}
    elif isinstance(media.get('path'), str) and isinstance(media.get('sha256'), str):
        reference = {'path': media['path'], 'sha256': media['sha256']}
    else:
        raise TypeError('media must contain a media_id or exact path and sha256')
    if not isinstance(question_cell_id, str) or not 0 < len(question_cell_id) <= 200:
        raise ValueError('question_cell_id must identify a live AI question')
    if detail not in ('auto', 'low', 'high') or not isinstance(detail, str):
        raise ValueError('detail must be auto, low, or high')
    return request_browser_operation('attach_media', {
        'media': reference, 'question_cell_id': question_cell_id, 'detail': detail,
    })


BROWSER_ATTACHMENT_TOOL_FUNCTIONS = {'attach_media': attach_media}

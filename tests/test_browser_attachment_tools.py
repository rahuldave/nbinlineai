"""The public attachment function stays an execution-bound browser receipt."""

import pytest

from nbinlineai import browser_attachment_tools
from nbinlineai.frontend_bridge import normalize_action
from nbinlineai.tools import SPECIAL_TOOL_FUNCTIONS, TOOL_FUNCTIONS, TOOL_GROUPS


def test_attach_media_registered_once_and_normalizes_rich_receipt_descriptor(monkeypatch):
    requests = []
    monkeypatch.setattr(browser_attachment_tools, 'request_browser_operation',
                        lambda name, arguments: requests.append((name, arguments)) or 'receipt')
    assert SPECIAL_TOOL_FUNCTIONS['attach_media'] is TOOL_FUNCTIONS['attach_media']
    assert TOOL_GROUPS['browser_attachment'] == ('attach_media',)
    result = browser_attachment_tools.attach_media(
        {'media_id': 'owned-still', 'mime_type': 'image/png', 'bytes': 82,
         'sha256': 'a' * 64, 'width': 2, 'height': 2}, 'question', 'auto')
    assert result == 'receipt'
    assert requests == [('attach_media', {'media': {'media_id': 'owned-still'},
                                        'question_cell_id': 'question', 'detail': 'auto'})]
    assert normalize_action('attach_media', requests[0][1]) == requests[0][1]


def test_attachment_action_rejects_ambiguous_or_unbounded_model_arguments():
    for bad in (
        {'media': {'media_id': 'm', 'path': 'other.png'}, 'question_cell_id': 'q'},
        {'media': {'path': '../escape.png', 'sha256': 'a' * 64, 'secret': 'x'},
         'question_cell_id': 'q'},
        {'media': {'media_id': 'm'}, 'question_cell_id': 'q', 'detail': 'original'},
        {'media': {'media_id': 'm'}, 'question_cell_id': 'q', 'extra': 'x'},
    ):
        with pytest.raises((TypeError, ValueError)):
            normalize_action('attach_media', bad)
    with pytest.raises(RuntimeError, match='Jupyter Python kernel'):
        browser_attachment_tools.attach_media({'media_id': 'm'}, 'q')

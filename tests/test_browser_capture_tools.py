"""Capture tool signatures, validation and registry behavior."""

import inspect

import pytest

from nbinlineai import tools
from nbinlineai.browser_capture_tools import (
    BROWSER_CAPTURE_TOOL_FUNCTIONS,
    normalize_capture_action,
)
from nbinlineai.frontend_bridge import normalize_action


def test_capture_registry_is_explicit_and_default_group_stays_bounded():
    assert len(BROWSER_CAPTURE_TOOL_FUNCTIONS) == 17
    assert set(BROWSER_CAPTURE_TOOL_FUNCTIONS) <= tools.TOOL_FUNCTIONS.keys()
    assert all(tools.TOOL_FUNCTIONS[name] is getattr(tools, name)
               for name in BROWSER_CAPTURE_TOOL_FUNCTIONS)
    assert len(tools.TOOL_GROUPS['camera']) == 12
    assert len(tools.TOOL_GROUPS['screen']) == 4
    assert 'capture_screen' in tools.TOOL_GROUPS['screen']
    assert 'capture_tool' not in tools.TOOL_GROUPS['screen']
    assert len(tools.TOOL_GROUPS['camera']) + len(tools.TOOL_GROUPS['browser_media']) <= 20
    assert str(inspect.signature(tools.capture_camera)) == \
        "(source_id: 'str' = '', save_to: 'str | None' = None, max_size: 'int' = 1280) -> 'BrowserReceipt'"


@pytest.mark.parametrize(('name', 'arguments', 'field'), [
    ('start_camera', {'audio': 'yes'}, 'audio'),
    ('start_camera', {'facing': 'rear'}, 'facing'),
    ('list_media_sources', {'limit': 0}, 'limit'),
    ('capture_camera', {'max_size': 4097}, 'max_size'),
    ('capture_screen', {'timeout': 0}, 'timeout'),
    ('start_recording', {'source_id': 'source', 'save_to': None, 'duration': 61}, 'duration'),
    ('record_microphone', {'save_to': ''}, 'save_to'),
    ('read_audio_levels', {'source_id': 'source', 'window_ms': 1001}, 'window_ms'),
    ('stop_source', {}, 'stop_source'),
])
def test_capture_action_rejects_bad_arguments(name, arguments, field):
    with pytest.raises((TypeError, ValueError), match=field):
        normalize_action(name, arguments)


def test_capture_action_defaults_and_unknown_names():
    assert normalize_capture_action('other_tool', {}) is None
    assert normalize_action('capture_tool', {}) == {
        'timeout': 15, 'source_id': '', 'save_to': None, 'max_size': 1280}
    assert normalize_action('record_camera', {'save_to': None, 'duration': 60}) == {
        'save_to': None, 'duration': 60, 'audio': False, 'facing': 'user'}

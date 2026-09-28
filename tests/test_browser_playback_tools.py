"""Public playback tools expose bounded, nonblocking browser requests."""

import pytest

from nbinlineai import browser_playback_tools as playback
from nbinlineai.frontend_bridge import normalize_action
from nbinlineai.tools import TOOL_FUNCTIONS, TOOL_GROUPS

NAMES = (
    'choose_file', 'open_media', 'play_media', 'pause_media', 'seek_media',
    'set_media_volume', 'close_media', 'copy_text', 'paste_content',
)


def test_registered_playback_tools_use_one_receipt_transport(monkeypatch):
    calls = []
    token = object()
    monkeypatch.setattr(playback, 'request_browser_operation',
                        lambda name, args: calls.append((name, args)) or token)
    source = {'path': 'media/tone.wav', 'sha256': 'a' * 64}
    examples = (
        ('choose_file', playback.choose_file(), {'accept': '', 'multiple': False, 'save_to': None}),
        ('open_media', playback.open_media(source), {'media': source}),
        ('play_media', playback.play_media('preview'), {'preview_id': 'preview'}),
        ('pause_media', playback.pause_media('preview'), {'preview_id': 'preview'}),
        ('seek_media', playback.seek_media('preview', 1.5), {'preview_id': 'preview', 'seconds': 1.5}),
        ('set_media_volume', playback.set_media_volume('preview', .25), {'preview_id': 'preview', 'level': .25}),
        ('close_media', playback.close_media('preview'), {'preview_id': 'preview'}),
        ('copy_text', playback.copy_text('hello'), {'text': 'hello'}),
        ('paste_content', playback.paste_content(), {'accept': 'text,image', 'save_to': None}),
    )
    assert tuple(TOOL_GROUPS['browser_playback']) == NAMES
    assert all(name in TOOL_FUNCTIONS for name in NAMES)
    assert [(name, args) for name, _, args in examples] == calls
    assert all(value is token for _, value, _ in examples)
    assert all(normalize_action(name, args) == args for name, _, args in examples)
    assert normalize_action('open_media', {'media': {'media_id': 'owned', 'mime_type': 'image/png'}}) == {
        'media': {'media_id': 'owned'}}


@pytest.mark.parametrize('name,args', [
    ('choose_file', {'multiple': 'yes'}),
    ('choose_file', {'save_to': ''}),
    ('open_media', {'media': {'path': 'x.png'}}),
    ('open_media', {'media': {'path': 'elsewhere', 'sha256': 'not-a-hash'}}),
    ('seek_media', {'preview_id': 'p', 'seconds': float('nan')}),
    ('set_media_volume', {'preview_id': 'p', 'level': 1.5}),
    ('copy_text', {'text': 'x' * 8_001}),
    ('paste_content', {'accept': 'html'}),
    ('play_media', {'preview_id': 'p', 'other': True}),
])
def test_model_playback_actions_reject_invalid_or_extra_arguments(name, args):
    with pytest.raises((TypeError, ValueError)):
        normalize_action(name, args)


def test_python_playback_arguments_are_bounded_before_dispatch(monkeypatch):
    monkeypatch.setattr(playback, 'request_browser_operation',
                        lambda *_: pytest.fail('Invalid request reached browser transport'))
    with pytest.raises(ValueError):
        playback.choose_file(accept='x' * 201)
    with pytest.raises(TypeError):
        playback.choose_file(multiple=1)
    with pytest.raises(TypeError):
        playback.open_media({'path': 'missing-sha.png'})
    with pytest.raises(ValueError):
        playback.seek_media('preview', float('inf'))
    with pytest.raises(ValueError):
        playback.set_media_volume('preview', -0.1)
    with pytest.raises(ValueError):
        playback.copy_text('x' * 8_001)
    with pytest.raises(ValueError):
        playback.paste_content(accept='html')

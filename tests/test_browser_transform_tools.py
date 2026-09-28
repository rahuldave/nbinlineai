"""Public transform validation and model routing keep the same exact contract."""

import pytest

from nbinlineai import browser_transform_tools as transforms
from nbinlineai.frontend_bridge import normalize_action
from nbinlineai.tools import TOOL_FUNCTIONS, TOOL_GROUPS


def test_registered_transforms_use_nonblocking_receipts(monkeypatch):
    calls = []
    receipt = object()
    monkeypatch.setattr(transforms, 'request_browser_operation',
                        lambda name, args: calls.append((name, args)) or receipt)
    source = {'path': 'disposable/source.png', 'sha256': 'a' * 64}
    shapes = [{'type': 'redaction', 'x': 0, 'y': 0, 'width': 2, 'height': 2}]
    results = [
        transforms.extract_frames(source, [0, 0.5]),
        transforms.crop_image(source, 0, 1, 2, 3),
        transforms.annotate_image(source, shapes),
    ]
    assert results == [receipt] * 3
    assert tuple(TOOL_GROUPS['browser_transforms']) == ('extract_frames', 'crop_image', 'annotate_image')
    assert all(name in TOOL_FUNCTIONS for name in TOOL_GROUPS['browser_transforms'])
    assert [name for name, _ in calls] == list(TOOL_GROUPS['browser_transforms'])
    assert all(normalize_action(name, arguments) == arguments for name, arguments in calls)
    assert calls[0][1]['timestamps'] == [0.0, 0.5]
    assert calls[2][1]['annotations'] == shapes


@pytest.mark.parametrize('name,arguments', [
    ('extract_frames', {'media': {'media_id': 'x'}, 'timestamps': []}),
    ('extract_frames', {'media': {'media_id': 'x'}, 'timestamps': [0] * 13}),
    ('extract_frames', {'media': {'media_id': 'x'}, 'timestamps': [float('nan')]}),
    ('crop_image', {'media': {'media_id': 'x'}, 'x': 0, 'y': 0, 'width': True, 'height': 1}),
    ('crop_image', {'media': {'media_id': 'x'}, 'x': -1, 'y': 0, 'width': 1, 'height': 1}),
    ('annotate_image', {'media': {'media_id': 'x'}, 'annotations': []}),
    ('annotate_image', {'media': {'media_id': 'x'}, 'annotations': [
        {'type': 'redaction', 'x': 0, 'y': 0, 'width': 1, 'height': 1, 'color': '#ff0000'}]}),
    ('annotate_image', {'media': {'media_id': 'x'}, 'annotations': [
        {'type': 'rectangle', 'x': 0, 'y': 0, 'width': 1, 'height': 1, 'color': 'transparent'}]}),
    ('crop_image', {'media': {'path': 'source.png', 'sha256': 'nope'},
                    'x': 0, 'y': 0, 'width': 1, 'height': 1}),
    ('crop_image', {'media': {'media_id': 'x'}, 'x': 0, 'y': 0, 'width': 1, 'height': 1,
                    'extra': True}),
])
def test_model_actions_reject_invalid_shapes_or_extra_fields(name, arguments):
    with pytest.raises((TypeError, ValueError)):
        normalize_action(name, arguments)


def test_python_arguments_reject_before_dispatch(monkeypatch):
    monkeypatch.setattr(transforms, 'request_browser_operation',
                        lambda *_: pytest.fail('Invalid call reached browser transport'))
    with pytest.raises(ValueError):
        transforms.extract_frames({'media_id': 'x'}, [301])
    with pytest.raises(ValueError):
        transforms.crop_image({'media_id': 'x'}, 0, 0, 0, 1)
    with pytest.raises(ValueError):
        transforms.annotate_image({'media_id': 'x'}, [{'type': 'text', 'x': 0, 'y': 0,
                                                      'text': 'x' * 201}])

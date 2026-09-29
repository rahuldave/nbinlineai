"""Pure validation and bounded saved-only provenance for raster derivatives."""

from __future__ import annotations

import json
import math
import re
from typing import Any

TRANSFORMS = frozenset({'extract_frames', 'crop_image', 'annotate_image'})
HEX = re.compile(r'[0-9a-f]{64}\Z')
COLOR = re.compile(r'#[0-9a-fA-F]{6}\Z')
_UNSET = object()


def _pixel(value: Any, positive: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not (1 if positive else 0) <= value <= 4096:
        raise ValueError('Invalid transform pixel coordinate')
    return value


def _number(value: Any, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('Invalid transform numeric value')
    return float(value)


def _annotation(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise TypeError('Invalid annotation')
    kind = item.get('type')
    if kind in {'rectangle', 'redaction'}:
        required = {'type', 'x', 'y', 'width', 'height'}
        allowed = required | ({'color', 'line_width'} if kind == 'rectangle' else set())
        if set(item) - allowed or required - set(item):
            raise ValueError('Invalid rectangle annotation')
        for key in ('x', 'y'):
            _pixel(item[key])
        for key in ('width', 'height'):
            _pixel(item[key], True)
    elif kind == 'arrow':
        required = {'type', 'x1', 'y1', 'x2', 'y2'}
        if set(item) - (required | {'color', 'line_width'}) or required - set(item):
            raise ValueError('Invalid arrow annotation')
        for key in ('x1', 'y1', 'x2', 'y2'):
            _pixel(item[key])
    elif kind == 'text':
        required = {'type', 'x', 'y', 'text'}
        if set(item) - (required | {'color', 'font_size'}) or required - set(item):
            raise ValueError('Invalid text annotation')
        _pixel(item['x'])
        _pixel(item['y'])
        if not isinstance(item['text'], str) or not 1 <= len(item['text']) <= 200:
            raise ValueError('Invalid annotation text')
    else:
        raise ValueError('Unsupported annotation type')
    if 'color' in item and (not isinstance(item['color'], str) or COLOR.fullmatch(item['color']) is None):
        raise ValueError('Invalid annotation color')
    if 'line_width' in item:
        _number(item['line_width'], 1, 32)
    if 'font_size' in item:
        _number(item['font_size'], 8, 96)
    return item


def validated_provenance(name: str, signature: str, metadata: dict[str, Any],
                         source_sha256: str, *, index: int | None = None,
                         save_to: str | None | object = _UNSET) -> dict[str, Any]:
    """Validate frozen request and scalar descriptor facts; omit source path/bytes."""
    if name not in TRANSFORMS:
        raise ValueError('Operation is not a raster transformation')
    try:
        frozen_name, args = json.loads(signature)
    except (TypeError, ValueError) as exc:
        raise ValueError('Invalid frozen transformation') from exc
    if frozen_name != name or not isinstance(args, dict):
        raise ValueError('Invalid frozen transformation')
    reference = args.get('media')
    if not isinstance(reference, dict) or set(reference) not in ({'media_id'}, {'path', 'sha256'}):
        raise ValueError('Invalid source reference')
    if set(reference) == {'path', 'sha256'}:
        if not isinstance(reference['path'], str) or not reference['path'] or len(reference['path']) > 500 or (
                not isinstance(reference['sha256'], str) or HEX.fullmatch(reference['sha256']) is None):
            raise ValueError('Invalid exact source reference')
        if reference['sha256'] != source_sha256:
            raise ValueError('Source hash changed')
    elif not isinstance(reference['media_id'], str) or not 0 < len(reference['media_id']) <= 100:
        raise ValueError('Invalid source memory reference')
    if not isinstance(source_sha256, str) or HEX.fullmatch(source_sha256) is None:
        raise ValueError('Invalid source SHA-256')
    if save_to is not _UNSET and args.get('save_to') != save_to:
        raise ValueError('Transformation destination changed')
    required_metadata = {'source_sha256', 'transform', 'actual_seconds'} if name == 'extract_frames' else {
        'source_sha256', 'transform'}
    if set(metadata) != required_metadata or metadata['source_sha256'] != source_sha256 or metadata['transform'] != name:
        raise ValueError('Invalid transformation metadata')
    if name == 'extract_frames':
        if set(args) != {'media', 'timestamps', 'save_to'}:
            raise ValueError('Invalid frame request')
        timestamps = args['timestamps']
        if not isinstance(timestamps, list) or not 1 <= len(timestamps) <= 12 or any(
                not isinstance(value, (int, float)) or isinstance(value, bool) or
                not math.isfinite(value) or not 0 <= value <= 300 for value in timestamps):
            raise ValueError('Invalid frame timestamps')
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(timestamps):
            raise ValueError('Invalid frame index')
        actual = _number(metadata['actual_seconds'], 0, 300)
        parameters = {'requested_seconds': float(timestamps[index]), 'actual_seconds': actual,
                      'frame_index': index}
    elif name == 'crop_image':
        if set(args) != {'media', 'x', 'y', 'width', 'height', 'save_to'} or index is not None:
            raise ValueError('Invalid crop request')
        parameters = {key: _pixel(args[key], key in {'width', 'height'})
                      for key in ('x', 'y', 'width', 'height')}
    else:
        if set(args) != {'media', 'annotations', 'save_to'} or index is not None:
            raise ValueError('Invalid annotation request')
        items = args['annotations']
        if not isinstance(items, list) or not 1 <= len(items) <= 50:
            raise ValueError('Invalid annotation count')
        parameters = {'annotations': [_annotation(item) for item in items]}
    record = {'version': 1, 'source_sha256': source_sha256,
              'transform': name, 'parameters': parameters}
    if len(json.dumps(record, separators=(',', ':'), ensure_ascii=False)) > 16_000:
        raise ValueError('Transformation provenance exceeds 16,000 characters')
    return record

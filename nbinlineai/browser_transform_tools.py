"""Create bounded image and video derivatives from owned media.

Direct Python calls return mutable receipts before decoding or saving finishes.
Inspect them in a later cell. Model tools receive bounded initial status and
media descriptors, not derivative image pixels. Source media stays unchanged.
"""

from __future__ import annotations

import math
import re

from .browser_playback_tools import _media_ref, _save_to
from .browser_receipt import BrowserReceipt, request_browser_operation


def _coordinate(
    value: int,  # Pixel coordinate or size to validate.
    name: str,  # Argument name in the error message.
    *,
    positive: bool = False,  # Require at least one pixel instead of zero.
) -> int:  # The validated pixel coordinate or size.
    """Require a bounded nonnegative or positive pixel value."""
    if isinstance(value, bool) or not isinstance(value, int) or value < (1 if positive else 0) or value > 4096:
        raise ValueError(f'{name} must be an integer from {1 if positive else 0} through 4096')
    return value


def _bounded_number(
    value: float,  # Finite numeric value to validate.
    name: str,  # Argument name in the error message.
    low: float,  # Inclusive lower bound.
    high: float,  # Inclusive upper bound.
) -> float:  # The validated number as a float.
    """Require a finite number within inclusive bounds."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{name} must be finite and from {low:g} through {high:g}')
    return float(value)


def _annotations(
    value: list[dict],  # One through fifty shape dictionaries to validate and copy.
) -> list[dict]:  # A copied list of validated shapes.
    """Validate and copy the supported image annotations."""
    if not isinstance(value, list) or not 1 <= len(value) <= 50:
        raise ValueError('annotations must contain 1 through 50 shapes')
    result = []
    for item in value:
        if not isinstance(item, dict):
            raise TypeError('each annotation must be a dictionary')
        kind = item.get('type')
        if kind in {'rectangle', 'redaction'}:
            allowed = {'type', 'x', 'y', 'width', 'height', 'color', 'line_width'} if kind == 'rectangle' else {
                'type', 'x', 'y', 'width', 'height'}
            if set(item) - allowed or not {'x', 'y', 'width', 'height'} <= set(item):
                raise ValueError('invalid rectangle annotation fields')
            for key in ('x', 'y'):
                _coordinate(item[key], key)
            for key in ('width', 'height'):
                _coordinate(item[key], key, positive=True)
        elif kind == 'arrow':
            if set(item) - {'type', 'x1', 'y1', 'x2', 'y2', 'color', 'line_width'} or not {
                    'x1', 'y1', 'x2', 'y2'} <= set(item):
                raise ValueError('invalid arrow annotation fields')
            for key in ('x1', 'y1', 'x2', 'y2'):
                _coordinate(item[key], key)
        elif kind == 'text':
            if set(item) - {'type', 'x', 'y', 'text', 'color', 'font_size'} or not {'x', 'y', 'text'} <= set(item):
                raise ValueError('invalid text annotation fields')
            _coordinate(item['x'], 'x')
            _coordinate(item['y'], 'y')
            if not isinstance(item['text'], str) or not 1 <= len(item['text']) <= 200:
                raise ValueError('annotation text must have 1 through 200 characters')
        else:
            raise ValueError('annotation type must be text, arrow, rectangle, or redaction')
        if 'color' in item and (not isinstance(item['color'], str) or
                                re.fullmatch(r'#[0-9a-fA-F]{6}', item['color']) is None):
            raise ValueError('annotation color must be an opaque six-digit hex value')
        if 'line_width' in item:
            _bounded_number(item['line_width'], 'line_width', 1, 32)
        if 'font_size' in item:
            _bounded_number(item['font_size'], 'font_size', 8, 96)
        result.append(dict(item))
    return result


def extract_frames(
    media: dict,  # Owned MediaRef with media_id, or an exact saved path and SHA-256 hash.
    timestamps: list[float],  # One through twelve finite timestamps in seconds, each from 0 through 300.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request up to twelve video frames as memory images or saved PNGs.

    With save_to=None, the completed Python result is a list of PIL images.
    """
    if not isinstance(timestamps, list) or not 1 <= len(timestamps) <= 12:
        raise ValueError('timestamps must contain 1 through 12 seconds values')
    times = [_bounded_number(value, 'timestamp', 0, 300) for value in timestamps]
    return request_browser_operation('extract_frames', {
        'media': _media_ref(media), 'timestamps': times, 'save_to': _save_to(save_to)})


def crop_image(
    media: dict,  # Owned MediaRef with media_id, or an exact saved path and SHA-256 hash.
    x: int,  # Left crop coordinate in pixels, from 0 through 4096.
    y: int,  # Top crop coordinate in pixels, from 0 through 4096.
    width: int,  # Crop width in pixels, from 1 through 4096.
    height: int,  # Crop height in pixels, from 1 through 4096.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a new PNG crop without changing its exact source."""
    return request_browser_operation('crop_image', {
        'media': _media_ref(media), 'x': _coordinate(x, 'x'), 'y': _coordinate(y, 'y'),
        'width': _coordinate(width, 'width', positive=True),
        'height': _coordinate(height, 'height', positive=True), 'save_to': _save_to(save_to)})


def annotate_image(
    media: dict,  # Owned MediaRef with media_id, or an exact saved path and SHA-256 hash.
    annotations: list[dict],  # One through fifty text, arrow, rectangle, or redaction shapes.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a new PNG with text, shapes, or opaque redactions."""
    return request_browser_operation('annotate_image', {
        'media': _media_ref(media), 'annotations': _annotations(annotations),
        'save_to': _save_to(save_to)})


BROWSER_TRANSFORM_TOOL_FUNCTIONS = {
    'extract_frames': extract_frames,
    'crop_image': crop_image,
    'annotate_image': annotate_image,
}

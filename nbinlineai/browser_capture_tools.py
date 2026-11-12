"""Camera, microphone, recording, and display tools for the originating notebook.

Direct Python calls return mutable receipts before capture or saving finishes.
Inspect status, result, media, or error in a later cell. Model tools receive
only a bounded initial status; permission and display sharing need user action.
"""

from __future__ import annotations

from typing import Any

from .browser_receipt import BrowserReceipt, request_browser_operation

CAPTURE_NAMES = (
    'list_media_sources', 'start_camera', 'start_microphone', 'capture_camera',
    'stop_source', 'start_recording', 'pause_recording', 'resume_recording',
    'stop_recording', 'record_camera', 'record_microphone', 'read_audio_levels',
    'setup_share', 'start_share', 'capture_screen', 'capture_tool', 'stop_share',
)


def _text(
    value: Any,  # Value to validate as text.
    name: str,  # Argument name in the error message.
    *,
    empty: bool = False,  # Whether an empty string is valid.
    maximum: int = 200,  # Maximum number of characters.
) -> str:  # The validated text.
    """Validate a bounded string for a capture argument."""
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value):
        raise ValueError(f'{name} must be a {"possibly empty " if empty else "nonempty "}string')
    return value


def _integer(
    value: Any,  # Value to validate as an integer, excluding booleans.
    name: str,  # Argument name in the error message.
    low: int,  # Inclusive lower bound.
    high: int,  # Inclusive upper bound.
) -> int:  # The validated integer.
    """Validate an inclusive integer range without accepting booleans."""
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f'{name} must be between {low} and {high}')
    return value


def _bool(
    value: Any,  # Value to validate as a boolean.
    name: str,  # Argument name in the error message.
) -> bool:  # The validated boolean.
    """Require a boolean capture argument."""
    if not isinstance(value, bool):
        raise TypeError(f'{name} must be true or false')
    return value


def _save_to(
    value: Any,  # Optional destination; None keeps the result in memory.
) -> str | None:  # The validated destination or None.
    """Validate an optional capture destination."""
    if value is None:
        return None
    return _text(value, 'save_to', maximum=500)


def normalize_capture_action(
    name: str,  # Capture tool name to recognize.
    arguments: dict[str, Any],  # Arguments supplied to the named capture tool.
) -> dict[str, Any] | None:  # Normalized arguments, or None for a tool outside this family.
    """Validate only this family; None means another tool owns the action."""
    if name not in CAPTURE_NAMES:
        return None
    defaults: dict[str, dict[str, Any]] = {
        'list_media_sources': {'kind': 'all', 'cursor': '', 'limit': 10},
        'start_camera': {'audio': False, 'device_id': '', 'facing': 'user'},
        'start_microphone': {'device_id': ''},
        'capture_camera': {'source_id': '', 'save_to': None, 'max_size': 1280},
        'stop_source': {},
        'start_recording': {'save_to': 'auto', 'duration': 30},
        'pause_recording': {}, 'resume_recording': {}, 'stop_recording': {},
        'record_camera': {'save_to': 'auto', 'duration': 30, 'audio': False, 'facing': 'user'},
        'record_microphone': {'save_to': 'auto', 'duration': 30, 'device_id': ''},
        'read_audio_levels': {'window_ms': 250},
        'setup_share': {}, 'start_share': {'audio': False},
        'capture_screen': {'timeout': 15, 'source_id': '', 'save_to': None, 'max_size': 1280},
        'capture_tool': {'timeout': 15, 'source_id': '', 'save_to': None, 'max_size': 1280},
        'stop_share': {'source_id': ''},
    }
    required = {
        'stop_source': {'source_id'}, 'start_recording': {'source_id'},
        'pause_recording': {'operation_id'}, 'resume_recording': {'operation_id'},
        'stop_recording': {'operation_id'}, 'read_audio_levels': {'source_id'},
    }.get(name, set())
    if set(arguments) - defaults[name].keys() - required or required - set(arguments):
        raise ValueError(f'Unexpected or missing {name} argument')
    result = {**defaults[name], **arguments}
    for key in ('source_id', 'operation_id'):
        if key in result:
            _text(result[key], key, empty=key == 'source_id' and name != 'stop_source')
    if 'device_id' in result:
        _text(result['device_id'], 'device_id', empty=True)
    if 'cursor' in result:
        _text(result['cursor'], 'cursor', empty=True, maximum=100)
    if 'kind' in result and result['kind'] not in {'all', 'camera', 'microphone'}:
        raise ValueError('kind must be all, camera, or microphone')
    if 'facing' in result and result['facing'] not in {'user', 'environment'}:
        raise ValueError('facing must be user or environment')
    if 'audio' in result:
        _bool(result['audio'], 'audio')
    if 'save_to' in result:
        result['save_to'] = _save_to(result['save_to'])
    if 'limit' in result:
        _integer(result['limit'], 'limit', 1, 50)
    if 'max_size' in result:
        _integer(result['max_size'], 'max_size', 1, 4096)
    if 'timeout' in result:
        _integer(result['timeout'], 'timeout', 1, 60)
    if 'window_ms' in result:
        _integer(result['window_ms'], 'window_ms', 1, 1000)
    if 'duration' in result:
        _integer(result['duration'], 'duration', 1, 60 if result['save_to'] is None else 300)
    return result


def _request(
    name: str,  # Capture operation to send to the browser.
    arguments: dict[str, Any],  # Arguments to validate before sending.
) -> BrowserReceipt:  # Mutable receipt for the validated browser request.
    """Validate capture arguments and request a browser operation."""
    return request_browser_operation(name, normalize_capture_action(name, arguments))


def list_media_sources(
    kind: str = 'all',  # Filter: all, camera, or microphone.
    cursor: str = '',  # Page cursor, or empty for the first page.
    limit: int = 10,  # Maximum devices to list, from 1 through 50.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """List camera and microphone devices without asking for permission."""
    return _request('list_media_sources', locals())


def start_camera(
    audio: bool = False,  # Whether to request a microphone track with video.
    device_id: str = '',  # Device ID from discovery, or empty for the browser default.
    facing: str = 'user',  # Preferred camera: user or environment.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a notebook camera preview, optionally with microphone audio."""
    return _request('start_camera', locals())


def start_microphone(
    device_id: str = '',  # Device ID from discovery, or empty for the browser default.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a microphone source and local level meter."""
    return _request('start_microphone', locals())


def capture_camera(
    source_id: str = '',  # Owned camera ID, or empty when exactly one camera is active.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    max_size: int = 1280,  # Maximum longest image edge in pixels, from 1 through 4096.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Capture a still from an owned camera, optionally saving it locally."""
    return _request('capture_camera', locals())


def stop_source(
    source_id: str,  # ID of an owned live browser source.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Stop an owned source and finalize its recording, if any."""
    return _request('stop_source', locals())


def start_recording(
    source_id: str,  # ID of an owned live browser source.
    save_to: str | None = 'auto',  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    duration: int = 30,  # Wall-clock limit in seconds: up to 60 in memory or 300 when saved.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request one bounded recording from the source's declared tracks."""
    return _request('start_recording', locals())


def pause_recording(
    operation_id: str,  # ID of the recording operation.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Pause an active recording without resetting its wall-clock bound."""
    return _request('pause_recording', locals())


def resume_recording(
    operation_id: str,  # ID of the recording operation.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Resume a paused recording."""
    return _request('resume_recording', locals())


def stop_recording(
    operation_id: str,  # ID of the recording operation.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Flush and finish a recording at its selected destination."""
    return _request('stop_recording', locals())


def record_camera(
    save_to: str | None = 'auto',  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    duration: int = 30,  # Wall-clock limit in seconds: up to 60 in memory or 300 when saved.
    audio: bool = False,  # Whether to include microphone audio.
    facing: str = 'user',  # Preferred camera: user or environment.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a bounded camera recording with its own temporary source.

    The operation closes its source when it finishes or fails.
    """
    return _request('record_camera', locals())


def record_microphone(
    save_to: str | None = 'auto',  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    duration: int = 30,  # Wall-clock limit in seconds: up to 60 in memory or 300 when saved.
    device_id: str = '',  # Microphone ID, or empty for the browser default.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a bounded microphone recording with its own temporary source.

    The operation closes its source when it finishes or fails.
    """
    return _request('record_microphone', locals())


def read_audio_levels(
    source_id: str,  # ID of an owned live browser source.
    window_ms: int = 250,  # Measurement window in milliseconds, from 1 through 1000.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Observe short RMS and peak levels without raw audio or transcription."""
    return _request('read_audio_levels', locals())


def setup_share() -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Show this notebook's local Share and Stop controls without capturing."""
    return _request('setup_share', {})


def start_share(
    audio: bool = False,  # Whether to request display audio, if the browser supports it.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Offer a user-clicked display chooser for this notebook."""
    return _request('start_share', locals())


def capture_screen(
    timeout: int = 15,  # Seconds to wait for a frame, from 1 through 60.
    source_id: str = '',  # Owned display ID, or empty when exactly one share is active.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    max_size: int = 1280,  # Maximum longest image edge in pixels, from 1 through 4096.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Capture one frame from an already shared display source."""
    return _request('capture_screen', locals())


def capture_tool(
    timeout: int = 15,  # Seconds to wait for a frame, from 1 through 60.
    source_id: str = '',  # Owned display ID, or empty when exactly one share is active.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    max_size: int = 1280,  # Maximum longest image edge in pixels, from 1 through 4096.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Capture-screen alias; model text receives a descriptor, not image pixels."""
    return _request('capture_tool', locals())


def stop_share(
    source_id: str = '',  # Owned display ID, or empty when exactly one share is active.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Stop a selected or unique shared display source."""
    return _request('stop_share', locals())


BROWSER_CAPTURE_TOOL_FUNCTIONS = {name: globals()[name] for name in CAPTURE_NAMES}

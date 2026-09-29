"""Direct and model-facing camera, microphone, recording and display tools."""

from __future__ import annotations

from typing import Any

from .browser_receipt import BrowserReceipt, request_browser_operation

CAPTURE_NAMES = (
    'list_media_sources', 'start_camera', 'start_microphone', 'capture_camera',
    'stop_source', 'start_recording', 'pause_recording', 'resume_recording',
    'stop_recording', 'record_camera', 'record_microphone', 'read_audio_levels',
    'setup_share', 'start_share', 'capture_screen', 'capture_tool', 'stop_share',
)


def _text(value: Any, name: str, *, empty: bool = False, maximum: int = 200) -> str:
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value):
        raise ValueError(f'{name} must be a {"possibly empty " if empty else "nonempty "}string')
    return value


def _integer(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f'{name} must be between {low} and {high}')
    return value


def _bool(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise TypeError(f'{name} must be true or false')
    return value


def _save_to(value: Any) -> str | None:
    if value is None:
        return None
    return _text(value, 'save_to', maximum=500)


def normalize_capture_action(name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
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


def _request(name: str, arguments: dict[str, Any]) -> BrowserReceipt:
    return request_browser_operation(name, normalize_capture_action(name, arguments))


def list_media_sources(kind: str = 'all', cursor: str = '', limit: int = 10) -> BrowserReceipt:
    """List camera and microphone devices without asking for permission."""
    return _request('list_media_sources', locals())


def start_camera(audio: bool = False, device_id: str = '', facing: str = 'user') -> BrowserReceipt:
    """Open a notebook camera preview, optionally including microphone audio."""
    return _request('start_camera', locals())


def start_microphone(device_id: str = '') -> BrowserReceipt:
    """Open a microphone source and local level meter."""
    return _request('start_microphone', locals())


def capture_camera(source_id: str = '', save_to: str | None = None, max_size: int = 1280) -> BrowserReceipt:
    """Capture a still from an owned camera, optionally saving it locally."""
    return _request('capture_camera', locals())


def stop_source(source_id: str) -> BrowserReceipt:
    """Stop an owned source and finalize its recording, if any."""
    return _request('stop_source', locals())


def start_recording(source_id: str, save_to: str | None = 'auto', duration: int = 30) -> BrowserReceipt:
    """Start one bounded recording from the source's declared tracks."""
    return _request('start_recording', locals())


def pause_recording(operation_id: str) -> BrowserReceipt:
    """Pause an active recording without resetting its wall-clock bound."""
    return _request('pause_recording', locals())


def resume_recording(operation_id: str) -> BrowserReceipt:
    """Resume a paused recording."""
    return _request('resume_recording', locals())


def stop_recording(operation_id: str) -> BrowserReceipt:
    """Flush and finish a recording at its selected destination."""
    return _request('stop_recording', locals())


def record_camera(save_to: str | None = 'auto', duration: int = 30, audio: bool = False,
                  facing: str = 'user') -> BrowserReceipt:
    """Open, record, and close a camera owned by this one operation."""
    return _request('record_camera', locals())


def record_microphone(save_to: str | None = 'auto', duration: int = 30,
                      device_id: str = '') -> BrowserReceipt:
    """Open, record, and close a microphone owned by this one operation."""
    return _request('record_microphone', locals())


def read_audio_levels(source_id: str, window_ms: int = 250) -> BrowserReceipt:
    """Observe short RMS and peak levels without raw audio or transcription."""
    return _request('read_audio_levels', locals())


def setup_share() -> BrowserReceipt:
    """Show this notebook's local Share and Stop controls without capturing."""
    return _request('setup_share', {})


def start_share(audio: bool = False) -> BrowserReceipt:
    """Offer a user-clicked display chooser for this notebook."""
    return _request('start_share', locals())


def capture_screen(timeout: int = 15, source_id: str = '', save_to: str | None = None,
                   max_size: int = 1280) -> BrowserReceipt:
    """Capture one frame from an already shared display source."""
    return _request('capture_screen', locals())


def capture_tool(timeout: int = 15, source_id: str = '', save_to: str | None = None,
                 max_size: int = 1280) -> BrowserReceipt:
    """Capture-screen alias; model text receives a descriptor, not image pixels."""
    return _request('capture_tool', locals())


def stop_share(source_id: str = '') -> BrowserReceipt:
    """Stop a selected or unique shared display source."""
    return _request('stop_share', locals())


BROWSER_CAPTURE_TOOL_FUNCTIONS = {name: globals()[name] for name in CAPTURE_NAMES}

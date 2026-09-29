"""Output family dispatch remains bounded and sends no synchronous browser RPC."""

import asyncio
import hashlib

import pytest

from nbinlineai import browser_receipt
from nbinlineai.browser_media import MediaRegistry
from nbinlineai.browser_output_tools import BROWSER_OUTPUT_TOOL_FUNCTIONS
from nbinlineai.frontend_bridge import normalize_action
from nbinlineai.tools import TOOL_FUNCTIONS, TOOL_GROUPS


class FakeComm:
    def __init__(self, **kwargs):
        self.request = kwargs['data']

    def on_msg(self, callback):
        self.message = callback

    def on_close(self, callback):
        self.closed = callback

    def close(self):
        pass


def test_output_family_registry_and_nonblocking_receipt(monkeypatch):
    channels = []
    monkeypatch.setattr(browser_receipt, '_origin', lambda: ('execute', 'cell'))
    monkeypatch.setattr(browser_receipt, 'create_comm', lambda **kwargs: channels.append(FakeComm(**kwargs)) or channels[-1])

    async def run():
        return TOOL_FUNCTIONS['list_outputs']('cell')

    receipt = asyncio.run(run())
    assert receipt.status == 'running'
    assert channels[0].request['name'] == 'list_outputs'
    assert channels[0].request['arguments'] == {'cell_id': 'cell', 'cursor': '', 'limit': 10}
    assert tuple(BROWSER_OUTPUT_TOOL_FUNCTIONS) == TOOL_GROUPS['browser_outputs']


@pytest.mark.parametrize('name,args', [
    ('read_notebook_view', {}), ('read_selection', {'max_chars': 2000}),
    ('list_outputs', {'cell_id': 'c'}),
    ('read_output', {'cell_id': 'c', 'output_id': 'o', 'revision': 0}),
    ('export_output', {'cell_id': 'c', 'output_id': 'o', 'revision': 0}),
    ('list_canvases', {'cell_id': 'c', 'output_id': 'o', 'revision': 0}),
    ('capture_canvas', {'canvas': {'canvas_id': 'v', 'cell_id': 'c', 'output_id': 'o',
                                  'revision': 0, 'view_revision': 0}}),
    ('export_canvas', {'canvas': {'canvas_id': 'v', 'cell_id': 'c', 'output_id': 'o',
                                 'revision': 0, 'view_revision': 0}}),
    ('start_canvas', {'canvas': {'canvas_id': 'v', 'cell_id': 'c', 'output_id': 'o',
                                'revision': 0, 'view_revision': 0}}),
    ('capture_notebook_region', {'cell_ids': ['c']}),
])
def test_output_model_actions_have_exact_allowlist(name, args):
    assert isinstance(normalize_action(name, args), dict)
    with pytest.raises(ValueError, match='Unexpected'):
        normalize_action(name, {**args, 'execute': True})


def test_output_model_action_rejects_crossing_limits():
    with pytest.raises(ValueError):
        normalize_action('read_output', {'cell_id': 'c', 'output_id': 'o', 'revision': -1})
    with pytest.raises(ValueError):
        normalize_action('capture_notebook_region', {'cell_ids': ['c', 'c']})
    with pytest.raises(ValueError):
        normalize_action('start_canvas', {'canvas': {'canvas_id': 'v'}, 'frame_rate': 61})


def test_data_resource_output_saves_exact_utf8_json_with_native_mime(tmp_path):
    registry = MediaRegistry(tmp_path)
    owner = registry.bind('session', 'kernel', 'notes/example.ipynb', 'model', 'client')
    operation = registry.create(owner, 'export-json', 'export_output', {})
    data = '{"label":"é😀"}'.encode()
    digest = hashlib.sha256(data).hexdigest()
    saved = registry.upload(owner, operation.id, data, 'application/vnd.dataresource+json',
                            digest, save_to='auto')['media']
    assert saved['mime_type'] == 'application/vnd.dataresource+json'
    assert saved['path'].startswith('notes/media/') and saved['path'].endswith('.json')
    assert (tmp_path / saved['path']).read_bytes() == data
    other = registry.create(owner, 'export-json-explicit', 'export_output', {})
    chosen = registry.upload(owner, other.id, data, 'application/vnd.dataresource+json',
                             digest, save_to='notes/exact.json')['media']
    assert chosen['path'] == 'notes/exact.json'


def test_data_resource_receipt_returns_utf8_bytes(monkeypatch):
    channels = []
    monkeypatch.setattr(browser_receipt, '_origin', lambda: ('execute', 'cell'))
    monkeypatch.setattr(browser_receipt, 'create_comm',
                        lambda **kwargs: channels.append(FakeComm(**kwargs)) or channels[-1])
    receipt = asyncio.run(_start_data_receipt())
    payload = '{"label":"é😀"}'.encode()
    media = {'media_id': 'data', 'bytes': len(payload),
             'sha256': hashlib.sha256(payload).hexdigest(),
             'mime_type': 'application/vnd.dataresource+json'}
    channels[0].message({'content': {'data': {'operation_id': 'data-op',
                                              'status': 'completed', 'media': media}},
                         'buffers': [payload]})
    assert receipt.status == 'completed'
    assert receipt.result == payload
    assert receipt.media['mime_type'] == 'application/vnd.dataresource+json'


async def _start_data_receipt():
    return browser_receipt.request_browser_operation('export_output', {})

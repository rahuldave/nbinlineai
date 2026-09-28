"""Kernel-side binary receipt decoding and integrity checks."""

import asyncio
import hashlib
import io

import pytest
from PIL import Image

from nbinlineai import browser_receipt
from nbinlineai.browser_media_tools import save_media


def png(color):
    image = Image.new('RGB', (2, 2), color)
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()


def test_explicit_save_rejects_none_before_opening_browser_comm():
    with pytest.raises(ValueError, match='None is invalid'):
        save_media({'media_id': 'known'}, save_to=None)


class FakeComm:
    def __init__(self):
        self.message = None
        self.closed = None
        self.did_close = False

    def on_msg(self, callback):
        self.message = callback

    def on_close(self, callback):
        self.closed = callback

    def close(self):
        self.did_close = True


def descriptor(data, media_id):
    return {'media_id': media_id, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'mime_type': 'image/png', 'width': 2, 'height': 2}


def create_receipt(monkeypatch):
    channel = FakeComm()
    monkeypatch.setattr(browser_receipt, '_origin', lambda: ('execute', 'cell'))
    monkeypatch.setattr(browser_receipt, 'create_comm', lambda **_: channel)
    async def start():
        return browser_receipt.request_browser_operation('fixture_image', {})
    return asyncio.run(start()), channel


def test_batch_binary_decodes_all_images(monkeypatch):
    receipt, channel = create_receipt(monkeypatch)
    first, second = png('red'), png('blue')
    channel.message({'content': {'data': {'operation_id': 'operation', 'status': 'completed',
                                          'media': [descriptor(first, 'first'), descriptor(second, 'second')]}},
                     'buffers': [first, second]})
    assert receipt.operation_id == 'operation'
    assert receipt.status == 'completed'
    assert [image.size for image in receipt.result] == [(2, 2), (2, 2)]
    assert channel.did_close


def test_byte_mismatch_fails_receipt(monkeypatch):
    receipt, channel = create_receipt(monkeypatch)
    original, changed = png('red'), png('blue')
    channel.message({'content': {'data': {'operation_id': 'operation', 'status': 'completed',
                                          'media': descriptor(original, 'first')}}, 'buffers': [changed]})
    assert receipt.status == 'failed'
    assert receipt.error['code'] == 'stale_target'
    assert receipt.result is None
    assert channel.did_close


def test_status_only_descriptor_does_not_materialize_bytes(monkeypatch):
    receipt, channel = create_receipt(monkeypatch)
    original = png('red')
    channel.message({'content': {'data': {'operation_id': 'operation', 'status': 'completed',
                                          'media': descriptor(original, 'first')}}, 'buffers': []})
    assert receipt.status == 'completed'
    assert receipt.result is None
    assert channel.did_close

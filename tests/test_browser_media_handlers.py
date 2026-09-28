"""Streaming HTTP admission and reservation regressions for browser media."""

import asyncio
import hashlib
import io
import json
import os
import socket
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch

from jupyter_server.auth.identity import IdentityProvider
from PIL import Image
from tornado.httpclient import AsyncHTTPClient, HTTPRequest
from tornado.iostream import IOStream, StreamClosedError
from tornado.testing import AsyncHTTPTestCase
from tornado.web import Application

from nbinlineai.browser_media import Media, MediaRegistry
from nbinlineai.handlers import BrowserMediaBytesHandler, BrowserMediaHandler


class _Sessions:
    async def get_session(self, *, session_id):
        return {'type': 'notebook', 'path': 'fixture.ipynb'}


class _Dispatcher:
    sessions = _Sessions()

    async def resolve(self, session_id):
        return 'kernel', object()


class _Authorizer:
    def __init__(self):
        self.allow = True

    def is_authorized(self, handler, user, action, resource):
        return self.allow


class BrowserMediaStreamTests(AsyncHTTPTestCase):
    def get_app(self):
        self._root = tempfile.TemporaryDirectory()
        self.registry = MediaRegistry(self._root.name)
        self.authorizer = _Authorizer()
        identity = IdentityProvider()
        identity.get_user = lambda handler: ('test-user' if handler.request.headers.get('Authorization') == 'Bearer test'
                                             else None)
        self.owner = self.registry.bind('session', 'kernel', 'fixture.ipynb', 'model', 'client')
        self.op = self.registry.create(self.owner, 'op-request', 'fixture_image', {})
        return Application(
            [(r'/nbinlineai/browser-media-bytes/([^/]+)', BrowserMediaBytesHandler,
              {'dispatcher': _Dispatcher(), 'media_registry': self.registry}),
             (r'/nbinlineai/browser-media/([a-z]+)', BrowserMediaHandler,
              {'dispatcher': _Dispatcher(), 'media_registry': self.registry})],
            authorizer=self.authorizer, identity_provider=identity, login_url='/login',
            base_url='/', cookie_secret='test-only', disable_check_xsrf=True
        )

    def tearDown(self):
        super().tearDown()
        self._root.cleanup()

    async def _partial(self, *, auth=True, secret=None, body=b'1234', client='client', operation_id=None):
        sock = socket.socket()
        stream = IOStream(sock)
        await stream.connect(('127.0.0.1', self.get_http_port()))
        headers = [
            f'POST /nbinlineai/browser-media-bytes/{operation_id or self.op.id} HTTP/1.1',
            f'Host: 127.0.0.1:{self.get_http_port()}',
            'Content-Type: image/png', 'Content-Length: 100',
            'X-NBInlineAI-Session: session', f'X-NBInlineAI-Client: {client}',
            'X-NBInlineAI-Model: model', f'X-NBInlineAI-Owner: {secret or self.owner.secret}',
        ]
        if auth:
            headers.append('Authorization: Bearer test')
        await stream.write(('\r\n'.join(headers) + '\r\n\r\n').encode() + body)
        return stream

    async def _command(self, command, body):
        request = HTTPRequest(self.get_url(f'/nbinlineai/browser-media/{command}'), method='POST',
                              headers={'Authorization': 'Bearer test', 'X-NBInlineAI-Owner': self.owner.secret,
                                       'Content-Type': 'application/json'}, body=json.dumps({
                                           'session_id': 'session', 'client_id': 'client', 'model_id': 'model', **body
                                       }))
        return await AsyncHTTPClient().fetch(request, raise_error=False)

    def test_admission_precedes_streamed_body_and_disconnection_releases_reservation(self):
        async def check():
            denied = await self._partial(auth=False)
            response = await denied.read_until(b'\r\n\r\n')
            assert b'403' in response
            assert self.registry.inflight_bytes == 0
            denied.close()

            wrong = await self._partial(secret='wrong')
            response = await wrong.read_until(b'\r\n\r\n')
            assert b'409' in response
            assert self.registry.inflight_bytes == 0
            wrong.close()

            held = await self._partial()
            for _ in range(20):
                if self.registry.inflight_bytes == 4:
                    break
                await asyncio.sleep(0.01)
            assert self.registry.inflight_bytes == 4
            held.close()
            for _ in range(20):
                if self.registry.inflight_bytes == 0:
                    break
                await asyncio.sleep(0.01)
            assert self.registry.inflight_bytes == 0

        self.io_loop.run_sync(check)

    def test_control_without_owner_secret_fails_closed(self):
        async def check():
            owners_before = len(self.registry.owners)
            request = HTTPRequest(self.get_url('/nbinlineai/browser-media/create'), method='POST',
                                  headers={'Authorization': 'Bearer test', 'Content-Type': 'application/json'},
                                  body=json.dumps({'session_id': 'session', 'client_id': 'unbound-client',
                                                   'model_id': 'model', 'request_id': 'first',
                                                   'name': 'save_media', 'arguments': {}}))
            response = await AsyncHTTPClient().fetch(request, raise_error=False)
            assert response.code == 409
            assert json.loads(response.body)['error']['code'] == 'stale_target'
            assert len(self.registry.owners) == owners_before

        self.io_loop.run_sync(check)

    def test_stored_bytes_and_inflight_share_one_budget(self):
        async def check():
            self.registry.media['stored'] = Media('stored', self.owner, b'x' * 12,
                                                  'application/octet-stream', '0' * 64,
                                                  self.registry._now() + 600)
            # Patch the module cap to a small value so no large allocation is needed.
            from unittest.mock import patch
            with patch('nbinlineai.browser_media.MAX_SERVER_BYTES', 16):
                held = await self._partial(body=b'1234')
                for _ in range(20):
                    if self.registry.inflight_bytes == 4:
                        break
                    await asyncio.sleep(0.01)
                assert self.registry.inflight_bytes == 4
                denied = await self._partial(body=b'5')
                try:
                    response = await denied.read_until(b'\r\n\r\n')
                    assert b'413' in response
                except StreamClosedError:
                    pass  # Tornado may close a streaming request at the body limit.
                denied.close()
                held.close()
                await asyncio.sleep(0.03)
                assert self.registry.inflight_bytes == 0

        self.io_loop.run_sync(check)

    def test_two_clients_of_one_notebook_share_ingress_budget(self):
        async def check():
            second = self.registry.bind('session', 'kernel', 'fixture.ipynb', 'model', 'second')
            second_op = self.registry.create(second, 'second-upload', 'fixture_image', {})
            with patch('nbinlineai.browser_media.MAX_NOTEBOOK_BYTES', 4):
                held = await self._partial(body=b'1234')
                for _ in range(20):
                    if self.registry.inflight_bytes == 4:
                        break
                    await asyncio.sleep(0.01)
                assert self.registry.inflight_by_session['session'] == 4
                denied = await self._partial(body=b'5', client='second', secret=second.secret,
                                             operation_id=second_op.id)
                try:
                    response = await denied.read_until(b'\r\n\r\n')
                    assert b'413' in response
                except StreamClosedError:
                    pass
                denied.close()
                held.close()
                await asyncio.sleep(0.03)
                assert self.registry.inflight_by_session == {}

        self.io_loop.run_sync(check)

    def test_concurrent_save_posts_deduplicate_and_cancel_during_worker_save(self):
        async def check():
            image = Image.new('RGB', (2, 2), 'red')
            stream = io.BytesIO()
            image.save(stream, format='PNG')
            data = stream.getvalue()
            await asyncio.to_thread((Path(self._root.name) / 'source.png').write_bytes, data)
            reference = {'path': 'source.png', 'sha256': hashlib.sha256(data).hexdigest()}
            entered = threading.Event()
            resume = threading.Event()
            real_save = self.registry._save

            def stalled(*args, **kwargs):
                entered.set()
                assert resume.wait(3)
                return real_save(*args, **kwargs)

            body = {'request_id': 'same', 'media': reference, 'save_to': 'auto'}
            registered = self.registry.create(self.owner, 'same', 'save_media',
                                              {'media': reference, 'save_to': 'auto'})
            self.registry.transition(self.owner, registered.id, 'saving')
            with patch.object(self.registry, '_save', stalled):
                first = asyncio.create_task(self._command('save', body))
                for _ in range(30):
                    if entered.is_set():
                        break
                    await asyncio.sleep(0.01)
                assert entered.is_set()
                assert self.registry.status(self.owner, registered.id)['status'] == 'saving'
                second = asyncio.create_task(self._command('save', body))
                await asyncio.sleep(0.03)
                resume.set()
                a, b = await asyncio.gather(first, second)
            assert a.code == b.code == 200
            assert json.loads(a.body) == json.loads(b.body)
            assert len(list(Path(self._root.name).rglob('capture-*.png'))) == 1

            entered.clear()
            resume.clear()
            with patch.object(self.registry, '_save', stalled):
                pending = asyncio.create_task(self._command('save', {
                    'request_id': 'cancelled', 'media': reference, 'save_to': 'auto'
                }))
                for _ in range(30):
                    if entered.is_set():
                        break
                    await asyncio.sleep(0.01)
                assert entered.is_set()
                op_id = self.registry.requests[(self.owner, 'cancelled')]
                cancelled = await self._command('cancel', {'operation_id': op_id})
                assert json.loads(cancelled.body)['status'] == 'cancelled'
                resume.set()
                failed = await pending
            assert failed.code != 200
            assert self.registry.operations[op_id].status == 'cancelled'
            assert len(list(Path(self._root.name).rglob('capture-*.png'))) == 1

        self.io_loop.run_sync(check)

    def test_finishbatch_http_cancel_wins_over_staged_worker_save(self):
        async def check():
            image = Image.new('RGB', (2, 2), 'blue')
            stream = io.BytesIO()
            image.save(stream, format='PNG')
            data = stream.getvalue()
            op = self.registry.create(self.owner, 'batch', 'extract_frames', {})
            self.registry.begin_batch(self.owner, op.id, 1)
            self.registry.upload_part(self.owner, op.id, 0, data, 'image/png', hashlib.sha256(data).hexdigest())
            entered = threading.Event()
            resume = threading.Event()
            real_save = self.registry._save

            def stalled(*args, **kwargs):
                entered.set()
                assert resume.wait(3)
                return real_save(*args, **kwargs)

            with patch.object(self.registry, '_save', stalled):
                final = asyncio.create_task(self._command('finishbatch', {
                    'operation_id': op.id, 'save_to': 'frames'
                }))
                for _ in range(30):
                    if entered.is_set():
                        break
                    await asyncio.sleep(0.01)
                assert entered.is_set()
                cancelled = await self._command('cancel', {'operation_id': op.id})
                assert json.loads(cancelled.body)['status'] == 'cancelled'
                resume.set()
                response = await final
            assert response.code != 200
            assert op.status == 'cancelled'
            assert not list(Path(self._root.name).rglob('*.png'))
            assert not self.registry.media

        self.io_loop.run_sync(check)

    def test_finishbatch_http_rollback_stays_in_original_directory(self):
        async def check():
            image = Image.new('RGB', (2, 2), 'green')
            stream = io.BytesIO()
            image.save(stream, format='PNG')
            data = stream.getvalue()
            op = self.registry.create(self.owner, 'batch-rollback', 'extract_frames', {})
            self.registry.begin_batch(self.owner, op.id, 2)
            digest = hashlib.sha256(data).hexdigest()
            self.registry.upload_part(self.owner, op.id, 0, data, 'image/png', digest)
            self.registry.upload_part(self.owner, op.id, 1, data, 'image/png', digest)
            outside = Path(self._root.name) / 'outside'
            outside.mkdir()
            victim = outside / 'part-01.png'
            victim.write_bytes(b'outside-victim')
            real_save = self.registry._save
            saves = 0

            def swap_then_fail(*args, **kwargs):
                nonlocal saves
                saves += 1
                if saves == 2:
                    os.rename(Path(self._root.name) / 'frames', Path(self._root.name) / 'parked')
                    (Path(self._root.name) / 'frames').symlink_to(outside, target_is_directory=True)
                    raise RuntimeError('second publication failed')
                return real_save(*args, **kwargs)

            with patch.object(self.registry, '_save', swap_then_fail):
                response = await self._command('finishbatch', {
                    'operation_id': op.id, 'save_to': 'frames'
                })
            assert response.code != 200
            assert op.status == 'failed'
            assert victim.read_bytes() == b'outside-victim'
            assert not (Path(self._root.name) / 'parked' / 'part-01.png').exists()
            assert not self.registry.media

        self.io_loop.run_sync(check)

"""Authenticated owner proof stays outside notebook snapshots and model text."""

import hashlib
import io
import json
import tempfile

from jupyter_server.auth.identity import IdentityProvider
from PIL import Image
from tornado.testing import AsyncHTTPTestCase
from tornado.web import Application

from nbinlineai.browser_media import Media, MediaRegistry
from nbinlineai.handlers import BrowserMediaHandler, ContextPreviewHandler


class Sessions:
    async def get_session(self, *, session_id):
        return {'id': session_id, 'type': 'notebook', 'path': 'notes/example.ipynb'}


class Dispatcher:
    sessions = Sessions()

    def __init__(self):
        self.kernel = object()

    async def resolve(self, session_id):
        return 'kernel', self.kernel

    def preview_ready(self, kernel_id, kernel):
        return True


class Authorizer:
    def is_authorized(self, handler, user, action, resource):
        return True


class AttachmentHttpTests(AsyncHTTPTestCase):
    def get_app(self):
        self.root = tempfile.TemporaryDirectory()
        self.registry = MediaRegistry(self.root.name)
        self.dispatcher = Dispatcher()
        self.owner = self.registry.bind('session', 'kernel', 'notes/example.ipynb', 'model', 'client')
        image = Image.new('RGB', (2, 2), 'blue')
        stream = io.BytesIO()
        image.save(stream, format='PNG')
        data = stream.getvalue()
        digest = hashlib.sha256(data).hexdigest()
        self.registry.media['still'] = Media('still', self.owner, data, 'image/png', digest,
                                             self.registry._now() + 600)
        self.reference = {'media_id': 'still'}
        self.operation = self.registry.create(self.owner, 'attach', 'attach_media',
                                              {'media': self.reference, 'question_cell_id': 'question',
                                               'detail': 'auto'}, waiting=True)
        identity = IdentityProvider()
        identity.get_user = lambda handler: ('test-user' if handler.request.headers.get('Authorization') == 'Bearer test'
                                             else None)
        return Application(
            [(r'/nbinlineai/browser-media/([a-z]+)', BrowserMediaHandler,
              {'dispatcher': self.dispatcher, 'media_registry': self.registry}),
             (r'/nbinlineai/context-preview', ContextPreviewHandler,
              {'dispatcher': self.dispatcher, 'media_registry': self.registry})],
            identity_provider=identity, authorizer=Authorizer(), login_url='/login',
            base_url='/', cookie_secret='synthetic', disable_check_xsrf=True)

    def tearDown(self):
        super().tearDown()
        self.root.cleanup()

    def headers(self, secret=None):
        return {'Authorization': 'Bearer test', 'Content-Type': 'application/json',
                'X-NBInlineAI-Owner': secret or self.owner.secret,
                'X-NBInlineAI-Client': 'client', 'X-NBInlineAI-Model': 'model'}

    def test_grant_and_preview_require_exact_live_owner(self):
        body = {'session_id': 'session', 'client_id': 'client', 'model_id': 'model',
                'operation_id': self.operation.id, 'media': self.reference,
                'question_cell_id': 'question', 'detail': 'auto'}
        stolen = self.fetch('/nbinlineai/browser-media/grantattachment', method='POST',
                            headers=self.headers('stolen'), body=json.dumps(body))
        assert stolen.code == 409
        granted = self.fetch('/nbinlineai/browser-media/grantattachment', method='POST',
                             headers=self.headers(), body=json.dumps(body))
        assert granted.code == 200
        result = json.loads(granted.body)
        assert result['sha256'] == self.registry.media['still'].sha256
        assert 'owner_secret' not in granted.body.decode()
        confirmation = {key: value for key, value in result.items() if key != 'display'}
        self.registry.transition(self.owner, self.operation.id, 'completed', {'confirmed': True})
        preview = {'session_id': 'session', 'prompt_cell_id': 'question',
                   'prompt': 'What is shown?', 'snapshot_version': 1,
                   'backend': 'openai_api', 'model': 'gpt-6-sol',
                   'context_mode': 'current-only', 'notebook_cells': [{
                       'id': 'question', 'cell_type': 'markdown', 'source': 'What is shown?',
                       'metadata': {'nbinlineai': {'isPromptCell': True,
                                                   'mediaAttachment': confirmation}}}]}
        missing = self.fetch('/nbinlineai/context-preview', method='POST',
                             headers={'Authorization': 'Bearer test', 'Content-Type': 'application/json'},
                             body=json.dumps(preview))
        assert missing.code == 400
        stolen = self.fetch('/nbinlineai/context-preview', method='POST',
                            headers=self.headers('stolen'), body=json.dumps(preview))
        assert stolen.code == 400
        accepted = self.fetch('/nbinlineai/context-preview', method='POST',
                              headers=self.headers(), body=json.dumps(preview))
        assert accepted.code == 200
        report = json.loads(accepted.body)
        assert report['round_wire_chars'] > 0
        assert 'owner_secret' not in accepted.body.decode()
        revoke = {'session_id': 'session', 'client_id': 'client', 'model_id': 'model',
                  'question_cell_id': 'question', 'grant_id': result['grant_id']}
        denied = self.fetch('/nbinlineai/browser-media/revokeattachment', method='POST',
                            headers=self.headers('stolen'), body=json.dumps(revoke))
        assert denied.code == 409
        removed = self.fetch('/nbinlineai/browser-media/revokeattachment', method='POST',
                             headers=self.headers(), body=json.dumps(revoke))
        assert removed.code == 200
        assert result['grant_id'] not in self.registry.attachment_grants
        expired = self.fetch('/nbinlineai/context-preview', method='POST',
                             headers=self.headers(), body=json.dumps(preview))
        assert expired.code == 400

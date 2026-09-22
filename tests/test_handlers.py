"""HTTP contract tests for authentication, authorization, and SSE failures."""

import asyncio
import json
from unittest.mock import patch

from aidialog.msg_parts import Completion, Msg, Text
from tornado.testing import AsyncHTTPTestCase
from tornado.web import Application

from nbinlineai.handlers import PromptHandler, StatusHandler


class _Authorizer:
    def __init__(self):
        self.allow = True
        self.calls = []

    def is_authorized(self, handler, user, action, resource):
        self.calls.append((action, resource))
        return self.allow


class _Dispatcher:
    async def resolve(self, session_id):
        return "kernel-1", object()


class _Prompt(PromptHandler):
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class _Status(StatusHandler):
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class HandlerTests(AsyncHTTPTestCase):
    def get_app(self):
        self.authorizer = _Authorizer()
        return Application(
            [
                (r"/nbinlineai/prompt", _Prompt, {"dispatcher": _Dispatcher()}),
                (r"/nbinlineai/status", _Status),
            ],
            authorizer=self.authorizer,
            login_url="/login",
            base_url="/",
            allow_origin="*",
        )

    def _post(self, body, auth=True):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer test"
        return self.fetch("/nbinlineai/prompt", method="POST", body=json.dumps(body), headers=headers,
                          follow_redirects=False)

    def test_auth_and_execute_permission(self):
        response = self._post({}, auth=False)
        assert response.code != 200
        self.authorizer.allow = False
        response = self._post({})
        assert response.code == 403
        assert self.authorizer.calls == [("execute", "kernels")]

    def test_bad_json_body_rejected_before_stream(self):
        response = self._post({})
        assert response.code == 400
        assert response.headers["Content-Type"].startswith("application/json")

    def test_status_does_not_expose_secret(self):
        response = self.fetch("/nbinlineai/status", headers={"Authorization": "Bearer test"})
        assert response.code == 200
        status = json.loads(response.body)
        assert status["extension"] == "nbinlineai"
        assert "api_key" not in response.body.decode().lower()

    def test_missing_provider_key_rejected_before_stream(self):
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_api"}
        with patch("nbinlineai.prompt.provider_status", return_value={"openai_api": {"configured": False}}):
            response = self._post(body)
        assert response.code == 400
        assert b"not configured" in response.body

    def test_sse_done_and_error(self):
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_api"}

        async def answer(*_args):
            return Completion("test-model", Msg("assistant", [Text("Hello back")]))

        async def fail(*_args):
            raise RuntimeError("private transport details")

        with patch("nbinlineai.prompt.provider_status", return_value={"openai_api": {"configured": True}}), patch(
            "nbinlineai.providers.complete", answer
        ):
            response = self._post(body)
        assert response.code == 200
        events = [json.loads(line.removeprefix("data: ")) for line in response.body.decode().splitlines() if line.startswith("data: ")]
        assert [event["type"] for event in events] == ["context", "text_delta", "done"]
        assert events[1]["text"] == "Hello back"
        with patch("nbinlineai.prompt.provider_status", return_value={"openai_api": {"configured": True}}), patch(
            "nbinlineai.providers.complete", fail
        ):
            response = self._post(body)
        events = [json.loads(line.removeprefix("data: ")) for line in response.body.decode().splitlines() if line.startswith("data: ")]
        assert [event["type"] for event in events] == ["context", "error"]
        assert "private transport details" not in response.body.decode()

    def test_cancelled_prompt_ends_without_server_error(self):
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_api"}

        async def cancelled(*_args):
            yield {"type": "context", "code_cells": 0}
            raise asyncio.CancelledError

        with patch("nbinlineai.prompt.provider_status", return_value={"openai_api": {"configured": True}}), patch(
            "nbinlineai.handlers.run_prompt", cancelled
        ):
            response = self._post(body)
        assert response.code == 200
        assert b'"type": "context"' in response.body
        assert b'"type": "error"' not in response.body

"""HTTP contract tests for authentication, authorization, and SSE failures."""

import asyncio
import json
import os
import tempfile
from unittest.mock import patch

from aidialog.msg_parts import Completion, Msg, Text
from fastllm.acomplete import ContextWindowExceededError as ProviderContextWindowExceededError
from fasttransport.errors import APIError
from tornado.testing import AsyncHTTPTestCase
from tornado.web import Application

from nbinlineai import __version__
from nbinlineai.handlers import (
    ContextPreviewHandler,
    KeySettingsHandler,
    KeySettingsItemHandler,
    PromptHandler,
    StatusHandler,
    setup_handlers,
)


class _Authorizer:
    def __init__(self):
        self.allow = True
        self.calls = []

    def is_authorized(self, handler, user, action, resource):
        self.calls.append((action, resource))
        return self.allow


class _Dispatcher:
    def __init__(self):
        self.kernel = type("Kernel", (), {"execution_state": "idle"})()

    async def resolve(self, session_id):
        return "kernel-1", self.kernel

    async def inspect_preview(self, kernel_id, kernel, variables, functions):
        return {}

    def preview_ready(self, kernel_id, kernel):
        return kernel.execution_state == "idle"


class _Prompt(PromptHandler):
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class _Preview(ContextPreviewHandler):
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class _Status(StatusHandler):
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class _Keys(KeySettingsHandler):
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class _KeyItem(KeySettingsItemHandler):
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class HandlerTests(AsyncHTTPTestCase):
    def get_app(self):
        self._key_home = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = self._key_home.name
        self.authorizer = _Authorizer()
        self.dispatcher = _Dispatcher()
        return Application(
            [
                (r"/nbinlineai/prompt", _Prompt, {"dispatcher": self.dispatcher}),
                (r"/nbinlineai/context-preview", _Preview, {"dispatcher": self.dispatcher}),
                (r"/nbinlineai/status", _Status),
                (r"/nbinlineai/settings/keys", _Keys),
                (r"/nbinlineai/settings/keys/([^/]+)", _KeyItem),
            ],
            authorizer=self.authorizer,
            login_url="/login",
            base_url="/",
            allow_origin="*",
        )

    def tearDown(self):
        super().tearDown()
        if self._old_xdg is None:
            os.environ.pop("XDG_CONFIG_HOME", None)
        else:
            os.environ["XDG_CONFIG_HOME"] = self._old_xdg
        self._key_home.cleanup()

    def _post(self, body, auth=True):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer test"
        return self.fetch("/nbinlineai/prompt", method="POST", body=json.dumps(body), headers=headers,
                          follow_redirects=False)

    def test_preview_is_authenticated_and_has_cell_ids_without_provider_key(self):
        body = {"snapshot_version": 1, "notebook_cells": [
            {"id": "note", "cell_type": "markdown", "source": "Hello"},
            {"id": "p", "cell_type": "markdown", "source": "Question",
             "metadata": {"nbinlineai": {"isPromptCell": True}}},
        ], "context_mode": "all-above", "prompt": "Question", "session_id": "s",
            "prompt_cell_id": "p", "preview_generation": "rev-1"}
        headers = {"Content-Type": "application/json", "Authorization": "Bearer test"}
        unauthorized = self.fetch("/nbinlineai/context-preview", method="POST",
                                  body=json.dumps(body), headers={"Content-Type": "application/json"},
                                  follow_redirects=False)
        assert unauthorized.code != 200
        response = self.fetch("/nbinlineai/context-preview", method="POST",
                              body=json.dumps(body), headers=headers)
        assert response.code == 200
        report = json.loads(response.body)
        assert report["included_cell_ids"] == ["note"]
        assert report["snapshot_generation"] == "rev-1"
        assert report["tools"] == []

        self.dispatcher.kernel.execution_state = "busy"
        busy = self.fetch("/nbinlineai/context-preview", method="POST",
                          body=json.dumps(body), headers=headers)
        assert busy.code == 409
        assert b"Kernel is busy" in busy.body

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

    def test_invalid_prompt_mode_is_http_400(self):
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_api", "prompt_mode": "verbose"}
        response = self._post(body)
        assert response.code == 400
        assert b"prompt_mode must be one of: compact, full, learning" in response.body

    def test_custom_instructions_and_effort_invalid_without_echoing_input(self):
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_api", "model": "gpt-6-sol"}
        secret = "private-test-value"
        response = self._post({**body, "prompt_instructions": secret * 500})
        assert response.code == 400
        assert secret.encode() not in response.body
        # Exercise effort validation without depending on a developer's keys.
        with patch("nbinlineai.prompt.provider_status",
                   return_value={"openai_api": {"configured": True}}):
            response = self._post({**body, "reasoning_effort": "unavailable"})
        assert response.code == 400
        assert b"reasoning_effort" in response.body

    def test_status_does_not_expose_secret(self):
        response = self.fetch("/nbinlineai/status", headers={"Authorization": "Bearer test"})
        assert response.code == 200
        status = json.loads(response.body)
        assert status["extension"] == "nbinlineai"
        assert set(status["prompt_mode_instructions"]) == {"compact", "full", "learning"}
        assert status["model_capabilities"]["openai_api"]["gpt-6-sol"]["default_effort"] == "medium"
        assert status["model_capabilities"]["anthropic_api"]["claude-haiku-4-5-20251001"]["efforts"] == []
        assert "api_key" not in response.body.decode().lower()

    def test_missing_provider_key_rejected_before_stream(self):
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_api"}
        with patch("nbinlineai.prompt.provider_status", return_value={"openai_api": {"configured": False}}):
            response = self._post(body)
        assert response.code == 400
        assert b"not configured" in response.body

    def test_subscription_without_runtime_is_rejected_before_stream(self):
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_codex_subscription", "model": "synthetic-model"}
        response = self._post(body)
        assert response.code == 400
        assert b"ChatGPT subscription connection is unavailable" in response.body

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

    def test_key_settings_auth_permissions_and_never_echo_key(self):
        headers = {"Content-Type": "application/json", "Authorization": "Bearer test"}
        body = json.dumps({"backend": "openai_api", "key": "test-saved-secret-key"})
        denied = self.fetch("/nbinlineai/settings/keys", method="POST", body=body,
                            headers={"Content-Type": "application/json"}, follow_redirects=False)
        assert denied.code != 200
        self.authorizer.allow = False
        denied = self.fetch("/nbinlineai/settings/keys", method="POST", body=body, headers=headers)
        assert denied.code == 403
        self.authorizer.allow = True
        saved = self.fetch("/nbinlineai/settings/keys", method="POST", body=body, headers=headers)
        assert saved.code == 200
        assert b"test-saved-secret-key" not in saved.body
        assert json.loads(saved.body)["providers"]["openai_api"]["source"] == "saved"
        read = self.fetch("/nbinlineai/settings/keys", headers=headers)
        assert b"test-saved-secret-key" not in read.body
        deleted = self.fetch("/nbinlineai/settings/keys/openai_api", method="DELETE", headers=headers)
        assert deleted.code == 200
        assert json.loads(deleted.body)["providers"]["openai_api"]["source"] != "saved"

    def test_custom_shared_identity_provider_rejected(self):
        self._app.settings["identity_provider"] = object()
        headers = {"Content-Type": "application/json", "Authorization": "Bearer test"}
        body = json.dumps({"backend": "openai_api", "key": "test-saved-secret-key"})
        response = self.fetch("/nbinlineai/settings/keys", method="POST", body=body, headers=headers)
        assert response.code == 403

    def test_invalid_key_backend_and_provider_errors_are_sanitized(self):
        headers = {"Content-Type": "application/json", "Authorization": "Bearer test"}
        bad = self.fetch("/nbinlineai/settings/keys", method="POST",
                         body=json.dumps({"backend": None, "key": "test-saved-secret-key"}), headers=headers)
        assert bad.code == 400
        assert b"test-saved-secret-key" not in bad.body
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_api"}
        for code, expected in ((401, "API key rejected"), (429, "rate limit"), (404, "model is unavailable")):
            async def fail(*_args, status_code=code):
                raise APIError("test-saved-secret-key", status_code=status_code,
                               raw={"secret": "test-saved-secret-key"})

            with patch("nbinlineai.prompt.provider_status", return_value={"openai_api": {"configured": True}}), patch(
                "nbinlineai.providers.complete", fail
            ):
                response = self._post(body)
            assert response.code == 200
            assert expected.encode() in response.body
            assert b"test-saved-secret-key" not in response.body

    def test_provider_context_overflow_is_actionable_and_sanitized(self):
        body = {"prompt": "Hello", "session_id": "s", "prompt_cell_id": "p", "preceding_cells": [],
                "backend": "openai_api"}

        async def fail(*_args):
            raise ProviderContextWindowExceededError(
                "private-test-value exceeded provider context", status_code=400,
                raw={"secret": "private-test-value"},
            )

        with patch("nbinlineai.prompt.provider_status", return_value={
            "openai_api": {"configured": True}
        }), patch("nbinlineai.providers.complete", fail):
            response = self._post(body)
        events = [json.loads(line.removeprefix("data: ")) for line in
                  response.body.decode().splitlines() if line.startswith("data: ")]
        assert [event["type"] for event in events] == ["context", "error"]
        assert "context window exceeded" in events[-1]["message"]
        assert "Shorten the prompt" in events[-1]["message"]
        assert b"private-test-value" not in response.body


class NonRootRoutesTests(AsyncHTTPTestCase):
    def get_app(self):
        self._key_home = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = self._key_home.name
        app = Application([], authorizer=_Authorizer(), login_url="/login", base_url="/user/student/",
                          allow_origin="*", session_manager=object(), kernel_manager=object())
        with patch("nbinlineai.handlers.StatusHandler", _Status), patch(
            "nbinlineai.handlers.PromptHandler", _Prompt
        ), patch("nbinlineai.handlers.KeySettingsHandler", _Keys), patch(
            "nbinlineai.handlers.KeySettingsItemHandler", _KeyItem
        ):
            setup_handlers(app)
        return app

    def tearDown(self):
        super().tearDown()
        if self._old_xdg is None:
            os.environ.pop("XDG_CONFIG_HOME", None)
        else:
            os.environ["XDG_CONFIG_HOME"] = self._old_xdg
        self._key_home.cleanup()

    def test_key_settings_route_with_nested_base_url(self):
        headers = {"Content-Type": "application/json", "Authorization": "Bearer test"}
        status = self.fetch("/user/student/nbinlineai/status", headers=headers)
        assert status.code == 200
        data = json.loads(status.body)
        assert data["providers"]["openai_api"]["default_model"] == "gpt-6-sol"
        assert data["providers"]["anthropic_api"]["models"][0] == "claude-sonnet-5"
        assert data["version"] == __version__
        saved = self.fetch("/user/student/nbinlineai/settings/keys", method="POST", headers=headers,
                           body=json.dumps({"backend": "anthropic_api", "key": "test-anthropic-key"}))
        assert saved.code == 200
        assert json.loads(saved.body)["providers"]["anthropic_api"]["source"] == "saved"
        assert self.fetch("/nbinlineai/settings/keys", headers=headers).code == 404

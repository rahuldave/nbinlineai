"""Authenticated account and project-scope route contract, without a live login."""

import asyncio
import json
import os
import tempfile
from types import SimpleNamespace

from aidialog.msg_parts import Completion, Msg, Text, ToolUse
from jupyter_server.services.contents.filemanager import FileContentsManager
from tornado.testing import AsyncHTTPTestCase
from tornado.web import Application

from nbinlineai import NbinlineaiExtension, _jupyter_server_extension_points
from nbinlineai.context_budget import json_chars, messages_chars
from nbinlineai.handlers import (
    ContextPreviewHandler,
    PromptHandler,
    StatusHandler,
    SubscriptionDisconnectHandler,
    SubscriptionFileAccessHandler,
    SubscriptionLoginCancelHandler,
    SubscriptionLoginHandler,
    SubscriptionStatusHandler,
    SubscriptionUsageHandler,
    _safe_subscription_status,
)
from nbinlineai.notebook_scope import NotebookScopeResolver


class _Authorizer:
    allow = True

    def is_authorized(self, _handler, _user, _action, _resource):
        return self.allow


class _Authenticated:
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class _Status(_Authenticated, SubscriptionStatusHandler):
    pass


class _TopStatus(_Authenticated, StatusHandler):
    pass


class _Prompt(_Authenticated, PromptHandler):
    pass


class _Preview(_Authenticated, ContextPreviewHandler):
    pass


class _Login(_Authenticated, SubscriptionLoginHandler):
    pass


class _Cancel(_Authenticated, SubscriptionLoginCancelHandler):
    pass


class _Disconnect(_Authenticated, SubscriptionDisconnectHandler):
    pass


class _Usage(_Authenticated, SubscriptionUsageHandler):
    pass


class _FileAccess(_Authenticated, SubscriptionFileAccessHandler):
    pass


class _Sessions:
    def __init__(self):
        self.path = "week2/lesson.ipynb"

    async def get_session(self, *, session_id):
        if session_id != "session-one":
            raise ValueError("Unknown session")
        return {"id": session_id, "type": "notebook", "path": self.path}


class _Dispatcher:
    def __init__(self, sessions):
        self.sessions = sessions
        self.kernel = object()
        self.tool_calls = []

    async def resolve(self, session_id):
        assert session_id == "session-one"
        return "kernel-one", self.kernel

    def preview_ready(self, _kernel_id, _kernel):
        return True

    async def inspect(self, _kernel_id, _kernel, _variables, functions):
        return {name: {"parameters": {"n": {"type": "int"}}} for name in functions}

    async def call(self, session_id, kernel_id, kernel, allowed, name, arguments):
        self.tool_calls.append((session_id, kernel_id, kernel, allowed, name, arguments))
        return "2"


class _Manager:
    def __init__(self):
        self.calls = []
        self.auth_mode = "chatgpt"
        self.plan_tool = False

    async def status(self):
        return {
            "state": "connected", "configured": True, "auth_mode": self.auth_mode,
            "account": {"email": "synthetic@example.test", "secret": "never-expose"},
            "models": [{"id": "synthetic-model", "efforts": ["low"]}],
            "usage": {"state": "unavailable"},
            "access_token": "never-expose",
        }

    async def start_login(self, method):
        self.calls.append(("login", method))
        return {"login_id": "login-one", "state": "connecting", "auth_url": "https://example.test/sign-in"}

    async def cancel_login(self, login_id):
        if login_id != "login-one":
            raise ValueError("ChatGPT sign-in is not active")
        self.calls.append(("cancel", login_id))

    async def disconnect(self):
        self.calls.append(("disconnect",))

    async def usage(self):
        self.calls.append(("usage",))
        return {"state": "unavailable"}

    def round_wire_cost(self, messages, tools):
        return messages_chars(messages) + json_chars(tools) + 100

    async def complete_round(self, model, messages, tools, *, reasoning_effort, scope, run_id):
        self.calls.append(("round", model, reasoning_effort, scope, run_id, messages, tools))
        if self.plan_tool and sum(call[0] == "round" for call in self.calls) == 1:
            return Completion(model, Msg("assistant", [ToolUse(
                id="tool-one", name="add", arguments={"n": 1},
            )]))
        return Completion(model, Msg("assistant", [Text("synthetic subscription answer")]))

    async def cancel(self, run_id):
        self.calls.append(("run-cancel", run_id))

    async def close(self):
        self.calls.append(("close",))


class SubscriptionRouteTests(AsyncHTTPTestCase):
    def get_app(self):
        self._storage = tempfile.TemporaryDirectory()
        self._old_xdg = os.environ.get("XDG_CONFIG_HOME")
        os.environ["XDG_CONFIG_HOME"] = self._storage.name
        course = os.path.join(self._storage.name, "course")
        os.makedirs(os.path.join(course, "week2"))
        with open(os.path.join(course, "week2", "lesson.ipynb"), "w", encoding="utf-8") as stream:
            stream.write("{}")
        self.authorizer = _Authorizer()
        self.sessions = _Sessions()
        self.dispatcher = _Dispatcher(self.sessions)
        self.manager = _Manager()
        self.args = {
            "dispatcher": self.dispatcher,
            "scope_resolver": NotebookScopeResolver(FileContentsManager(root_dir=course)),
            "subscription_manager": self.manager,
        }
        return Application([
            (r"/nbinlineai/status", _TopStatus, {"subscription_manager": self.manager}),
            (r"/nbinlineai/prompt", _Prompt, self.args),
            (r"/nbinlineai/context-preview", _Preview, self.args),
            (r"/nbinlineai/subscription/status", _Status, self.args),
            (r"/nbinlineai/subscription/login", _Login, self.args),
            (r"/nbinlineai/subscription/login/cancel", _Cancel, self.args),
            (r"/nbinlineai/subscription/disconnect", _Disconnect, self.args),
            (r"/nbinlineai/subscription/usage", _Usage, self.args),
            (r"/nbinlineai/subscription/file-access", _FileAccess, self.args),
        ], authorizer=self.authorizer, login_url="/login", base_url="/")

    def tearDown(self):
        super().tearDown()
        if self._old_xdg is None:
            os.environ.pop("XDG_CONFIG_HOME", None)
        else:
            os.environ["XDG_CONFIG_HOME"] = self._old_xdg
        self._storage.cleanup()

    def _fetch(self, path, *, method="GET", data=None, auth=True):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer test"
        return self.fetch(path, method=method, body=json.dumps(data) if data is not None else
                          ("" if method == "POST" else None), headers=headers, follow_redirects=False)

    def test_status_is_authorized_scoped_and_does_not_expose_unknown_account_fields(self):
        url = "/nbinlineai/subscription/status?session_id=session-one"
        assert self._fetch(url, auth=False).code != 200
        self.authorizer.allow = False
        assert self._fetch(url).code == 403
        self.authorizer.allow = True
        response = self._fetch(url)
        assert response.code == 200
        data = json.loads(response.body)
        assert data["state"] == "connected"
        assert data["file_access"] == "project"
        assert data["native_files_capable"] is False
        assert data["working_folder"].endswith("/course/week2")
        assert data["project_root"].endswith("/course")
        assert "never-expose" not in response.body.decode()
        top = json.loads(self._fetch("/nbinlineai/status").body)
        assert top["subscription_capable"] is True
        assert top["providers"]["openai_codex_subscription"]["models"] == ["synthetic-model"]
        self.sessions.path = "missing.ipynb"
        assert self._fetch(url).code == 409

    def test_login_cancel_usage_and_disconnect_use_only_manager_methods(self):
        assert self._fetch("/nbinlineai/subscription/login", method="POST",
                           data={"method": "api_key"}).code == 400
        started = self._fetch("/nbinlineai/subscription/login", method="POST",
                              data={"method": "browser"})
        assert json.loads(started.body)["login_id"] == "login-one"
        assert self._fetch("/nbinlineai/subscription/login/cancel", method="POST",
                           data={"login_id": "login-one"}).code == 200
        assert self._fetch("/nbinlineai/subscription/login/cancel", method="POST",
                           data={"login_id": "stale"}).code == 409
        assert self._fetch("/nbinlineai/subscription/usage").code == 200
        assert self._fetch("/nbinlineai/subscription/disconnect", method="POST", data={}).code == 200
        assert self.manager.calls == [
            ("login", "browser"), ("cancel", "login-one"), ("usage",), ("disconnect",),
        ]

    def test_account_routes_reject_shared_identity_servers(self):
        self._app.settings["identity_provider"] = object()
        assert self._fetch("/nbinlineai/subscription/status").code == 403
        assert self._fetch("/nbinlineai/subscription/login", method="POST",
                           data={"method": "browser"}).code == 403
        assert self._fetch("/nbinlineai/subscription/file-access").code == 403

    def test_file_access_choice_persists_only_after_valid_session(self):
        path = "/nbinlineai/subscription/file-access"
        invalid = self._fetch(path, method="POST", data={"scope": "/tmp", "session_id": "session-one"})
        assert invalid.code == 400
        changed = self._fetch(path, method="POST", data={"scope": "notebook", "session_id": "session-one"})
        assert changed.code == 200
        assert json.loads(changed.body)["file_access"] == "notebook"
        assert json.loads(changed.body)["working_folder"] == json.loads(changed.body)["project_root"] + "/week2"
        assert json.loads(self._fetch(path + "?session_id=session-one").body)["file_access"] == "notebook"
        assert json.loads(self._fetch(path).body)["native_files_capable"] is False
        self.sessions.path = "missing.ipynb"
        assert self._fetch(path, method="POST", data={"scope": "project", "session_id": "session-one"}).code == 409
        assert json.loads(self._fetch(path).body)["file_access"] == "notebook"

    def test_subscription_prompt_uses_bound_scope_and_owned_runtime(self):
        body = {
            "prompt": "Hello", "session_id": "session-one", "prompt_cell_id": "prompt-one",
            "preceding_cells": [], "backend": "openai_codex_subscription",
            "model": "synthetic-model", "reasoning_effort": "low",
        }
        response = self._fetch("/nbinlineai/prompt", method="POST", data=body)
        assert response.code == 200
        events = [json.loads(line.removeprefix("data: ")) for line in response.body.decode().splitlines()
                  if line.startswith("data: ")]
        assert [event["type"] for event in events] == ["context", "text_delta", "done"]
        assert events[1]["text"] == "synthetic subscription answer"
        assert events[0]["round_wire_chars"] == events[0]["context_chars"]
        round_call = next(call for call in self.manager.calls if call[0] == "round")
        assert round_call[1:3] == ("synthetic-model", "low")
        assert round_call[3]["session_id"] == "session-one"
        assert round_call[3]["working_folder"].endswith("/course/week2")
        assert round_call[3]["file_access_root"].endswith("/course")
        assert len(round_call[4]) == 32
        assert "Originating notebook folder" in round_call[5][0].text
        assert "kernel's current working directory" in round_call[5][0].text
        assert ("run-cancel", round_call[4]) in self.manager.calls

        body["model"] = "unknown-model"
        assert self._fetch("/nbinlineai/prompt", method="POST", data=body).code == 400
        body["model"] = "synthetic-model"
        self.manager.auth_mode = "api_key"
        assert self._fetch("/nbinlineai/prompt", method="POST", data=body).code == 400

    def test_subscription_rebudgets_after_one_validated_tool_group_without_replay(self):
        self.manager.plan_tool = True
        body = {
            "prompt": "Use &`add`", "session_id": "session-one", "prompt_cell_id": "prompt-one",
            "preceding_cells": [{"id": "long", "cell_type": "markdown", "source": "A" * 65_000}],
            "backend": "openai_codex_subscription", "model": "synthetic-model",
            "max_tool_steps": 1,
        }
        response = self._fetch("/nbinlineai/prompt", method="POST", data=body)
        assert response.code == 200
        events = [json.loads(line.removeprefix("data: ")) for line in response.body.decode().splitlines()
                  if line.startswith("data: ")]
        assert [event["type"] for event in events] == [
            "context", "tool_start", "tool_result", "context", "text_delta", "done",
        ]
        contexts = [event for event in events if event["type"] == "context"]
        assert all(context["context_chars"] <= 64_000 for context in contexts)
        assert contexts[1]["source_chars"] < contexts[0]["source_chars"]
        assert len(self.dispatcher.tool_calls) == 1
        assert self.dispatcher.tool_calls[0][4:] == ("add", {"n": 1})
        rounds = [call for call in self.manager.calls if call[0] == "round"]
        assert len(rounds) == 2
        assert sum(message.role == "tool" for message in rounds[1][5]) == 1
        assert events[-1]["tool_steps"] == 1

    def test_subscription_preview_uses_pure_codec_when_signed_out(self):
        self.manager.auth_mode = "signed_out"
        body = {
            "prompt": "Hello", "session_id": "session-one", "prompt_cell_id": "prompt-one",
            "preceding_cells": [], "backend": "openai_codex_subscription",
            "model": "synthetic-model", "reasoning_effort": "ultra",
        }
        preview = self._fetch("/nbinlineai/context-preview", method="POST", data=body)
        assert preview.code == 200
        data = json.loads(preview.body)
        assert data["round_wire_chars"] == data["context_chars"] <= 64_000
        assert not self.manager.calls

    def test_zero_tool_steps_rejects_group_without_running_tools(self):
        self.manager.plan_tool = True
        body = {
            "prompt": "Use &`add`", "session_id": "session-one", "prompt_cell_id": "prompt-one",
            "preceding_cells": [], "backend": "openai_codex_subscription",
            "model": "synthetic-model", "max_tool_steps": 0,
        }
        response = self._fetch("/nbinlineai/prompt", method="POST", data=body)
        assert response.code == 200
        assert b"Tool step limit reached" in response.body
        assert not self.dispatcher.tool_calls
        assert sum(call[0] == "round" for call in self.manager.calls) == 1


def test_status_sanitizer_rejects_malformed_presentation_values():
    safe = _safe_subscription_status({
        "state": {"secret": "bad"}, "configured": "true", "message": {"secret": "bad"},
        "account": {"email": ["bad"], "display_name": "Valid name", "token": "secret"},
        "models": [
            {"id": "bad name", "efforts": [{"secret": "bad"}]},
            {"id": "synthetic-model", "display_name": ["bad"],
             "efforts": ["low", {"secret": "bad"}], "default_effort": {"secret": "bad"}},
        ],
        "usage": {"state": ["bad"], "remaining_percent": True,
                  "reset_at": {"secret": "bad"}, "message": ["bad"]},
    })
    assert safe == {
        "state": "error", "configured": False,
        "account": {"display_name": "Valid name"},
        "models": [{"id": "synthetic-model", "efforts": ["low"]}],
        "usage": {"state": "unavailable"},
    }
    full = _safe_subscription_status({"models": [{
        "id": "synthetic-model", "efforts": ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
        "default_effort": "ultra",
    }]})
    assert full["models"][0]["efforts"][-1] == "ultra"
    assert full["models"][0]["default_effort"] == "ultra"


def test_extension_shutdown_closes_only_its_owned_manager():
    assert _jupyter_server_extension_points()[0]["app"] is NbinlineaiExtension
    manager = _Manager()
    extension = NbinlineaiExtension()
    extension.serverapp = SimpleNamespace(
        web_app=SimpleNamespace(settings={"nbinlineai_subscription_manager": manager}),
    )
    asyncio.run(extension.stop_extension())
    assert manager.calls == [("close",)]

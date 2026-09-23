"""Session-bound browser action reply and prompt-loop regressions."""

import asyncio
import json
import threading

import pytest
from aidialog.msg_parts import Completion, Msg, Text, ToolUse
from jupyter_client import AsyncKernelManager
from tornado.testing import AsyncHTTPTestCase
from tornado.web import Application

from nbinlineai import providers
from nbinlineai.frontend_bridge import (
    BridgeConflict,
    BridgeNotFound,
    FrontendBridge,
    normalize_action,
)
from nbinlineai.handlers import ActionReplyHandler
from nbinlineai.kernel import KernelDispatcher
from nbinlineai.prompt import run_prompt
from nbinlineai.tool_schema import fastllm_tool


class _Dispatcher:
    """A session whose kernel can be changed during an action."""

    def __init__(self) -> None:
        self.kernel = object()
        self.kernel_id = "kernel-1"
        self.calls = []

    async def resolve(self, session_id: str):
        if session_id != "session-1":
            raise ValueError("Wrong session")
        return self.kernel_id, self.kernel

    async def inspect(self, kernel_id, kernel, variables, functions):
        return {name: {"docstring": "List current notebook cells.", "parameters": {
            "start": {"type": "int", "default": "0"},
            "limit": {"type": "int", "default": "20"},
        }, "frontend_special": "list_cells"} for name in functions}

    async def call(self, *args):
        self.calls.append(args)
        return "ordinary"


def _reply(run, event, **patch):
    return {
        "run_id": run.run_id, "request_id": event["request_id"],
        "session_id": run.session_id, "prompt_cell_id": run.prompt_cell_id,
        "ok": True, "text": "Cell one", **patch,
    }


def test_action_reply_binding_duplicate_and_malicious_fields():
    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("session-1", "prompt-1", dispatcher.kernel_id, dispatcher.kernel)
        event, pending = bridge.prepare(run, "read_cell", {"cell_id": "cell-1"})
        assert event["run_id"] == run.run_id and event["arguments"]["end_line"] == 40
        with pytest.raises(ValueError, match="does not match"):
            await bridge.reply(_reply(run, event, session_id="session-2"), dispatcher)
        with pytest.raises(BridgeNotFound, match="expired"):
            await bridge.reply(_reply(run, event, request_id="different"), dispatcher)
        with pytest.raises(ValueError, match="Unexpected"):
            await bridge.reply(_reply(run, event, key="unwanted"), dispatcher)
        with pytest.raises(ValueError, match="text"):
            await bridge.reply(_reply(run, event, text="x" * 4_001), dispatcher)
        dispatcher.kernel = object()
        with pytest.raises(ValueError, match="changed kernels"):
            await bridge.reply(_reply(run, event), dispatcher)
        dispatcher.kernel = run.kernel
        await bridge.reply(_reply(run, event), dispatcher)
        with pytest.raises(BridgeConflict, match="already accepted"):
            await bridge.reply(_reply(run, event), dispatcher)
        assert await bridge.wait(run, pending) == "Cell one"
        bridge.close(run)
        with pytest.raises(BridgeNotFound, match="ended"):
            await bridge.reply(_reply(run, event), dispatcher)

    asyncio.run(exercise())


def test_action_timeout_and_cancel_cleanup(monkeypatch: pytest.MonkeyPatch):
    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("session-1", "prompt-1", dispatcher.kernel_id, dispatcher.kernel)
        event, pending = bridge.prepare(run, "list_cells", {})
        monkeypatch.setattr("nbinlineai.frontend_bridge.ACTION_TIMEOUT_SECONDS", 0.001)
        with pytest.raises(TimeoutError, match="timed out"):
            await bridge.wait(run, pending)
        with pytest.raises(BridgeNotFound, match="expired"):
            await bridge.reply(_reply(run, event), dispatcher)
        event, pending = bridge.prepare(run, "list_cells", {})
        waiting = asyncio.create_task(bridge.wait(run, pending))
        bridge.close(run)
        with pytest.raises(asyncio.CancelledError):
            await waiting
        with pytest.raises(BridgeNotFound, match="ended"):
            await bridge.reply(_reply(run, event), dispatcher)

    asyncio.run(exercise())


@pytest.mark.parametrize("name,cell_type", [("insert_markdown", "Markdown"),
                                            ("insert_code", "unexecuted code")])
def test_insert_ack_is_standardized_and_args_bounded(name, cell_type):
    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("session-1", "prompt-1", dispatcher.kernel_id, dispatcher.kernel)
        event, pending = bridge.prepare(run, name, {"content": "# Note"})
        assert event["name"] == name
        assert event["arguments"] == {"content": "# Note", "after_cell_id": ""}
        with pytest.raises(ValueError, match="Unexpected"):
            await bridge.reply(_reply(run, event, cell_id="new-1"), dispatcher)
        clean = _reply(run, event)
        clean.pop("text")
        clean["cell_id"] = "new-1"
        await bridge.reply(clean, dispatcher)
        result = await bridge.wait(run, pending)
        assert f"Inserted {cell_type} cell new-1" in result
        assert "not saved to disk" in result
        bridge.close(run)

    asyncio.run(exercise())
    with pytest.raises(ValueError, match="start"):
        normalize_action("list_cells", {"start": -1})
    with pytest.raises(ValueError, match="80 lines"):
        normalize_action("read_cell", {"cell_id": "c", "start_line": 1, "end_line": 81})
    for action in ("insert_markdown", "insert_code"):
        for invalid in ("", "  ", "x" * 8_001):
            with pytest.raises(ValueError, match="content"):
                normalize_action(action, {"content": invalid})
        with pytest.raises(ValueError, match="Unexpected"):
            normalize_action(action, {"content": "hi", "execute": True})
        with pytest.raises(ValueError, match="after_cell_id"):
            normalize_action(action, {"content": "hi", "after_cell_id": "x" * 201})


def test_aliased_special_tool_never_calls_kernel(monkeypatch: pytest.MonkeyPatch):
    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("session-1", "prompt-1", dispatcher.kernel_id, dispatcher.kernel)
        completions = 0

        async def fake_complete(backend, model, messages, tools):
            nonlocal completions
            completions += 1
            if completions == 1:
                assert tools[0]["name"] == "my_cells"
                return Completion(model, Msg("assistant", [
                    ToolUse(id="call-1", name="my_cells", arguments={"limit": 2})
                ]))
            assert "Cell one" in messages[-1].content[0].text
            return Completion(model, Msg("assistant", [Text("Done")]))

        monkeypatch.setattr(providers, "complete", fake_complete)
        body = {"prompt": "Use &`my_cells`", "session_id": "session-1",
                "prompt_cell_id": "prompt-1", "preceding_cells": [], "backend": "openai_api",
                "model": "test-model", "max_tool_steps": 2}
        events = []
        async for event in run_prompt(body, dispatcher, run.kernel_id, run.kernel, bridge, run):
            events.append(event)
            if event["type"] == "frontend_action":
                assert event["name"] == "list_cells"
                await bridge.reply(_reply(run, event), dispatcher)
        assert [event["type"] for event in events] == [
            "context", "tool_start", "frontend_action", "tool_result", "context", "text_delta", "done"
        ]
        assert dispatcher.calls == []
        bridge.close(run)

    asyncio.run(exercise())


def test_aliased_insert_code_waits_for_browser_ack(monkeypatch: pytest.MonkeyPatch):
    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("session-1", "prompt-1", dispatcher.kernel_id, dispatcher.kernel)

        async def inspect(kernel_id, kernel, variables, functions):
            assert functions == ["code_alias"]
            return {"code_alias": {
                "docstring": "Insert an unexecuted code cell below the AI answer, or after a chosen cell.",
                "parameters": {
                    "content": {"type": "str"},
                    "after_cell_id": {"type": "str", "default": "''"},
                },
                "frontend_special": "insert_code",
            }}

        dispatcher.inspect = inspect
        completions = 0

        async def fake_complete(backend, model, messages, tools):
            nonlocal completions
            completions += 1
            if completions == 1:
                assert tools[0]["name"] == "code_alias"
                assert tools[0]["description"].startswith("Insert an unexecuted code cell")
                assert tools[0]["parameters"]["required"] == ["content"]
                return Completion(model, Msg("assistant", [ToolUse(
                    id="call-1", name="code_alias", arguments={"content": "result = 7"},
                )]))
            assert "Inserted unexecuted code cell code-new" in messages[-1].content[0].text
            return Completion(model, Msg("assistant", [Text("Code inserted for you to review.")]))

        monkeypatch.setattr(providers, "complete", fake_complete)
        body = {"prompt": "Use &`code_alias`", "session_id": "session-1",
                "prompt_cell_id": "prompt-1", "preceding_cells": [], "backend": "openai_api",
                "model": "test-model", "max_tool_steps": 2}
        actions = []
        async for event in run_prompt(body, dispatcher, run.kernel_id, run.kernel, bridge, run):
            if event["type"] == "frontend_action":
                actions.append(event)
                assert event["name"] == "insert_code"
                assert event["arguments"] == {"content": "result = 7", "after_cell_id": ""}
                reply = _reply(run, event)
                reply.pop("text")
                reply["cell_id"] = "code-new"
                await bridge.reply(reply, dispatcher)
        assert len(actions) == 1
        assert dispatcher.calls == []
        bridge.close(run)

    asyncio.run(exercise())


def test_url_to_note_fetches_then_asks_browser_to_insert(monkeypatch: pytest.MonkeyPatch):
    """A URL-backed note fetches on the server and needs a browser insertion ack."""
    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("session-1", "prompt-1", dispatcher.kernel_id, dispatcher.kernel)

        async def inspect(kernel_id, kernel, variables, functions):
            return {"note_alias": {
                "docstring": "Fetch a public page as a note.",
                "parameters": {"url": {"type": "str"}},
                "frontend_special": "url_to_note",
            }}

        dispatcher.inspect = inspect
        calls = 0

        async def fake_complete(backend, model, messages, tools):
            nonlocal calls
            calls += 1
            if calls == 1:
                return Completion(model, Msg("assistant", [
                    ToolUse(id="call-1", name="note_alias",
                            arguments={"url": "https://example.org/lesson"})
                ]))
            assert "not saved to disk" in messages[-1].content[0].text
            return Completion(model, Msg("assistant", [Text("The note is in the notebook.")]))

        monkeypatch.setattr(providers, "complete", fake_complete)
        monkeypatch.setattr("nbinlineai.prompt.fetch_url_markdown",
                            lambda url: "Source: https://example.org/lesson\n\nLesson text")
        body = {"prompt": "Use &`note_alias`", "session_id": "session-1",
                "prompt_cell_id": "prompt-1", "preceding_cells": [], "backend": "openai_api",
                "model": "test-model", "max_tool_steps": 2}
        actions = []
        async for event in run_prompt(body, dispatcher, run.kernel_id, run.kernel, bridge, run):
            if event["type"] == "frontend_action":
                actions.append(event)
                reply = _reply(run, event)
                reply.pop("text")
                reply["cell_id"] = "inserted-1"
                await bridge.reply(reply, dispatcher)
        assert len(actions) == 1
        assert actions[0]["name"] == "insert_markdown"
        assert actions[0]["arguments"] == {
            "content": "Source: https://example.org/lesson\n\nLesson text", "after_cell_id": ""
        }
        assert dispatcher.calls == []
        bridge.close(run)

    asyncio.run(exercise())


def test_url_fetch_timeout_never_emits_insert_action(monkeypatch: pytest.MonkeyPatch):
    """A blocked worker can finish late without producing a browser mutation."""
    release = threading.Event()
    entered = threading.Event()

    def slow_fetch(url):
        entered.set()
        release.wait(1)
        return "Source: https://example.org/lesson\n\nLate result"

    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("session-1", "prompt-1", dispatcher.kernel_id, dispatcher.kernel)

        async def inspect(kernel_id, kernel, variables, functions):
            return {"note_alias": {
                "docstring": "Fetch page as a note.",
                "parameters": {"url": {"type": "str"}},
                "frontend_special": "url_to_note",
            }}

        dispatcher.inspect = inspect
        calls = 0

        async def fake_complete(backend, model, messages, tools):
            nonlocal calls
            calls += 1
            if calls == 1:
                return Completion(model, Msg("assistant", [
                    ToolUse(id="call-1", name="note_alias",
                            arguments={"url": "https://example.org/lesson"})
                ]))
            assert "Page fetch timed out" in messages[-1].content[0].text
            return Completion(model, Msg("assistant", [Text("Could not fetch.")]))

        monkeypatch.setattr(providers, "complete", fake_complete)
        monkeypatch.setattr("nbinlineai.prompt.fetch_url_markdown", slow_fetch)
        monkeypatch.setattr("nbinlineai.prompt.MAX_WEB_TOTAL_SECONDS", 0.05)
        body = {"prompt": "Use &`note_alias`", "session_id": "session-1",
                "prompt_cell_id": "prompt-1", "preceding_cells": [], "backend": "openai_api",
                "model": "test-model", "max_tool_steps": 2}
        try:
            events = [event async for event in run_prompt(
                body, dispatcher, run.kernel_id, run.kernel, bridge, run
            )]
            assert entered.is_set()
            assert "frontend_action" not in [event["type"] for event in events]
            assert [event["type"] for event in events][-2:] == ["text_delta", "done"]
        finally:
            bridge.close(run)
            release.set()
            await asyncio.sleep(0.01)

    asyncio.run(exercise())


def test_url_fetch_cancellation_never_emits_insert_action(monkeypatch: pytest.MonkeyPatch):
    """Cancelling the SSE task abandons a still-running read-only fetch."""
    release = threading.Event()
    entered = threading.Event()

    def slow_fetch(url):
        entered.set()
        release.wait(1)
        return "Source: https://example.org/lesson\n\nLate result"

    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("session-1", "prompt-1", dispatcher.kernel_id, dispatcher.kernel)

        async def inspect(kernel_id, kernel, variables, functions):
            return {"note_alias": {
                "docstring": "Fetch page as a note.",
                "parameters": {"url": {"type": "str"}},
                "frontend_special": "url_to_note",
            }}

        async def fake_complete(backend, model, messages, tools):
            return Completion(model, Msg("assistant", [
                ToolUse(id="call-1", name="note_alias",
                        arguments={"url": "https://example.org/lesson"})
            ]))

        dispatcher.inspect = inspect
        monkeypatch.setattr(providers, "complete", fake_complete)
        monkeypatch.setattr("nbinlineai.prompt.fetch_url_markdown", slow_fetch)
        body = {"prompt": "Use &`note_alias`", "session_id": "session-1",
                "prompt_cell_id": "prompt-1", "preceding_cells": [], "backend": "openai_api",
                "model": "test-model", "max_tool_steps": 2}
        events = []

        async def consume():
            async for event in run_prompt(body, dispatcher, run.kernel_id, run.kernel, bridge, run):
                events.append(event)

        task = asyncio.create_task(consume())
        try:
            for _ in range(100):
                if entered.is_set():
                    break
                await asyncio.sleep(0.005)
            assert entered.is_set()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert "frontend_action" not in [event["type"] for event in events]
        finally:
            bridge.close(run)
            release.set()
            await asyncio.sleep(0.01)

    asyncio.run(exercise())


class _Authorizer:
    def __init__(self):
        self.allow = True

    def is_authorized(self, handler, user, action, resource):
        return self.allow


class _ReplyHandler(ActionReplyHandler):
    async def prepare(self):
        self._current_user = "test-user" if self.request.headers.get("Authorization") == "Bearer test" else None


class ReplyHTTPTests(AsyncHTTPTestCase):
    def get_app(self):
        self.bridge = FrontendBridge()
        self.dispatcher = _Dispatcher()
        self.authorizer = _Authorizer()
        return Application(
            [(r"/nbinlineai/action-reply", _ReplyHandler,
              {"dispatcher": self.dispatcher, "bridge": self.bridge})],
            authorizer=self.authorizer, login_url="/login", base_url="/",
        )

    def test_reply_requires_auth_and_execute_permission(self):
        body = json.dumps({"run_id": "missing", "request_id": "missing"})
        headers = {"Content-Type": "application/json"}
        denied = self.fetch("/nbinlineai/action-reply", method="POST", body=body,
                            headers=headers, follow_redirects=False)
        assert denied.code != 200
        self.authorizer.allow = False
        forbidden = self.fetch("/nbinlineai/action-reply", method="POST", body=body,
                               headers={**headers, "Authorization": "Bearer test"})
        assert forbidden.code == 403


def test_real_kernel_identity_recognizes_alias_not_same_name():
    """A Python alias is special by object identity; a shadowing name is ordinary."""
    async def exercise():
        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel()
        try:
            client = kernel.client()
            client.start_channels()
            try:
                await client.wait_for_ready(timeout=15)
                message_id = client.execute(
                    "from nbinlineai.tools import list_cells as alias\n"
                    "from nbinlineai.tools import insert_code as code_alias\n"
                    "def list_cells(start: int = 0, limit: int = 20):\n"
                    "    return 'ordinary user function'\n"
                    "def insert_code(content: str, after_cell_id: str = ''):\n"
                    "    return 'ordinary user function'\n"
                )
                while True:
                    message = await client.get_iopub_msg(timeout=10)
                    if message.get("parent_header", {}).get("msg_id") != message_id:
                        continue
                    if message.get("msg_type") == "status" and (
                        message.get("content", {}).get("execution_state") == "idle"
                    ):
                        break
            finally:
                client.stop_channels()

            class Sessions:
                async def get_session(self, *, session_id):
                    return {"type": "notebook", "kernel": {"id": "kernel-1", "name": "python3"}}

            class Kernels:
                def __contains__(self, kernel_id):
                    return kernel_id == "kernel-1"

                def get_kernel(self, kernel_id):
                    return kernel

            dispatcher = KernelDispatcher(Sessions(), Kernels())
            info = await dispatcher.inspect("kernel-1", kernel, [],
                                            ["alias", "list_cells", "code_alias", "insert_code"])
            assert info["alias"]["frontend_special"] == "list_cells"
            assert "frontend_special" not in info["list_cells"]
            assert info["code_alias"]["frontend_special"] == "insert_code"
            assert "frontend_special" not in info["insert_code"]
            assert fastllm_tool("code_alias", info["code_alias"])["parameters"]["required"] == ["content"]
            client = kernel.client()
            client.start_channels()
            try:
                missing = client.execute(
                    "import importlib as _il\n"
                    "_original_import = _il.import_module\n"
                    "def _without_nbinlineai(name, package=None):\n"
                    "    if name == 'nbinlineai.tools':\n"
                    "        raise ModuleNotFoundError('simulated separate kernel environment')\n"
                    "    return _original_import(name, package)\n"
                    "_il.import_module = _without_nbinlineai\n"
                    "def custom_tool(value: int):\n"
                    "    return value + 1\n"
                )
                while True:
                    message = await client.get_iopub_msg(timeout=10)
                    if message.get("parent_header", {}).get("msg_id") == missing and (
                        message.get("msg_type") == "status"
                        and message.get("content", {}).get("execution_state") == "idle"
                    ):
                        break
                ordinary = await dispatcher.inspect("kernel-1", kernel, [], ["custom_tool"])
                assert "frontend_special" not in ordinary["custom_tool"]
                assert ordinary["custom_tool"]["parameters"]["value"]["type"] == "int"
                client.execute("_il.import_module = _original_import")
            finally:
                client.stop_channels()
        finally:
            await kernel.shutdown_kernel(now=True)

    asyncio.run(exercise())

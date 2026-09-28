"""Terminal prompt turns and nonblocking kernel handoff protocol."""

import asyncio

import pytest
from aidialog.msg_parts import Completion, Msg, ToolUse

from nbinlineai import kernel_execution_handoff, providers
from nbinlineai.frontend_bridge import FrontendBridge, normalize_action
from nbinlineai.prompt import preview_context, run_prompt, validate_request


def _body():
    return {"prompt": "Use &`handoff`", "session_id": "s", "prompt_cell_id": "p",
            "preceding_cells": [], "backend": "openai_api", "model": "test",
            "max_tool_steps": 2}


class _Dispatcher:
    def __init__(self):
        self.kernel = object()
        self.called = False

    async def resolve(self, session_id):
        return "k", self.kernel

    async def inspect(self, kernel_id, kernel, variables, functions):
        return {name: {"docstring": "Execute after this turn", "parameters": {},
                       "frontend_special": "add_code_cell_and_execute"} for name in functions}

    async def inspect_preview(self, *args):
        return await self.inspect(*args)

    async def call(self, *args):
        self.called = True
        return "called"


def test_handoff_arguments_require_one_target_and_bounded_prompt():
    assert normalize_action("add_code_cell_and_execute", {"content": "print(1)", "cell_id": ""}) == {
        "content": "print(1)", "after_cell_id": "",
    }
    assert normalize_action("run_and_prompt", {"cell_id": "c", "prompt": "Explain"})["cell_id"] == "c"
    assert normalize_action("run_and_prompt", {"cell_id": "c", "prompt": "Explain",
                                               "after_cell_id": ""})["cell_id"] == "c"
    for name, arguments in [
        ("add_code_cell_and_execute", {}),
        ("add_code_cell_and_execute", {"content": "x", "cell_id": "c"}),
        ("run_and_prompt", {"content": "x"}),
        ("prompt_and_run", {"prompt": "Ask", "content": "x"}),
        ("run_and_prompt", {"cell_id": "c", "after_cell_id": "d", "prompt": "Ask"}),
    ]:
        with pytest.raises(ValueError):
            normalize_action(name, arguments)


@pytest.mark.parametrize("backend", ["openai_api", "openai_codex_subscription"])
def test_terminal_handoff_ends_turn_without_second_provider_round(monkeypatch, backend):
    async def exercise():
        dispatcher = _Dispatcher()
        dispatcher.sessions = type("Sessions", (), {"get_session": staticmethod(
            lambda **kwargs: _session())})()
        bridge = FrontendBridge()
        run = bridge.start("s", "p", "k", dispatcher.kernel)
        calls = 0

        async def complete(*args):
            nonlocal calls
            calls += 1
            return Completion("test", Msg("assistant", [ToolUse(
                id="t1", name="handoff", arguments={"content": "print(1)"})]))

        monkeypatch.setattr(providers, "complete", complete)
        class Runtime:
            round_wire_cost = staticmethod(lambda messages, tools: 1000)

            async def complete_round(self, *args, **kwargs):
                return await complete(*args)

        events = []
        body = {**_body(), "backend": backend}
        kwargs = ({"subscription_runtime": Runtime(), "subscription_scope": {
            "session_id": "s", "notebook_path": "lesson.ipynb", "working_folder": "/tmp",
        }} if backend == "openai_codex_subscription" else {})
        async for event in run_prompt(body, dispatcher, "k", dispatcher.kernel, bridge, run, **kwargs):
            events.append(event)
            if event["type"] == "frontend_action":
                assert event["name"] == "add_code_cell_and_execute"
                with pytest.raises(ValueError, match="cell_id"):
                    await bridge.reply({"run_id": run.run_id, "request_id": event["request_id"],
                                        "session_id": "s", "prompt_cell_id": "p", "ok": True,
                                        "chain_id": "ch", "step_id": "step",
                                        "status": "scheduled"}, dispatcher)
                await bridge.reply({"run_id": run.run_id, "request_id": event["request_id"],
                                    "session_id": "s", "prompt_cell_id": "p", "ok": True,
                                    "chain_id": "ch", "step_id": "step", "cell_id": "c",
                                    "status": "scheduled"}, dispatcher)
        assert calls == 1
        assert [event["type"] for event in events] == [
            "context", "tool_start", "frontend_action", "tool_result", "handoff", "done",
        ]
        assert events[-2]["chain_id"] == "ch"
        bridge.close(run)

    asyncio.run(exercise())


async def _session():
    return {"id": "s", "path": "lesson.ipynb", "type": "notebook"}


def test_mixed_terminal_group_is_rejected_before_any_effect(monkeypatch):
    async def exercise():
        dispatcher = _Dispatcher()
        bridge = FrontendBridge()
        run = bridge.start("s", "p", "k", dispatcher.kernel)

        async def complete(*args):
            return Completion("test", Msg("assistant", [
                ToolUse(id="a", name="handoff", arguments={"content": "print(1)"}),
                ToolUse(id="b", name="handoff", arguments={"cell_id": "c"}),
            ]))

        monkeypatch.setattr(providers, "complete", complete)
        stream = run_prompt(_body(), dispatcher, "k", dispatcher.kernel, bridge, run)
        with pytest.raises(ValueError, match="sole tool call"):
            await _collect(stream)
        assert run.pending is None and not dispatcher.called
        bridge.close(run)

    asyncio.run(exercise())


async def _collect(stream):
    return [event async for event in stream]


def test_predecessor_result_is_validated_and_budgeted(monkeypatch):
    result = {"chain_id": "ch", "step_id": "step", "cell_id": "c", "msg_id": "m",
              "source_sha256": "a" * 64, "status": "completed", "text": "the real output",
              "truncated": False, "rich_output_omitted": False}
    body = {**_body(), "predecessor_result": result}
    validate_request(body, preview=True)
    for bad in ({**result, "text": "x" * 8001}, {**result, "status": "error"},
                {**result, "msg_id": ""}, {**result, "source_sha256": "bad"},
                {**result, "rich_output_omitted": "false"}):
        with pytest.raises(ValueError):
            validate_request({**body, "predecessor_result": bad}, preview=True)

    async def exercise():
        dispatcher = _Dispatcher()
        context = await preview_context(body, dispatcher, "k", dispatcher.kernel)
        assert context["context_chars"] > 0
        oversized = {**body, "predecessor_result": {**result, "text": "x" * 8000}}
        await preview_context(oversized, dispatcher, "k", dispatcher.kernel)

    asyncio.run(exercise())


def test_direct_python_helper_sends_nonblocking_bound_comm(monkeypatch):
    class Channel:
        def __init__(self):
            self.message = None
            self.closed = False

        def on_msg(self, handler):
            self.message = handler

        def on_close(self, handler):
            self.close_handler = handler

        def close(self):
            self.closed = True

    async def exercise():
        channel = Channel()
        sent = {}

        def create_comm(**kwargs):
            sent.update(kwargs)
            return channel

        monkeypatch.setattr(kernel_execution_handoff, "create_comm", create_comm)
        monkeypatch.setattr(kernel_execution_handoff, "_origin", lambda: ("execute-msg", "source-cell"))
        receipt = kernel_execution_handoff.request_execution_handoff(
            "run_and_prompt", {"content": "print(1)", "prompt": "Explain"})
        assert receipt.status == "requested"
        assert sent["target_name"] == "nbinlineai.execution_handoff.v1"
        assert sent["data"]["execute_request_id"] == "execute-msg"
        assert sent["data"]["source_cell_id"] == "source-cell"
        channel.message({"content": {"data": {"ok": True, "request_id": receipt.request_id,
                                                "chain_id": "chain", "step_id": "step",
                                                "cell_id": "code"}}})
        assert receipt.status == "scheduled" and receipt.cell_id == "code"
        assert channel.closed

    asyncio.run(exercise())

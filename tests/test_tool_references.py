"""Only the active AI prompt can opt into live kernel references."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from aidialog.msg_parts import Completion, Msg, Text, ToolUse
from jupyter_client import AsyncKernelManager

from nbinlineai import providers
from nbinlineai.prompt import run_prompt


def _preceding_cells() -> list[dict[str, Any]]:
    """Return ordinary source and prior AI history with inert references."""
    return [
        {
            "id": "notes",
            "cell_type": "markdown",
            "source": "Notes mention $`markdown_value` and &`markdown_tool` as examples.",
        },
        {
            "id": "code",
            "cell_type": "code",
            "source": 'comment = "$`code_value` and &`code_tool` are text"',
        },
        {
            "id": "past-prompt",
            "cell_type": "markdown",
            "source": "Earlier I asked about $`history_value` and &`history_tool`.",
            "metadata": {"nbinlineai": {"isPromptCell": True}},
        },
        {
            "id": "past-answer",
            "cell_type": "markdown",
            "source": "The earlier answer quoted $`answer_value` and &`answer_tool`.",
            "metadata": {
                "nbinlineai": {
                    "isOutputCell": True,
                    "promptCellId": "past-prompt",
                    "status": "done",
                }
            },
        },
    ]


def _request(prompt: str) -> dict[str, Any]:  # prompt: current AI cell text
    """Make the minimum validated shape for a direct provider-loop test."""
    return {
        "prompt": prompt,
        "session_id": "test-session",
        "prompt_cell_id": "current-prompt",
        "preceding_cells": _preceding_cells(),
        "backend": "openai_api",
        "model": "test-model",
        "max_tool_steps": 2,
    }


class RecordingDispatcher:
    """Record precisely which live names the active prompt requests."""

    def __init__(self) -> None:
        """Start with no kernel operations."""
        self.inspections: list[tuple[list[str], list[str]]] = []
        self.calls: list[tuple[set[str], str, dict[str, Any]]] = []

    async def inspect(
        self,
        kernel_id: str,  # kernel selected for the current notebook
        kernel: object,  # bound test kernel placeholder
        variables: list[str],  # names requested by the current prompt
        functions: list[str],  # callable names requested by the current prompt
    ) -> dict[str, Any]:
        """Return descriptions only for the two allowed current references."""
        assert kernel_id == "test-kernel"
        self.inspections.append((variables, functions))
        assert variables == ["live_value"]
        assert functions == ["do_work"]
        return {
            "live_value": {"type": "int", "repr": "7"},
            "do_work": {
                "docstring": "Add to the live value.",
                "parameters": {"value": {"type": "int", "description": "Amount to add"}},
            },
        }

    async def call(
        self,
        session_id: str,  # source notebook session
        kernel_id: str,  # bound kernel identifier
        kernel: object,  # bound test kernel placeholder
        allowed: set[str],  # functions registered by this prompt
        name: str,  # provider-selected function
        arguments: dict[str, Any],  # provider-selected keyword arguments
    ) -> str:
        """Accept the one registered call and record its allowlist."""
        assert session_id == "test-session"
        assert kernel_id == "test-kernel"
        self.calls.append((allowed, name, arguments))
        return "10"


def test_prior_source_and_ai_history_references_are_context_only(monkeypatch) -> None:  # monkeypatch: pytest fixture
    """Previous cells cannot trigger inspection or register provider tools."""
    dispatcher = RecordingDispatcher()
    captured: dict[str, Any] = {}

    async def fake_complete(
        backend: str,  # selected provider
        model: str,  # selected model
        messages: list[Msg],  # assembled system, history, and current prompt
        tools: list[dict[str, Any]],  # registered function schemas
    ) -> Completion:
        """Capture exactly what the provider would receive."""
        captured.update(backend=backend, messages=messages, tools=tools)
        return Completion(model, Msg("assistant", [Text("No live references requested.")]))

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def collect() -> list[dict[str, Any]]:
        """Consume the provider loop without a real kernel or network call."""
        return [event async for event in run_prompt(
            _request("Summarize the earlier notes only."), dispatcher, "test-kernel", object()
        )]

    events = asyncio.run(collect())
    assert dispatcher.inspections == []
    assert dispatcher.calls == []
    assert captured["tools"] == []
    assert [event["type"] for event in events] == ["context", "text_delta", "done"]
    assert events[0]["variables"] == {} and events[0]["tools"] == []
    system, old_prompt, old_answer, current_prompt = captured["messages"]
    assert "$`markdown_value`" in system.text and "&`markdown_tool`" in system.text
    assert "$`code_value`" in system.text and "&`code_tool`" in system.text
    assert "$`history_value`" in old_prompt.text and "&`history_tool`" in old_prompt.text
    assert "$`answer_value`" in old_answer.text and "&`answer_tool`" in old_answer.text
    assert current_prompt.text == "Summarize the earlier notes only."


def test_only_current_references_expand_and_register_a_callable(monkeypatch) -> None:  # monkeypatch: pytest fixture
    """Current `$` and `&` names inspect once and permit one fake tool call."""
    dispatcher = RecordingDispatcher()
    provider_calls: list[tuple[list[Msg], list[dict[str, Any]]]] = []

    async def fake_complete(
        backend: str,  # selected provider
        model: str,  # selected model
        messages: list[Msg],  # conversation including any tool result
        tools: list[dict[str, Any]],  # current prompt's function schemas
    ) -> Completion:
        """Call the sole registered tool once, then answer."""
        assert backend == "openai_api"
        provider_calls.append((messages.copy(), tools.copy()))
        if len(provider_calls) == 1:
            return Completion(model, Msg("assistant", [ToolUse(
                id="call-1", name="do_work", arguments={"value": 3}
            )]))
        return Completion(model, Msg("assistant", [Text("The live result is 10.")]))

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def collect() -> list[dict[str, Any]]:
        """Consume the function round without provider or kernel I/O."""
        return [event async for event in run_prompt(
            _request("Use $`live_value` and $`live_value`; call &`do_work` once."),
            dispatcher,
            "test-kernel",
            object(),
        )]

    events = asyncio.run(collect())
    assert dispatcher.inspections == [(["live_value"], ["do_work"])]
    assert dispatcher.calls == [({"do_work"}, "do_work", {"value": 3})]
    assert [event["type"] for event in events] == [
        "context", "tool_start", "tool_result", "text_delta", "done"
    ]
    assert events[0]["variables"]["live_value"]["repr"] == "7"
    assert events[0]["tools"] == ["do_work"]
    first_messages, first_tools = provider_calls[0]
    assert [tool["name"] for tool in first_tools] == ["do_work"]
    assert first_messages[-1].text == "Use 7 and 7; call &`do_work` once."
    assert "$`markdown_value`" in first_messages[0].text
    assert "$`history_value`" in first_messages[1].text
    assert provider_calls[1][0][-1].role == "tool"
    assert provider_calls[1][0][-1].content[0].text == "10"


class _NotebookSessions:
    """Bind a real test kernel to a single notebook session."""

    async def get_session(self, *, session_id: str) -> dict[str, Any]:  # session_id: requested notebook
        """Return the active Python session for the dispatcher."""
        assert session_id == "test-session"
        return {"type": "notebook", "kernel": {"id": "test-kernel", "name": "python3"}}


class _NotebookKernels:
    """Expose the one real kernel through Jupyter's lookup interface."""

    def __init__(self, kernel: AsyncKernelManager) -> None:  # kernel: running Python kernel
        """Keep the kernel bound to its test identifier."""
        self.kernel = kernel

    def __contains__(self, kernel_id: str) -> bool:  # kernel_id: requested kernel
        """Recognize only the running test kernel."""
        return kernel_id == "test-kernel"

    def get_kernel(self, kernel_id: str) -> AsyncKernelManager:  # kernel_id: requested kernel
        """Return the kernel after checking its identifier."""
        assert kernel_id == "test-kernel"
        return self.kernel


async def _execute_setup(
    kernel: AsyncKernelManager,  # running Python kernel
    source: str,  # code to execute before AI prompts
) -> None:
    """Run example setup code and reject any kernel error message."""
    client = kernel.client()
    client.start_channels()
    try:
        await client.wait_for_ready(timeout=15)
        message_id = client.execute(source)
        while True:
            message = await client.get_iopub_msg(timeout=15)
            if message.get("parent_header", {}).get("msg_id") != message_id:
                continue
            if message.get("msg_type") == "error":
                raise AssertionError(message["content"].get("evalue"))
            if message.get("msg_type") == "status" and message["content"].get("execution_state") == "idle":
                return
    finally:
        client.stop_channels()


def test_imported_builtin_tools_execute_through_a_real_kernel(
    monkeypatch,  # pytest fixture that replaces network provider completion
    tmp_path: Path,  # isolated folder with one saved sample notebook
) -> None:
    """Import each built-in in Python, register it per prompt, and inspect its result."""
    from nbinlineai.kernel import KernelDispatcher

    sample = tmp_path / "sample.ipynb"
    sample.write_text(json.dumps({
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {},
        "cells": [{
            "id": "cell-study",
            "cell_type": "code",
            "metadata": {},
            "source": ['course_token = "SAMPLE"\n', "print(course_token)"],
            "outputs": [],
            "execution_count": None,
        }],
    }))
    cases = [
        ("search_kernel_names", {"query": "roster_marker"}, "study_roster_marker"),
        ("list_notebooks", {"path": str(tmp_path)}, "sample.ipynb"),
        ("find_notebook_cells", {"path": str(sample), "query": "course_token"}, "cell-study"),
        ("read_notebook_cell", {"path": str(sample), "cell_id": "cell-study"}, "course_token"),
    ]

    async def run() -> None:
        """Keep one live kernel for all four per-prompt tool registrations."""
        def fake_for(
            tool_name: str,  # selected built-in for this current prompt
            tool_arguments: dict[str, Any],  # provider function arguments
            expected_text: str,  # marker required in the tool result
            results: list[str],  # collected tool replies
            state: dict[str, int],  # provider call counter
        ) -> Callable[..., Awaitable[Completion]]:
            """Bind a fake provider to one loop case."""
            async def fake_complete(
                backend: str,  # selected fake provider
                model: str,  # selected fake model
                messages: list[Msg],  # current prompt and tool round
                tools: list[dict[str, Any]],  # one registered built-in
            ) -> Completion:
                """Request only the built-in offered by this current AI cell."""
                assert backend == "openai_api"
                assert [tool["name"] for tool in tools] == [tool_name]
                state["calls"] += 1
                if state["calls"] == 1:
                    return Completion(model, Msg("assistant", [ToolUse(
                        id=f"call-{tool_name}", name=tool_name, arguments=tool_arguments
                    )]))
                results.append(messages[-1].content[0].text)
                return Completion(model, Msg("assistant", [Text(f"Found {expected_text}.")]))

            return fake_complete

        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel(cwd=str(tmp_path))
        try:
            await _execute_setup(kernel, (
                "from nbinlineai.tools import search_kernel_names, list_notebooks, "
                "find_notebook_cells, read_notebook_cell\n"
                "study_roster_marker = {'Ada': 8}"
            ))
            dispatcher = KernelDispatcher(_NotebookSessions(), _NotebookKernels(kernel))
            kernel_id, bound_kernel = await dispatcher.resolve("test-session")
            for name, arguments, expected in cases:
                seen_results: list[str] = []
                state = {"calls": 0}
                monkeypatch.setattr(providers, "complete", fake_for(
                    name, arguments, expected, seen_results, state
                ))
                events = [event async for event in run_prompt(
                    _request(f"Use &`{name}` for this task."), dispatcher, kernel_id, bound_kernel
                )]
                assert state["calls"] == 2
                assert [event["type"] for event in events] == [
                    "context", "tool_start", "tool_result", "text_delta", "done"
                ]
                assert events[0]["tools"] == [name]
                assert expected in seen_results[0]
        finally:
            await kernel.shutdown_kernel(now=True)

    asyncio.run(run())

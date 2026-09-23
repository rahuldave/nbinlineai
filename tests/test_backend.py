"""Provider loop and real IPython kernel bridge regressions."""

import asyncio

import pytest
from aidialog.msg_parts import Completion, Msg, Refusal, Text, Thinking, ToolUse
from jupyter_client import AsyncKernelManager

from nbinlineai import providers
from nbinlineai.config import DEFAULT_MODELS, MODEL_CHOICES
from nbinlineai.kernel import KernelDispatcher
from nbinlineai.prompt import _history, _source_context, run_prompt, validate_request
from nbinlineai.tool_schema import fastllm_tool


@pytest.fixture(autouse=True)
def isolated_key_store(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))


def _body(prompt="What is $`x`? Use &`add`."):
    return {
        "prompt": prompt,
        "session_id": "session-1",
        "prompt_cell_id": "prompt-2",
        "preceding_cells": [{"id": "code-1", "cell_type": "code", "source": "x = 7"}],
        "backend": "openai_api",
        "model": "test-model",
        "max_tool_steps": 3,
    }


async def _execute_user_code(kernel, code):
    client = kernel.client()
    client.start_channels()
    try:
        await client.wait_for_ready(timeout=15)
        msg_id = client.execute(code)
        while True:
            msg = await client.get_iopub_msg(timeout=10)
            if msg.get("parent_header", {}).get("msg_id") != msg_id:
                continue
            if msg.get("msg_type") == "status" and msg["content"].get("execution_state") == "idle":
                return
    finally:
        client.stop_channels()


class _Sessions:
    def __init__(self, kernel):
        self.kernel = kernel

    async def get_session(self, *, session_id):
        if session_id != "session-1":
            from tornado.web import HTTPError
            raise HTTPError(404)
        return {"type": "notebook", "kernel": {"id": "kernel-1", "name": "python3"}}


class _Kernels:
    def __init__(self, kernel):
        self.kernel = kernel

    def __contains__(self, kernel_id):
        return kernel_id == "kernel-1"

    def get_kernel(self, kernel_id):
        return self.kernel


def test_live_kernel_introspection_dispatch_and_provider_loop(monkeypatch):
    async def run():
        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel()
        try:
            await _execute_user_code(kernel, "x = 7\ndef add(n: int, delta: int = 2):\n    return n + delta\ndef collect(values: list[int]):\n    return sum(values)\ndef bad(*args):\n    return args\nasync def async_tool():\n    return 1")
            dispatcher = KernelDispatcher(_Sessions(kernel), _Kernels(kernel))
            kernel_id, bound_kernel = await dispatcher.resolve("session-1")
            info = await dispatcher.inspect(kernel_id, bound_kernel, ["x"], ["add"])
            assert info["x"]["repr"] == "7"
            assert info["add"]["parameters"]["delta"]["default"] == "2"
            generic = await dispatcher.inspect(kernel_id, bound_kernel, [], ["collect"])
            assert fastllm_tool("collect", generic["collect"])["parameters"]["properties"]["values"]["items"] == {"type": "integer"}
            assert await dispatcher.call("session-1", kernel_id, bound_kernel, {"add"}, "add", {"n": 5}) == "7"
            with pytest.raises(ValueError, match="not registered"):
                await dispatcher.call("session-1", kernel_id, bound_kernel, {"add"}, "other", {})
            with pytest.raises(ValueError, match="invalid JSON"):
                await dispatcher.call("session-1", kernel_id, bound_kernel, {"add"}, "add", "{")
            with pytest.raises(ValueError, match="argument name"):
                await dispatcher.call("session-1", kernel_id, bound_kernel, {"add"}, "add", {"x.y": 1})
            with pytest.raises(ValueError, match="Async tool functions"):
                await dispatcher.call("session-1", kernel_id, bound_kernel, {"async_tool"}, "async_tool", {})
            await _execute_user_code(kernel, "helper_count = len([name for name in get_ipython().user_ns if name.startswith('_nbinlineai_bridge_')])")
            assert (await dispatcher.inspect(kernel_id, bound_kernel, ["helper_count"], []))["helper_count"]["repr"] == "0"

            calls = []

            async def fake_complete(backend, model, messages, tools):
                calls.append((backend, model, messages, tools))
                if len(calls) == 1:
                    return Completion(model, Msg("assistant", [ToolUse(id="c1", name="add", arguments={"n": 5})]))
                assert messages[-1].role == "tool"
                assert messages[-1].content[0].text == "7"
                return Completion(model, Msg("assistant", [Text("The answer is 7.")]))

            monkeypatch.setattr(providers, "complete", fake_complete)
            events = [event async for event in run_prompt(_body(), dispatcher, kernel_id, bound_kernel)]
            assert [event["type"] for event in events] == ["context", "tool_start", "tool_result", "text_delta", "done"]
            assert events[0]["variables"]["x"]["repr"] == "7"
            assert events[2]["text"] == "7"
            assert "x = 7" in calls[0][2][0].text
            assert "7" in calls[0][2][1].text
            with pytest.raises(ValueError, match="Unsupported function signature"):
                async for _ in run_prompt(_body("Use &`bad`"), dispatcher, kernel_id, bound_kernel):
                    pass
        finally:
            await kernel.shutdown_kernel(now=True)

    asyncio.run(run())


def test_history_only_complete_pairs():
    cells = [
        {"id": "p1", "cell_type": "markdown", "source": "question", "metadata": {"nbinlineai": {"isPromptCell": True}}},
        {"id": "o1", "cell_type": "markdown", "source": "answer", "metadata": {"nbinlineai": {"isOutputCell": True, "promptCellId": "p1", "status": "done"}}},
        {"id": "p2", "cell_type": "markdown", "source": "pending", "metadata": {"nbinlineai": {"isPromptCell": True}}},
        {"id": "o2", "cell_type": "markdown", "source": "partial", "metadata": {"nbinlineai": {"isOutputCell": True, "promptCellId": "p2", "status": "running"}}},
    ]
    assert [(m.role, m.text) for m in _history(cells)] == [("user", "question"), ("assistant", "answer")]


@pytest.mark.parametrize("backend", ["openai_api", "anthropic_api"])
def test_mixed_notebook_source_is_ordered_without_ai_history_duplication(monkeypatch, backend):
    cells = [
        {"id": "md-1", "cell_type": "markdown", "source": "# Study notes"},
        {"id": "code-1", "cell_type": "code", "source": "x = 7", "execution_count": 3},
        {"id": "prompt-1", "cell_type": "markdown", "source": "Earlier AI question", "metadata": {"nbinlineai": {"isPromptCell": True}}},
        {"id": "answer-1", "cell_type": "markdown", "source": "Earlier AI answer", "metadata": {"nbinlineai": {"isOutputCell": True, "promptCellId": "prompt-1", "status": "done"}}},
        {"id": "prompt-2", "cell_type": "markdown", "source": "Pending AI question", "metadata": {"nbinlineai": {"is_prompt_cell": True}}},
        {"id": "answer-2", "cell_type": "markdown", "source": "Failed AI answer", "metadata": {"nbinlineai": {"role": "response", "prompt_cell_id": "prompt-2", "status": "error"}}},
        {"id": "orphan", "cell_type": "markdown", "source": "Orphan AI answer", "metadata": {"nbinlineai": {"is_output_cell": True, "prompt_cell_id": "missing"}}},
        {"id": "raw-1", "cell_type": "raw", "source": "RAW CELL"},
        {"id": "md-2", "cell_type": "markdown", "source": "Interpret x as seven."},
    ]
    captured = {}

    async def fake_complete(selected_backend, model, messages, tools):
        captured.update(backend=selected_backend, messages=messages)
        return Completion(model, Msg("assistant", [Text("OK")]))

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def run():
        return [event async for event in run_prompt({**_body("Summarize"), "backend": backend, "preceding_cells": cells}, None, "kernel-1", None)]

    events = asyncio.run(run())
    assert captured["backend"] == backend
    system = captured["messages"][0].text
    assert system.index("# Study notes") < system.index("x = 7") < system.index("Interpret x as seven.")
    assert "Markdown cell md-1" in system and "Code cell code-1" in system
    assert "execution count 3" in system
    for omitted in ("Earlier AI question", "Earlier AI answer", "Pending AI question", "Failed AI answer", "Orphan AI answer", "RAW CELL"):
        assert omitted not in system
    assert [(message.role, message.text) for message in captured["messages"][1:]] == [
        ("user", "Earlier AI question"), ("assistant", "Earlier AI answer"), ("user", "Summarize")
    ]
    context = events[0]
    assert context["code_cells"] == 1 and context["markdown_cells"] == 2
    assert context["code_chars"] == len("x = 7")
    assert context["markdown_chars"] == len("# Study notes") + len("Interpret x as seven.")
    assert context["source_chars"] == context["code_chars"] + context["markdown_chars"]


def test_combined_source_limit_and_malformed_metadata():
    cells = [
        {"id": "m", "cell_type": "markdown", "source": "m" * 30000, "metadata": "broken"},
        {"id": "c", "cell_type": "code", "source": "c" * 25000, "metadata": {"nbinlineai": "broken"}},
        {"id": "after", "cell_type": "markdown", "source": "SHOULD_NOT_APPEAR"},
    ]
    source, counts = _source_context(cells)
    assert counts == {"code_cells": 1, "markdown_cells": 1, "code_chars": 20000,
                      "markdown_chars": 30000, "source_chars": 50000, "source_truncated": True}
    assert "SHOULD_NOT_APPEAR" not in source
    assert source.index("Markdown cell m") < source.index("Code cell c")
    assert len(_history(cells)) == 0


def test_request_rejects_bad_backend_and_args(monkeypatch):
    monkeypatch.setattr("nbinlineai.config.load_server_env", lambda: None)
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    with pytest.raises(ValueError, match="Unsupported API backend"):
        validate_request({**_body(), "backend": "openai_codex_subscription"})
    with pytest.raises(ValueError, match="max_tool_steps"):
        validate_request({**_body(), "max_tool_steps": 100})
    with pytest.raises(ValueError, match="Invalid model"):
        validate_request({**_body(), "model": "../bad"})


def test_model_defaults_and_custom_ids_are_preserved(monkeypatch):
    monkeypatch.setattr("nbinlineai.prompt.provider_status", lambda: {
        "openai_api": {"configured": True}, "anthropic_api": {"configured": True}
    })
    for backend, default in DEFAULT_MODELS.items():
        request = {**_body(), "backend": backend}
        request.pop("model")
        assert validate_request(request)["model"] == default
        custom = {**_body(), "backend": backend, "model": "custom-model-v2:latest"}
        assert validate_request(custom)["model"] == "custom-model-v2:latest"


def test_fastllm_builds_native_payloads_for_listed_models():
    import fastllm.anthropic
    import fastllm.openai_responses  # noqa: F401 - registers adapter
    from fastllm.types import api_registry

    messages = [Msg("user", [Text("Hello")])]
    for backend, api in (("openai_api", "openai"), ("anthropic_api", "anthropic")):
        for model in MODEL_CHOICES[backend]:
            payload = api_registry[api].mk_payload(messages, model, system="Notebook context", stream=True,
                                                   max_tokens=128, tools=[])
            if fix := getattr(api_registry[api], "fix_payload", None):
                fix(payload, model, api)
            assert payload["model"] == model
            assert payload["stream"] is True


def test_anthropic_tool_replay_preserves_empty_thinking_and_signature():
    from fastllm.anthropic import denorm_assistant

    raw = {"role": "assistant", "content": [
        {"type": "thinking", "thinking": "", "signature": "signed-block"},
        {"type": "tool_use", "id": "call_1", "name": "add", "input": {"a": 1, "b": 2}},
    ]}
    message = Msg("assistant", [Thinking(""), ToolUse(id="call_1", name="add", arguments={"a": 1, "b": 2})], raw=raw)
    assert denorm_assistant(message) == raw


@pytest.mark.parametrize("backend,vendor,key", [
    ("openai_api", "openai", "OPENAI_API_KEY"),
    ("anthropic_api", "anthropic", "ANTHROPIC_API_KEY"),
])
def test_provider_passes_notebook_context_as_system(monkeypatch, backend, vendor, key):
    monkeypatch.setattr("nbinlineai.config.load_server_env", lambda: None)
    monkeypatch.setenv(key, "test-only")
    received = {}

    async def fake_acomplete(messages, model, **kwargs):
        received.update({"messages": messages, "model": model, **kwargs})
        return object()

    monkeypatch.setattr(providers, "acomplete", fake_acomplete)
    messages = [Msg("system", [Text("Notebook code: x = 7")]), Msg("user", [Text("What is x?")])]
    asyncio.run(providers.complete(backend, "test-model", messages, []))
    assert received["system"] == "Notebook code: x = 7"
    assert [message.role for message in received["messages"]] == ["user"]
    assert received["vendor_name"] == vendor
    assert received["stream"] is True
    assert received["retries"] == 0


@pytest.mark.parametrize("completion,message", [
    (Completion("test-model", Msg("assistant", [])), "empty response"),
    (Completion("test-model", Msg("assistant", [Refusal("No thanks")])), "No thanks"),
    (Completion("test-model", Msg("assistant", [Text("partial")]), finish_reason="length"), "output limit"),
])
def test_provider_terminal_errors(monkeypatch, completion, message):
    async def fake_complete(*_args):
        return completion

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def run():
        with pytest.raises(ValueError, match=message):
            async for _ in run_prompt(_body("Hello"), None, "kernel-1", None):
                pass

    asyncio.run(run())


def test_array_tool_schema_has_typed_items():
    tool = fastllm_tool("collect", {"parameters": {"values": {"type": "list[int]"}}})
    assert tool["parameters"]["properties"]["values"]["items"] == {"type": "integer"}


def test_fastllm_native_payload_keeps_context_for_both_apis():
    import fastllm.anthropic
    import fastllm.openai_responses  # noqa: F401 - registers adapter
    from fastllm.types import api_registry

    messages = [Msg("user", [Text("What is x?")])]
    for api, key in (("openai", "instructions"), ("anthropic", "system")):
        payload = api_registry[api].mk_payload(messages, "test-model", system="Notebook code: x = 7", max_tokens=16)
        assert payload[key] == "Notebook code: x = 7"


@pytest.mark.parametrize("call_name,limit,expected", [
    ("evil", 3, "not registered"),
    ("add", 0, "Tool step limit"),
])
def test_model_cannot_execute_unregistered_or_excess_tool(monkeypatch, call_name, limit, expected):
    class Dispatcher:
        def __init__(self):
            self.calls = 0

        async def inspect(self, *_args):
            return {"add": {"parameters": {}}}

        async def call(self, *_args):
            self.calls += 1
            return "called"

    dispatcher = Dispatcher()

    async def fake_complete(*_args):
        return Completion("test-model", Msg("assistant", [ToolUse(id="c1", name=call_name, arguments={})]))

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def run():
        with pytest.raises(ValueError, match=expected):
            async for _ in run_prompt({**_body("Use &`add`"), "max_tool_steps": limit}, dispatcher, "kernel-1", None):
                pass

    asyncio.run(run())
    assert dispatcher.calls == 0


def test_streaming_parts_and_final_completion(monkeypatch):
    async def fake_complete(*_args):
        async def chunks():
            yield Text("Hello")
            yield Text(" world")
            yield Completion("test-model", Msg("assistant", [Text("Hello world")]))
        return chunks()

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def run():
        return [event async for event in run_prompt(_body("Hello"), None, "kernel-1", None)]

    events = asyncio.run(run())
    assert [event["type"] for event in events] == ["context", "text_delta", "text_delta", "done"]
    assert "".join(event["text"] for event in events if event["type"] == "text_delta") == "Hello world"


@pytest.mark.parametrize("ids", [["same", "same"], [f"c{i}" for i in range(11)]])
def test_excess_or_duplicate_model_tool_calls_are_rejected(monkeypatch, ids):
    async def fake_complete(*_args):
        return Completion("test-model", Msg("assistant", [
            ToolUse(id=call_id, name="a", arguments={}) for call_id in ids
        ]))

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def run():
        with pytest.raises(ValueError, match="too many or duplicate tool calls"):
            async for _ in run_prompt(_body("Hello"), None, "kernel-1", None):
                pass

    asyncio.run(run())

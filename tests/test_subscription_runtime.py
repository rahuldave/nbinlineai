"""Deterministic boundaries for the private ChatGPT App Server adapter."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest
from aidialog.msg_parts import Msg, Refusal, Text

from nbinlineai import subscription_runtime as runtime


def _tool() -> dict:
    return {"type": "function", "name": "add", "description": "Add one number",
            "parameters": {"type": "object", "properties": {"n": {"type": "integer"}},
                           "required": ["n"]}, "strict": False}


def _scope(root: Path) -> dict:
    working = root / "notebooks"
    working.mkdir()
    return {"session_id": "s1", "notebook_path": "notebooks/a.ipynb",
            "working_folder": str(working), "project_root": str(root),
            "file_access_root": str(root), "access": "project"}


def test_round_cost_counts_exact_double_escaped_host_payload():
    messages = [Msg("user", [Text('line one\n"quoted"')])]
    tools = [_tool()]
    text = runtime._round_text(messages, tools)
    expected = runtime._compact({
        "baseInstructions": runtime.ROUND_INSTRUCTIONS,
        "input": [{"type": "text", "text": text}],
        "outputSchema": runtime.OUTPUT_SCHEMA,
    })
    assert runtime.round_wire_cost(messages, tools) == (
        len(expected) + runtime.RPC_METADATA_RESERVE
    )
    assert len(expected) > len(text) + len(runtime.ROUND_INSTRUCTIONS)


def test_structured_answer_refusal_and_group_are_strictly_decoded():
    answer = runtime._decode_plan("gpt-6-sol", json.dumps({
        "kind": "answer", "text": "Done", "reason": None, "calls": [],
    }), [_tool()])
    assert answer.message.text == "Done"
    refusal = runtime._decode_plan("gpt-6-sol", json.dumps({
        "kind": "refusal", "text": None, "reason": "Cannot help", "calls": [],
    }), [_tool()])
    assert isinstance(refusal.message.content[0], Refusal)
    plan = runtime._decode_plan("gpt-6-sol", json.dumps({
        "kind": "tools", "text": None, "reason": None,
        "calls": [{"id": "c1", "name": "add", "arguments_json": '{"n":1}'}],
    }), [_tool()])
    assert len(plan.tool_calls) == 1
    assert plan.tool_calls[0].arguments == {"n": 1}
    assert plan.tool_calls[0].server is False
    for payload in (
        {"kind": "tools", "text": None, "reason": None,
         "calls": [{"id": "c1", "name": "unknown", "arguments_json": "{}"}]},
        {"kind": "answer", "text": "X", "reason": None, "calls": [{}]},
        {"kind": "tools", "text": None, "reason": None,
         "calls": [{"id": "c1", "name": "add", "arguments_json": "[]"}]},
    ):
        with pytest.raises(runtime.SubscriptionRuntimeError):
            runtime._decode_plan("gpt-6-sol", json.dumps(payload), [_tool()])


def test_child_environment_excludes_provider_and_host_overrides(monkeypatch, tmp_path):
    for name in ("OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL",
                 "CODEX_APP_TOOLS_PIPE_PATH", "AWS_WEB_IDENTITY_TOKEN_FILE",
                 "AZURE_OPENAI_API_KEY", "CODEX_HOME", "CHATGPT_BASE_URL"):
        monkeypatch.setenv(name, "SYNTHETIC_POISON")
    clean = runtime._clean_env(tmp_path)
    assert clean["CODEX_HOME"] == str(tmp_path)
    assert clean["HOME"] == str(tmp_path)
    assert "SYNTHETIC_POISON" not in clean.values()
    command = runtime._command(Path("/synthetic/codex"))
    assert 'model_provider="openai"' in command
    assert "features.goals=false" in command
    assert "skills.include_instructions=false" in command


def test_managed_state_rejects_custom_runtime_config(tmp_path):
    home = runtime._state_home(tmp_path / "private")
    (home / "config.toml").write_text(
        '[model_providers.openai]\nbase_url = "https://example.invalid"\n'
    )
    with pytest.raises(runtime.SubscriptionRuntimeError, match="unsupported configuration"):
        runtime._state_home(home)


FAKE_SERVER = r'''#!/usr/bin/env python3
import json
import os
import sys

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    item = json.loads(line)
    if "id" not in item:
        continue
    method = item.get("method")
    params = item.get("params") or {}
    if method == "initialize":
        result = {}
    elif method == "account/read":
        result = {"account": {"type": "chatgpt", "email": "student@example.test"}}
    elif method == "model/list":
        result = {"data": [{"id": "gpt-6-sol", "model": "gpt-6-sol", "hidden": False,
                 "displayName": "Test model", "supportedReasoningEfforts": [
                     {"reasoningEffort": "medium", "description": "Test"}],
                 "defaultReasoningEffort": "medium"}], "nextCursor": None}
    elif method == "account/rateLimits/read":
        result = {"ordinaryUsageAllowed": True, "rateLimits": {
                  "primary": {"usedPercent": 25, "resetsAt": 1800000000}}}
    elif method == "account/login/start":
        result = {"loginId": "login-1", "authUrl": "https://auth.example.test/start"}
    elif method == "thread/start":
        if (os.getcwd() != os.environ["CODEX_HOME"] or
                "cwd" in params or params.get("modelProvider") != "openai" or
                params.get("environments") != [] or
                params.get("dynamicTools") != [] or
                not params.get("ephemeral")):
            send({"id": item["id"], "error": {"code": -1}})
            continue
        result = {"thread": {"id": "thread-1", "modelProvider": "openai",
                              "ephemeral": True}}
    elif method == "turn/start":
        result = {"turn": {"id": "turn-1"}}
    else:
        result = {}
    send({"id": item["id"], "result": result})
    if method == "turn/start":
        content = params["input"][0]["text"]
        if "WAIT_FOREVER" in content:
            continue
        payload = {"kind": "answer", "text": "OK", "reason": None, "calls": []}
        send({"method": "item/completed", "params": {"threadId": "thread-1",
              "turnId": "turn-1", "item": {"type": "agentMessage",
              "text": json.dumps(payload)}}})
        send({"method": "turn/completed", "params": {"threadId": "thread-1",
              "turn": {"id": "turn-1", "status": "completed"}}})
'''


def test_round_uses_private_cwd_and_cancels_only_its_child(tmp_path, monkeypatch):
    asyncio.run(_exercise_private_rounds(tmp_path, monkeypatch))


async def _exercise_private_rounds(tmp_path, monkeypatch):
    fake = tmp_path / "fake_server.py"
    fake.write_text(FAKE_SERVER)
    monkeypatch.setattr(runtime, "_command", lambda *_: [sys.executable, str(fake)])
    manager = runtime.SubscriptionRuntime(state_directory=tmp_path / "private", binary=fake)
    async def bundled():
        return {"gpt-6-sol": {"slug": "gpt-6-sol", "tool_mode": "code_mode_only"}}
    monkeypatch.setattr(manager, "_bundled_models", bundled)
    project = tmp_path / "project"
    project.mkdir()
    scope = _scope(project)
    (project / ".codex").mkdir()
    (project / ".codex" / "config.toml").write_text(
        'developer_instructions = "POISONED_PROJECT_CONFIG_MARKER"\n'
    )
    status = await manager.status()
    assert status["auth_mode"] == "chatgpt"
    assert status["configured"] is True
    assert status["models"][0]["id"] == "gpt-6-sol"
    assert status["usage"]["remaining_percent"] == 75
    original_usage = manager.usage
    async def limited_usage():
        return {"state": "limited", "remaining_percent": 0}
    monkeypatch.setattr(manager, "usage", limited_usage)
    assert (await manager.status())["state"] == "limited"
    monkeypatch.setattr(manager, "usage", original_usage)
    waiting = asyncio.create_task(manager.complete_round(
        "gpt-6-sol", [Msg("user", [Text("WAIT_FOREVER")])], [_tool()],
        reasoning_effort="medium", scope=scope, run_id="waiting",
    ))
    for _ in range(100):
        if "waiting" in manager._runs:
            break
        await asyncio.sleep(0.01)
    answer = await manager.complete_round(
        "gpt-6-sol", [Msg("user", [Text("Answer")])], [],
        reasoning_effort=None, scope=scope, run_id="sibling",
    )
    assert answer.message.text == "OK"
    await asyncio.gather(manager.cancel("waiting"), manager.cancel("waiting"))
    with pytest.raises(asyncio.CancelledError):
        await waiting
    await manager.disconnect()
    assert not manager._runs
    assert (await manager.status())["configured"] is False
    with pytest.raises(runtime.SubscriptionRuntimeError, match="disconnected"):
        await manager.complete_round(
            "gpt-6-sol", [Msg("user", [Text("Answer")])], [],
            reasoning_effort=None, scope=scope, run_id="blocked",
        )
    with pytest.raises(runtime.SubscriptionRuntimeError, match="device sign-in"):
        await manager.start_login("device")
    assert (await manager.status())["configured"] is False
    login = await manager.start_login("browser")
    assert login["login_id"] == "login-1"
    assert (await manager.status())["state"] == "connecting"
    await manager.cancel_login("login-1")
    assert (await manager.status())["configured"] is False
    login = await manager.start_login("browser")
    assert (await manager.status())["state"] == "connecting"
    assert manager._control is not None
    manager._control.notifications.put_nowait({
        "method": "account/login/completed",
        "params": {"loginId": login["login_id"], "success": True},
    })
    assert (await manager.status())["configured"] is True
    await manager.close()

"""Capture a Codex turn's tool names against a local fake model endpoint.

This spends no subscription or API allowance. It uses an isolated Codex home,
one dummy provider key, and a synthetic model catalog. No request payload or
credential value is printed.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nbinlineai.subscription_runtime import _CONFIG, OUTPUT_SCHEMA, _clean_env


def packaged_binary() -> Path:
    dist = importlib.metadata.distribution("openai-codex-cli-bin")
    for entry in dist.files or ():
        if str(entry).replace("\\", "/") in {
            "codex_cli_bin/bin/codex", "codex_cli_bin/bin/codex.exe",
        }:
            return Path(dist.locate_file(entry))
    raise RuntimeError("Packaged Codex executable is missing")


def one_sanitized_model(binary: Path, env: dict[str, str], slug: str) -> dict:
    result = subprocess.run(
        [str(binary), "debug", "models", "--bundled"],
        env=env,
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    catalog = json.loads(result.stdout)
    model = next(item for item in catalog["models"] if item["slug"] == slug)
    model["apply_patch_tool_type"] = None
    model["experimental_supported_tools"] = []
    model["tool_mode"] = "direct"
    model["multi_agent_version"] = None
    model["supports_search_tool"] = False
    return model


def sse(*events: dict) -> bytes:
    return "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
                   for event in events).encode()


def structured_payload(scenario: str) -> dict:
    return {
        "answer": {"kind": "answer", "text": "OK", "reason": None, "calls": []},
        "refusal": {"kind": "refusal", "text": None, "reason": "No", "calls": []},
        "tool_plan": {"kind": "tools", "text": None, "reason": None,
                      "calls": [{"id": "c1", "name": "synthetic_tool",
                                 "arguments_json": '{"x":1}'}]},
        "unexpected": {"kind": "answer", "text": "OK", "reason": None, "calls": []},
    }[scenario]


async def main(*, scenario: str = "inventory", model_slug: str = "gpt-6-sol") -> None:
    binary = packaged_binary()
    with tempfile.TemporaryDirectory(prefix="nbinlineai-inventory-probe-") as folder:
        root = Path(folder)
        codex_home = root / "codex-home"
        codex_home.mkdir()
        env = _clean_env(codex_home)
        env["NBINLINEAI_PROBE_KEY"] = "synthetic-dummy-key"
        project = root / "poisoned-project"
        (project / ".codex").mkdir(parents=True)
        (project / ".codex" / "config.toml").write_text(
            'developer_instructions = "POISONED_PROJECT_CONFIG_MARKER"\n'
            '[model_providers.openai]\nname = "Poisoned provider"\n'
            'base_url = "https://example.invalid"\n'
        )
        model = one_sanitized_model(binary, env, model_slug)
        catalog_path = root / "models.json"
        catalog_path.write_text(json.dumps({"models": [model]}))

        captured: asyncio.Future[dict] = asyncio.get_running_loop().create_future()
        requests_seen: list[dict] = []
        second_request_at: float | None = None

        async def handle_http(reader: asyncio.StreamReader,
                              writer: asyncio.StreamWriter) -> None:
            nonlocal second_request_at
            try:
                headers = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=15)
                header_lines = headers.decode("latin-1").split("\r\n")
                length = next((int(line.split(":", 1)[1].strip())
                               for line in header_lines[1:]
                               if line.lower().startswith("content-length:")), 0)
                body = await asyncio.wait_for(reader.readexactly(length), timeout=15)
                requests_seen.append(json.loads(body))
                if len(requests_seen) == 2:
                    second_request_at = time.monotonic()
                if not captured.done():
                    captured.set_result(requests_seen[-1])
                if scenario != "inventory":
                    if scenario == "unexpected" and len(requests_seen) == 1:
                        patch = "*** Begin Patch\n*** Add File: unexpected.txt\n+BAD\n*** End Patch"
                        events = (
                            {"type": "response.created", "response": {"id": "resp-1"}},
                            {"type": "response.output_item.done", "item": {
                                "type": "custom_tool_call", "name": "apply_patch",
                                "input": patch, "call_id": "unexpected-call"}},
                            {"type": "response.completed", "response": {"id": "resp-1",
                                "usage": {"input_tokens": 0, "input_tokens_details": None,
                                          "output_tokens": 0, "output_tokens_details": None,
                                          "total_tokens": 0}}},
                        )
                    else:
                        answer = structured_payload(scenario)
                        events = (
                            {"type": "response.created", "response": {"id": "resp-2"}},
                            {"type": "response.output_item.done", "item": {
                                "type": "message", "role": "assistant", "id": "msg-2",
                                "content": [{"type": "output_text", "text":
                                             json.dumps(answer)}]}},
                            {"type": "response.completed", "response": {"id": "resp-2",
                                "usage": {"input_tokens": 0, "input_tokens_details": None,
                                          "output_tokens": 0, "output_tokens_details": None,
                                          "total_tokens": 0}}},
                        )
                    payload = sse(*events)
                    status = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                else:
                    payload = b'{"error":{"message":"synthetic probe complete"}}'
                    status = b"HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n"
                writer.write(status + f"Content-Length: {len(payload)}\r\n"
                             "Connection: close\r\n\r\n".encode() + payload)
                await writer.drain()
            except (asyncio.TimeoutError, ValueError, json.JSONDecodeError):
                pass
            finally:
                writer.close()
                await writer.wait_closed()

        server = await asyncio.start_server(handle_http, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        provider = ("model_providers.mock={name=\"Synthetic mock\","
                    f"base_url=\"http://127.0.0.1:{port}/v1\","
                    "env_key=\"NBINLINEAI_PROBE_KEY\",wire_api=\"responses\"}")
        options = [*_CONFIG, 'model_provider="mock"', provider,
                   "model_catalog_json=" + json.dumps(str(catalog_path))]
        command = [str(binary)]
        for option in options:
            command.extend(["-c", option])
        command.extend(["app-server", "--listen", "stdio://"])
        child = await asyncio.create_subprocess_exec(
            *command, cwd=codex_home, env=env,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        next_id = 0

        async def request(method: str, params: dict) -> dict:
            nonlocal next_id
            next_id += 1
            assert child.stdin is not None and child.stdout is not None
            child.stdin.write((json.dumps({"jsonrpc": "2.0", "id": next_id,
                                          "method": method, "params": params}) + "\n").encode())
            await child.stdin.drain()
            while True:
                line = await asyncio.wait_for(child.stdout.readline(), timeout=25)
                if not line:
                    raise RuntimeError(f"App Server exited during {method}")
                message = json.loads(line)
                if "id" in message and "method" in message:
                    child.stdin.write((json.dumps({"jsonrpc": "2.0", "id": message["id"],
                                                   "error": {"code": -32601,
                                                             "message": "Denied"}}) + "\n").encode())
                    await child.stdin.drain()
                    continue
                if message.get("id") == next_id:
                    if "error" in message:
                        code = message["error"].get("code", "unknown")
                        raise RuntimeError(f"{method} failed with RPC code {code}")
                    return message.get("result", {})

        try:
            await request("initialize", {"clientInfo": {"name": "inventory_probe",
                                                        "title": "Inventory probe",
                                                        "version": "0.0.0"},
                                         "capabilities": {"experimentalApi": True}})
            assert child.stdin is not None
            child.stdin.write(b'{"jsonrpc":"2.0","method":"initialized"}\n')
            await child.stdin.drain()
            started = await request("thread/start", {"model": model_slug,
                                                       "modelProvider": "mock",
                                                       "ephemeral": True,
                                                       "experimentalRawEvents": True,
                                                       "approvalPolicy": "never",
                                                       "environments": [],
                                                       "dynamicTools": [],
                                                       "baseInstructions": "Synthetic inventory probe.",
                                                       "developerInstructions": ""})
            if started.get("thread", {}).get("modelProvider") != "mock":
                raise RuntimeError("Unexpected model provider")
            if started.get("instructionSources"):
                raise RuntimeError("Ambient project instructions were loaded")
            await request("turn/start", {"threadId": started["thread"]["id"],
                                         "input": [{"type": "text", "text": "Reply OK."}],
                                         "outputSchema": OUTPUT_SCHEMA})
            body = await asyncio.wait_for(captured, timeout=25)
            if "POISONED_PROJECT_CONFIG_MARKER" in json.dumps(body):
                raise RuntimeError("Project config leaked into model request")
            names = sorted(tool.get("name", "<unnamed>") for tool in body.get("tools", []))
            print("runtime_package_version:", importlib.metadata.version("openai-codex-cli-bin"))
            print("model_slug:", model_slug)
            print("catalog_model_count: 1")
            print("requested_environment_count: 0")
            print("offered_tool_count:", len(names))
            print("offered_tool_names:", ",".join(names))
            print("wire_instructions_chars:", len(body.get("instructions") or ""))
            print("wire_input_json_chars:", len(json.dumps(body.get("input", []))))
            print("wire_input_items:", ",".join(
                f"{item.get('role', item.get('type', '?'))}:{len(json.dumps(item))}"
                for item in body.get("input", [])
            ))
            print("wire_input_item_keys:", ",".join(
                "/".join(sorted(item)) for item in body.get("input", [])
            ))
            print("wire_input_tool_meta_chars:", ",".join(
                str(len(json.dumps(item.get("tools")))) if "tools" in item else "-"
                for item in body.get("input", [])
            ))
            inline_tool_names = [
                tool.get("name", "?")
                for namespace in body["input"][0].get("tools", [])
                for tool in namespace.get("tools", [])
            ]
            print("wire_input_tool_names:", ",".join(inline_tool_names))
            print("wire_output_schema_json_chars:", len(json.dumps(body.get("text", {}))))
            print("wire_top_level_keys:", ",".join(sorted(body)))
            print("wire_tool_choice:", body.get("tool_choice"))
            print("managed_config_created:", (codex_home / "config.toml").exists())
            if names:
                raise RuntimeError("Native tools were offered")
            if inline_tool_names:
                raise RuntimeError("Code-mode tool metadata was offered")
            if [item.get("role") for item in body.get("input", [])] != [
                "developer", "developer", "user"
            ]:
                raise RuntimeError("Unexpected ambient history or instructions")
            if scenario != "inventory":
                # Allow the runtime to process the local mock's unexpected call.
                # A failed tool lookup may cause one additional synthetic request.
                assert child.stdout is not None
                observed = []
                completed_items = []
                first_raw_tool_at: float | None = None
                try:
                    while True:
                        line = await asyncio.wait_for(child.stdout.readline(), timeout=8)
                        if not line:
                            break
                        message = json.loads(line)
                        if "method" in message:
                            observed.append(message["method"])
                        if message.get("method") == "rawResponseItem/completed" and (
                            (params := message.get("params") or {}).get("item") or {}
                        ).get("type") == "custom_tool_call":
                            first_raw_tool_at = time.monotonic()
                        params = message.get("params") or {}
                        if message.get("method") == "item/completed":
                            completed_items.append(params.get("item"))
                        if message.get("method") == "turn/completed" and (
                            params.get("turn") or {}
                        ).get("id"):
                            break
                except asyncio.TimeoutError:
                    pass
                print("mock_request_count:", len(requests_seen))
                print("app_server_events:", ",".join(observed))
                print("raw_tool_before_second_request:", (
                    first_raw_tool_at is not None and second_request_at is not None
                    and first_raw_tool_at < second_request_at
                ))
                print("completed_item_types:", ",".join(
                    str(item.get("type")) for item in completed_items if isinstance(item, dict)
                ))
                print("completed_item_keys:", ",".join(
                    "/".join(sorted(item)) for item in completed_items if isinstance(item, dict)
                ))
                agent_messages = [item for item in completed_items
                                  if isinstance(item, dict) and item.get("type") == "agentMessage"]
                if scenario == "unexpected":
                    if len(requests_seen) != 2:
                        raise RuntimeError("Unexpected-call continuation outcome changed")
                    print("continuation_input_item_roles:", ",".join(
                        str(item.get("role", item.get("type", "?")))
                        for item in requests_seen[1].get("input", [])
                    ))
                elif len(requests_seen) != 1 or len(agent_messages) != 1 or (
                    json.loads(agent_messages[0].get("text", "null"))
                    != structured_payload(scenario)
                ):
                    raise RuntimeError("Structured round result was not preserved")
                print("unexpected_marker_exists:", (root / "unexpected.txt").exists())
                if (root / "unexpected.txt").exists():
                    raise RuntimeError("Unexpected native tool changed a file")
        finally:
            if child.stdin is not None:
                child.stdin.close()
            try:
                await asyncio.wait_for(child.wait(), timeout=3)
            except asyncio.TimeoutError:
                child.terminate()
                try:
                    await asyncio.wait_for(child.wait(), timeout=3)
                except asyncio.TimeoutError:
                    child.kill()
                    await child.wait()
            server.close()
            await server.wait_closed()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=("inventory", "unexpected", "answer",
                                               "refusal", "tool_plan"), default="inventory")
    parser.add_argument("--model", default="gpt-6-sol")
    args = parser.parse_args()
    asyncio.run(main(scenario=args.scenario, model_slug=args.model))

"""Compatibility probe for the pinned Codex App Server runtime.

Run with ``uv run --no-project --with openai-codex==0.156.1 python
scripts/subscription_runtime_probe.py``. It never prints account details,
credentials, prompt text, or JSON-RPC payloads. By default it starts no model
turn. ``--live-mutation`` spends subscription allowance and edits only a
temporary synthetic folder.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import os
import tempfile
from pathlib import Path


def _packaged_binary() -> Path:
    distribution = importlib.metadata.distribution("openai-codex-cli-bin")
    for entry in distribution.files or ():
        if str(entry).replace("\\", "/") in {
            "codex_cli_bin/bin/codex", "codex_cli_bin/bin/codex.exe",
        }:
            return Path(distribution.locate_file(entry))
    raise RuntimeError("The packaged Codex executable is missing")


async def main(*, live_mutation: bool = False) -> None:
    binary = _packaged_binary()
    with tempfile.TemporaryDirectory(prefix="nbinlineai-codex-probe-") as folder:
        root = Path(folder)
        (root / "AGENTS.md").write_text("SYNTHETIC_INSTRUCTION_MARKER\n")
        # The account stays in Codex's own auth store. Strip inherited API and
        # endpoint overrides by name without inspecting or printing values.
        blocked_env_names = {
            "OPENAI_API_KEY", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY",
            "OPENAI_BASE_URL", "CHATGPT_BASE_URL", "CODEX_BASE_URL",
        }
        child_env = {key: value for key, value in os.environ.items()
                     if key not in blocked_env_names}
        child = await asyncio.create_subprocess_exec(
            str(binary),
            "-c", 'model_provider="openai"',
            "-c", 'openai_base_url=""',
            "-c", "project_doc_max_bytes=0",
            "-c", "features.shell_tool=false",
            "-c", "features.unified_exec=false",
            "-c", "features.apps=false",
            "-c", "features.plugins=false",
            "-c", "features.multi_agent=false",
            "-c", "features.view_image=false",
            "-c", "features.sleep_tool=false",
            "-c", 'web_search="disabled"',
            "app-server", "--listen", "stdio://",
            cwd=root,
            env=child_env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        next_id = 0
        pending_notifications: list[dict] = []

        async def request(method: str, params: dict) -> dict:
            nonlocal next_id
            next_id += 1
            assert child.stdin is not None and child.stdout is not None
            child.stdin.write(
                (json.dumps({"jsonrpc": "2.0", "id": next_id, "method": method,
                             "params": params}) + "\n").encode()
            )
            await child.stdin.drain()
            while True:
                line = await asyncio.wait_for(child.stdout.readline(), timeout=20)
                if not line:
                    raise RuntimeError("App Server exited before replying")
                message = json.loads(line)
                if "id" in message and "method" in message:
                    # Reject every server request, including approvals and dynamic tools.
                    child.stdin.write(
                        (json.dumps({"jsonrpc": "2.0", "id": message["id"],
                                     "error": {"code": -32601,
                                               "message": "Denied by compatibility probe"}})
                         + "\n").encode()
                    )
                    await child.stdin.drain()
                    continue
                if message.get("id") != next_id:
                    if "method" in message:
                        pending_notifications.append(message)
                    continue
                if "error" in message:
                    code = message["error"].get("code", "unknown")
                    raise RuntimeError(f"{method} failed with RPC code {code}")
                return message.get("result", {})

        try:
            await request(
                "initialize",
                {"clientInfo": {"name": "nbinlineai_probe", "title": "nbinlineai probe",
                                "version": "0.0.0"},
                 "capabilities": {"experimentalApi": True}},
            )
            assert child.stdin is not None
            child.stdin.write(b'{"jsonrpc":"2.0","method":"initialized"}\n')
            await child.stdin.drain()
            account = await request("account/read", {"refreshToken": False})
            account_data = account.get("account") or {}
            auth_mode = account_data.get("type", "signed_out")
            started = await request(
                "thread/start",
                {"model": "gpt-6-sol", "modelProvider": "openai",
                 "cwd": str(root), "ephemeral": True,
                 "approvalPolicy": "never", "environments": [], "dynamicTools": [],
                 "baseInstructions": "Return only the requested synthetic answer.",
                 "developerInstructions": "No native actions.",
                 "config": {"project_doc_max_bytes": 0,
                            "tools": {"update_plan": {"enabled": False}}}},
            )
            print("runtime_package_version:", importlib.metadata.version("openai-codex-cli-bin"))
            print("auth_mode:", auth_mode)
            print("model_provider:", started.get("thread", {}).get("modelProvider", "unknown"))
            print("ephemeral:", started.get("thread", {}).get("ephemeral"))
            print("instruction_source_count:", len(started.get("instructionSources") or []))
            print("environment_count_requested: 0")
            if live_mutation:
                if auth_mode != "chatgpt":
                    raise RuntimeError("Live probe requires an existing ChatGPT account")
                native = await request(
                    "thread/start",
                    {"model": "gpt-6-sol", "modelProvider": "openai",
                     "cwd": str(root), "ephemeral": True,
                     "approvalPolicy": "never", "sandbox": "workspace-write",
                     "dynamicTools": [], "baseInstructions": "Follow the synthetic request.",
                     "developerInstructions": "No restrictions beyond the sandbox.",
                     "config": {"project_doc_max_bytes": 0,
                                "tools": {"update_plan": {"enabled": False}}}},
                )
                thread_id = native["thread"]["id"]
                if native["thread"].get("modelProvider") != "openai":
                    raise RuntimeError("The runtime selected a non-OpenAI provider")
                result = await request(
                    "turn/start",
                    {"threadId": thread_id,
                     "input": [{"type": "text", "text":
                                "Synthetic compatibility probe: use the native apply_patch tool "
                                "to create probe.txt in the working folder containing OK. "
                                "Then return JSON with kind answer and answer done."}],
                     "outputSchema": {"type": "object",
                                      "properties": {"kind": {"type": "string"},
                                                     "answer": {"type": "string"}},
                                      "required": ["kind", "answer"],
                                      "additionalProperties": False}},
                )
                turn_id = result["turn"]["id"]
                observed_types: set[str] = set()
                status = "timeout"
                assert child.stdout is not None
                for _ in range(400):
                    if pending_notifications:
                        message = pending_notifications.pop(0)
                    else:
                        try:
                            line = await asyncio.wait_for(child.stdout.readline(), timeout=45)
                        except asyncio.TimeoutError:
                            break
                        if not line:
                            status = "closed"
                            break
                        message = json.loads(line)
                    if "id" in message and "method" in message:
                        assert child.stdin is not None
                        child.stdin.write(
                            (json.dumps({"jsonrpc": "2.0", "id": message["id"],
                                         "error": {"code": -32601, "message": "Denied"}})
                             + "\n").encode()
                        )
                        await child.stdin.drain()
                        continue
                    params = message.get("params") or {}
                    observed_turn_id = params.get("turnId") or (params.get("turn") or {}).get("id")
                    if observed_turn_id != turn_id:
                        continue
                    if message.get("method") in ("item/started", "item/completed"):
                        kind = (params.get("item") or {}).get("type")
                        if kind:
                            observed_types.add(kind)
                    if message.get("method") == "turn/completed":
                        status = (params.get("turn") or {}).get("status", "unknown")
                        break
                print("live_turn_status:", status)
                print("live_native_item_types:", ",".join(sorted(observed_types)))
                print("live_native_mutation:", (root / "probe.txt").exists())
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-mutation", action="store_true",
                        help="Uses subscription allowance with synthetic content")
    args = parser.parse_args()
    asyncio.run(main(live_mutation=args.live_mutation))

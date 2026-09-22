"""Start an isolated JupyterLab for browser tests with a deterministic provider.

This file is only used by the test command. It does not alter application settings
or the user's running JupyterLab server.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

from aidialog.msg_parts import Completion, Msg, Text, ToolResult, ToolUse


async def fake_complete(backend: str, model: str, messages: list, tools: list) -> Completion:
    """Echo supplied context, with controlled tool, error, and cancel branches."""
    transcript = "\n".join(
        str(getattr(part, "text", ""))
        for message in messages
        for part in getattr(message, "content", [])
        if isinstance(part, (Text, ToolResult))
    )
    if "E2E_ERROR" in transcript:
        raise RuntimeError("E2E synthetic provider failure")
    if "E2E_SLOW" in transcript:
        await asyncio.sleep(30)
    if "E2E_TOOL" in transcript:
        results = [
            part for message in messages
            for part in getattr(message, "content", [])
            if isinstance(part, ToolResult)
        ]
        if not results:
            tool_name = tools[0]["name"]
            return Completion(
                model=model,
                message=Msg("assistant", [ToolUse(id="e2e-call-1", name=tool_name,
                                                  arguments={"value": 4})]),
            )
    text = f"E2E provider={backend} model={model}\n\n{transcript[-4000:]}"
    return Completion(model=model, message=Msg("assistant", [Text(text)]))


def main() -> None:
    port = int(os.environ.get("NBINLINEAI_E2E_PORT", "8897"))
    if port == 8888:
        raise SystemExit("E2E tests refuse port 8888")
    if not 1 <= port <= 65535:
        raise SystemExit("E2E port must be between 1 and 65535")
    with tempfile.TemporaryDirectory(prefix="nbinlineai-e2e-") as tmp:
        base = Path(tmp)
        for name in ("root", "config", "runtime", "data"):
            (base / name).mkdir()
        kernelspec = base / "data" / "kernels" / "python3"
        kernelspec.mkdir(parents=True)
        (kernelspec / "kernel.json").write_text(json.dumps({
            "argv": [sys.executable, "-m", "ipykernel_launcher",
                     "-f", "{connection_file}"],
            "display_name": "Python 3 (nbinlineai E2E)",
            "language": "python",
        }))
        os.environ["JUPYTER_CONFIG_DIR"] = str(base / "config")
        os.environ["JUPYTER_RUNTIME_DIR"] = str(base / "runtime")
        os.environ["JUPYTER_DATA_DIR"] = str(base / "data")
        live = os.environ.get("NBINLINEAI_E2E_LIVE") == "1"
        if not live:
            # Fake values only make both provider selectors available in status.
            os.environ["OPENAI_API_KEY"] = "e2e-no-network"
            os.environ["ANTHROPIC_API_KEY"] = "e2e-no-network"
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from nbinlineai import providers

        if not live:
            providers.complete = fake_complete
        from jupyterlab.labapp import main as lab_main

        sys.argv = [
            "jupyter-lab",
            f"--ServerApp.port={port}",
            "--ServerApp.port_retries=0",
            f"--ServerApp.root_dir={base / 'root'}",
            "--ServerApp.open_browser=False",
            "--ServerApp.token=",
            "--ServerApp.password=",
            "--ServerApp.allow_remote_access=False",
            "--ServerApp.ip=127.0.0.1",
        ]
        lab_main()


if __name__ == "__main__":
    main()

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


async def fake_complete(
    backend: str,
    model: str,
    messages: list,
    tools: list,
    reasoning_effort: str | None = None,
) -> Completion:
    """Echo supplied context, with controlled tool, error, and cancel branches."""
    latest = "".join(
        part.text for part in getattr(messages[-1], "content", []) if isinstance(part, Text)
    )
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
    if "E2E_LEARNING_FIRST" in latest:
        return Completion(model=model, message=Msg("assistant", [Text("E2E_FIRST_TUTOR_REPLY")]))
    if "E2E_CODE_BLOCK" in latest:
        return Completion(
            model=model,
            message=Msg("assistant", [Text("Example:\n\n```python\nvalue = 2 + 2\nprint(value)\n```")]),
        )
    if "What does this average tell us?" in latest:
        return Completion(
            model=model,
            message=Msg("assistant", [Text("The average score is 8. It summarizes the three scores with one number, while the individual values still show how much they vary.")]),
        )
    if "Show a short Python example for checking the average." in latest:
        return Completion(
            model=model,
            message=Msg("assistant", [Text("You can verify it with:\n\n```python\nscores = [6, 8, 10]\nprint(sum(scores) / len(scores))\n```")]),
        )
    if "How should I begin checking the average?" in latest:
        return Completion(
            model=model,
            message=Msg("assistant", [Text("What two pieces do you need to calculate a mean? Try finding the total first, then count how many scores you have.")]),
        )
    if "I found the total. What comes next?" in latest:
        return Completion(
            model=model,
            message=Msg("assistant", [Text("Nice start. How many scores are in your list, and what happens when you divide the total by that count?")]),
        )
    if "Use add_bonus to update the score" in transcript:
        results = [
            part for message in messages
            for part in getattr(message, "content", [])
            if isinstance(part, ToolResult)
        ]
        if not results:
            return Completion(
                model=model,
                message=Msg("assistant", [ToolUse(id="docs-call-1", name=tools[0]["name"], arguments={"value": 4})]),
            )
        return Completion(model=model, message=Msg("assistant", [Text("The updated score is 14. The notebook's Python function made that change in the live kernel.")]))
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
    text = f"E2E provider={backend} model={model} effort={reasoning_effort or 'default'}\n\n{transcript[-4000:]}"
    return Completion(model=model, message=Msg("assistant", [Text(text)]))


def main() -> None:
    port = int(os.environ.get("NBINLINEAI_E2E_PORT", "8897"))
    if port == 8888:
        raise SystemExit("E2E tests refuse port 8888")
    if not 1 <= port <= 65535:
        raise SystemExit("E2E port must be between 1 and 65535")
    with tempfile.TemporaryDirectory(prefix="nbinlineai-e2e-") as tmp:
        base = Path(tmp)
        for name in ("root", "config", "runtime", "data", "xdg"):
            (base / name).mkdir()
        kernelspec = base / "data" / "kernels" / "python3"
        kernelspec.mkdir(parents=True)
        (kernelspec / "kernel.json").write_text(json.dumps({
            "argv": [sys.executable, "-m", "ipykernel_launcher",
                     "-f", "{connection_file}"],
            "display_name": "Python 3 (ipykernel)" if os.environ.get("NBINLINEAI_DOCS_CAPTURE") == "1" else "Python 3 (nbinlineai E2E)",
            "language": "python",
        }))
        os.environ["JUPYTER_CONFIG_DIR"] = str(base / "config")
        os.environ["JUPYTER_RUNTIME_DIR"] = str(base / "runtime")
        os.environ["JUPYTER_DATA_DIR"] = str(base / "data")
        os.environ["XDG_CONFIG_HOME"] = str(base / "xdg")
        live = os.environ.get("NBINLINEAI_E2E_LIVE") == "1"
        if not live:
            # Blank overrides prevent the test server from reading a developer's
            # real .env. Browser tests configure isolated fake keys through the UI.
            os.environ["OPENAI_API_KEY"] = ""
            os.environ["ANTHROPIC_API_KEY"] = ""
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

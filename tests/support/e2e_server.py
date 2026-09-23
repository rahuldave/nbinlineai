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
    current_user = next((
        "".join(part.text for part in getattr(message, "content", []) if isinstance(part, Text))
        for message in reversed(messages) if getattr(message, "role", None) == "user"
    ), "")
    transcript = "\n".join(
        str(getattr(part, "text", ""))
        for message in messages
        for part in getattr(message, "content", [])
        if isinstance(part, (Text, ToolResult))
    )
    schema_names = [tool["name"] for tool in tools]
    system_text = "".join(
        part.text for part in getattr(messages[0], "content", []) if isinstance(part, Text)
    )
    if "E2E_AI_AUDIT" in current_user:
        markers = (
            "EARLIER_AI_QUESTION", "EARLIER_AI_ANSWER",
            "LATER_AI_QUESTION", "LATER_AI_ANSWER", "OWN_MOVED_ANSWER",
        )
        locations = []
        for marker in markers:
            roles = [
                str(message.role) for message in messages
                if marker in "".join(
                    part.text for part in getattr(message, "content", [])
                    if isinstance(part, Text)
                )
            ]
            locations.append(f"{marker}={','.join(roles) or 'absent'}")
        return Completion(model=model, message=Msg("assistant", [Text("; ".join(locations))]))
    if "E2E_INHERIT_INSPECT" in current_user:
        details = (
            f"INHERITED_SCHEMAS={','.join(schema_names)}; "
            f"OLD_SOURCE={'OLD_SOURCE_SHOULD_TRIM' in system_text}; "
            f"NEAR_SOURCE={'NEAREST_SOURCE_INCLUDED' in system_text}; "
            f"ANSWER_ONLY_SOURCE={'ANSWER_ONLY_DECLARATION' in system_text}; "
            f"CODE_ONLY_SOURCE={'CODE_ONLY_DECLARATION' in system_text}; "
            f"CURRENT_QUESTION={current_user}"
        )
        return Completion(model=model, message=Msg("assistant", [Text(details)]))
    if ("E2E_INHERIT_CALL_BUMP" in current_user
            or "E2E_INHERIT_CALL_ALIAS" in current_user
            or "Use the available `record_bonus` function exactly once" in current_user):
        name = ("record_bonus" if "record_bonus" in current_user else
                "bump_alias" if "E2E_INHERIT_CALL_ALIAS" in current_user else "bump")
        if name not in schema_names:
            return Completion(model=model, message=Msg("assistant", [Text(f"MISSING_DECLARED_SCHEMA {name}")]))
        results = [
            part for message in messages for part in getattr(message, "content", [])
            if isinstance(part, ToolResult)
        ]
        if not results:
            arguments = {"points": 4} if name == "record_bonus" else {"value": 4}
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="e2e-inherited-call", name=name, arguments=arguments,
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            f"The declared {name} function ran in this notebook's Python kernel. Result: {results[-1].text}"
        )]))
    if "E2E_ERROR" in transcript:
        raise RuntimeError("E2E synthetic provider failure")
    if "E2E_SLOW" in transcript:
        await asyncio.sleep(30)
    if "E2E_LEARNING_FIRST" in latest:
        return Completion(model=model, message=Msg("assistant", [Text("E2E_FIRST_TUTOR_REPLY")]))
    if "E2E_EDIT_FIRST" in latest:
        return Completion(model=model, message=Msg("assistant", [Text("ORIGINAL_HISTORY_ANSWER")]))
    if "E2E_CODE_BLOCK" in latest:
        return Completion(
            model=model,
            message=Msg("assistant", [Text("Example:\n\n```python\nvalue = 2 + 2\nprint(value)\n```")]),
        )
    if "Add a short study note about live notebook context" in current_user:
        results = [part for message in messages for part in getattr(message, "content", [])
                   if isinstance(part, ToolResult)]
        if not results:
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="docs-live-note", name="insert_markdown",
                arguments={"content": "### Live notebook note\n\nThis editable note was added after the AI answer. Save the notebook when it is ready."},
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            "I added an editable Markdown note below this answer. You can revise it before saving."
        )]))
    if "Add the public study page as a notebook note" in current_user:
        results = [part for message in messages for part in getattr(message, "content", [])
                   if isinstance(part, ToolResult)]
        if not results:
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="docs-web-note", name="url_to_note",
                arguments={"url": "https://example.org/study-lesson"},
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            "I added a source-attributed study note below this answer. Review the source before using it."
        )]))
    if "E2E_BRIDGE_READ" in current_user:
        results = [part for message in messages for part in getattr(message, "content", [])
                   if isinstance(part, ToolResult)]
        if not results:
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="e2e-live-read", name="read_cell",
                arguments={"cell_id": "live-later", "start_line": 1, "end_line": 2},
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            f"Live notebook read: {results[-1].text}"
        )]))
    if "E2E_BRIDGE_INSERT" in current_user:
        results = [part for message in messages for part in getattr(message, "content", [])
                   if isinstance(part, ToolResult)]
        if not results:
            if "E2E_BRIDGE_DELAY" in current_user:
                await asyncio.sleep(3)
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="e2e-live-insert", name="insert_markdown",
                arguments={"content": "E2E_INSERTED_NOTE in the originating notebook"},
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            f"Notebook action result: {results[-1].text}"
        )]))
    if "E2E_BRIDGE_CODE" in current_user:
        results = [part for message in messages for part in getattr(message, "content", [])
                   if isinstance(part, ToolResult)]
        if not results:
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="e2e-live-code", name="insert_code",
                arguments={"content": "new_code_ran = True\nprint('NEW_CODE_EXECUTED')"},
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            f"An editable code cell was inserted without running it. {results[-1].text}"
        )]))
    if "E2E_BRIDGE_MISSING" in current_user:
        results = [part for message in messages for part in getattr(message, "content", [])
                   if isinstance(part, ToolResult)]
        if not results:
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="e2e-live-missing", name="read_cell",
                arguments={"cell_id": "missing-cell"},
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            f"Notebook action result: {results[-1].text}"
        )]))
    if "E2E_WEB_NOTE" in current_user:
        results = [part for message in messages for part in getattr(message, "content", [])
                   if isinstance(part, ToolResult)]
        if not results:
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="e2e-web-note", name="url_to_note",
                arguments={"url": "https://example.org/study-lesson"},
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            f"Web note result: {results[-1].text}"
        )]))
    if "search_kernel_names" in current_user and "study_roster_marker" in current_user:
        if "search_kernel_names" not in schema_names:
            return Completion(model=model, message=Msg("assistant", [Text(
                "MISSING_DECLARED_SCHEMA search_kernel_names"
            )]))
        results = [
            part for message in messages
            for part in getattr(message, "content", [])
            if isinstance(part, ToolResult)
        ]
        if not results:
            return Completion(model=model, message=Msg("assistant", [ToolUse(
                id="e2e-bundled-search", name="search_kernel_names",
                arguments={"query": "study_roster_marker"},
            )]))
        return Completion(model=model, message=Msg("assistant", [Text(
            f"The built-in found this live Python name: {results[-1].text}"
        )]))
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
    if "E2E_TOOL" in current_user:
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
            # Keep browser coverage deterministic and offline; production URL
            # validation and fetching are exercised in dedicated Python tests.
            import importlib

            prompt_module = importlib.import_module("nbinlineai.prompt")
            prompt_module.fetch_url_markdown = lambda url: (
                f"Source: {url}\n\n### Study lesson\n\nCompare each claim with its supporting evidence before drawing a conclusion."
            )
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

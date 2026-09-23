"""Isolated, offline JupyterLab server for the Jupyter AI coexistence smoke.

Run only through jupyter_ai_compat_smoke.mjs. This imports the *installed*
nbinlineai package from the dedicated compatibility environment.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

from aidialog.msg_parts import Completion, Msg, Text, ToolResult, ToolUse


async def fake_complete(backend, model, messages, tools, reasoning_effort=None):
    """Use a kernel tool once, then report its observed result without network I/O."""
    source = "\n".join(
        part.text
        for message in messages
        for part in getattr(message, "content", [])
        if isinstance(part, Text)
    )
    results = [
        part.text
        for message in messages
        for part in getattr(message, "content", [])
        if isinstance(part, ToolResult)
    ]
    if "COMPAT_BUMP" in source:
        if not results:
            assert any(tool["name"] == "bump" for tool in tools)
            return Completion(model=model, message=Msg("assistant", [
                ToolUse(id="compat-bump-1", name="bump", arguments={"value": 4})
            ]))
        return Completion(model=model, message=Msg("assistant", [Text(
            f"Compatibility tool result: {results[-1]}"
        )]))
    return Completion(model=model, message=Msg("assistant", [Text("Compatibility fake answer.")]))


def main() -> None:
    port = 8898
    with tempfile.TemporaryDirectory(prefix="nbinlineai-jai-compat-smoke-") as tmp:
        base = Path(tmp)
        for name in ("root", "config", "runtime", "data", "xdg"):
            (base / name).mkdir()
        kernelspec = base / "data" / "kernels" / "python3"
        kernelspec.mkdir(parents=True)
        kernelspec.joinpath("kernel.json").write_text(json.dumps({
            "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
            "display_name": "Python 3 (compat smoke)",
            "language": "python",
        }))
        os.environ.update({
            "JUPYTER_CONFIG_DIR": str(base / "config"),
            "JUPYTER_RUNTIME_DIR": str(base / "runtime"),
            "JUPYTER_DATA_DIR": str(base / "data"),
            "XDG_CONFIG_HOME": str(base / "xdg"),
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
        })
        from nbinlineai import providers
        providers.complete = fake_complete
        from jupyterlab.labapp import main as lab_main
        sys.argv = [
            "jupyter-lab", f"--ServerApp.port={port}",
            "--ServerApp.port_retries=0",
            f"--ServerApp.root_dir={base / 'root'}",
            "--ServerApp.open_browser=False",
            "--ServerApp.token=", "--ServerApp.password=",
            "--ServerApp.allow_remote_access=False",
            "--ServerApp.ip=127.0.0.1",
            "--LabApp.expose_app_in_browser=True",
        ]
        lab_main()


if __name__ == "__main__":
    main()

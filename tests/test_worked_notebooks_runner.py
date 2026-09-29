"""The optional live runner must isolate credentials from notebook kernels."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _runner():
    script = Path(__file__).resolve().parents[1] / "scripts/worked_notebooks.py"
    spec = importlib.util.spec_from_file_location("worked_notebooks_runner", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_child_environment_is_allowlisted(monkeypatch, tmp_path):
    runner = _runner()
    for name in ("GH_TOKEN", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "ANTHROPIC_AUTH_TOKEN",
                 "JUPYTER_TOKEN", "CODEX_HOME", "OPENAI_API_KEY", "UNEXPECTED_PRIVATE_VALUE"):
        monkeypatch.setenv(name, "sentinel-must-not-reach-kernel")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "managed-config"))
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path / "browsers"))
    child = runner._child_environment(tmp_path, "owned-random-test-token")
    assert child["XDG_CONFIG_HOME"] == str(tmp_path / "managed-config")
    assert child["PLAYWRIGHT_BROWSERS_PATH"] == str(tmp_path / "browsers")
    assert child["OPENAI_API_KEY"] == ""
    assert child["ANTHROPIC_API_KEY"] == ""
    assert child["NBINLINEAI_WORKED_TOKEN"] == "owned-random-test-token"
    assert "sentinel-must-not-reach-kernel" not in child.values()


def test_port_refuses_a_live_listener():
    runner = _runner()
    assert runner.PORT == 8897

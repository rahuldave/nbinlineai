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


def test_receipt_reader_rejects_untrusted_kernel_and_variable(monkeypatch, tmp_path):
    import pytest

    script = Path(__file__).resolve().parents[1] / "scripts/worked_receipt_state.py"
    spec = importlib.util.spec_from_file_location("worked_receipt_state", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("JUPYTER_RUNTIME_DIR", str(tmp_path))
    with pytest.raises(ValueError, match="kernel ID"):
        module.receipt_state("../../personal-kernel", "camera")
    with pytest.raises(ValueError, match="receipt variable"):
        module.receipt_state("12345678-1234-1234-1234-123456789abc", "camera.__dict__")


def test_direct_probe_observes_executed_assignment_but_not_dead_code(monkeypatch, tmp_path):
    from jupyter_client import KernelManager

    from scripts.worked_direct_probe import _execute, arm, take

    kernel_id = "12345678-1234-1234-1234-123456789abc"
    monkeypatch.setenv("JUPYTER_RUNTIME_DIR", str(tmp_path))
    manager = KernelManager(connection_file=str(tmp_path / f"kernel-{kernel_id}.json"))
    manager.start_kernel(cwd=str(Path(__file__).resolve().parents[1]))
    try:
        arm(kernel_id, ["search_kernel_names"])
        _execute(kernel_id, "from nbinlineai.tools import search_kernel_names\n"
                 "if False: search_kernel_names('proof')")
        assert take(kernel_id) == []
        arm(kernel_id, ["search_kernel_names"])
        assert _execute(kernel_id, "saved = search_kernel_names('unlikely_probe_name')") == ""
        assert take(kernel_id) == [{"name": "search_kernel_names", "completed": True}]
    finally:
        manager.shutdown_kernel(now=True)

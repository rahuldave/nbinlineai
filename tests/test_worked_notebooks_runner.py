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


def test_native_image_observer_forwarding_is_explicit_and_private(monkeypatch, tmp_path):
    import pytest

    runner = _runner()
    output = tmp_path / "private"
    output.mkdir(mode=0o700)
    candidate = output / "native-image.jsonl"
    child = runner._child_environment(tmp_path, "owned-token")
    monkeypatch.setenv("NBINLINEAI_WORKED_NATIVE_IMAGE_OBSERVER_FILE", str(candidate))
    with pytest.raises(ValueError, match="E2E_LIVE"):
        runner._enable_native_image_observer(child, output)
    assert "NBINLINEAI_WORKED_NATIVE_IMAGE_OBSERVER_FILE" not in child
    monkeypatch.setenv("NBINLINEAI_E2E_LIVE", "1")
    runner._enable_native_image_observer(child, output)
    assert child["NBINLINEAI_E2E_LIVE"] == "1"
    assert child["NBINLINEAI_WORKED_NATIVE_IMAGE_OBSERVER_FILE"] == str(candidate)
    candidate.touch()
    with pytest.raises(ValueError, match="new"):
        runner._enable_native_image_observer({}, output)
    candidate.unlink()
    monkeypatch.setenv("NBINLINEAI_WORKED_NATIVE_IMAGE_OBSERVER_FILE", str(tmp_path / "outside.jsonl"))
    with pytest.raises(ValueError, match="private output"):
        runner._enable_native_image_observer({}, output)


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


def test_receipt_reader_allows_unregistered_state_only_for_polling():
    import pytest

    script = Path(__file__).resolve().parents[1] / "scripts/worked_receipt_state.py"
    spec = importlib.util.spec_from_file_location("worked_receipt_state", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    provisional = {"operationId": None, "status": "running"}
    assert module._validated_receipt(provisional, allow_unregistered=True) == provisional
    with pytest.raises(ValueError, match="operation ID"):
        module._validated_receipt(provisional)
    with pytest.raises(ValueError, match="operation ID"):
        module._validated_receipt({"operationId": "bad", "status": "completed"},
                                  allow_unregistered=True)
    with pytest.raises(ValueError, match="operation state"):
        module._validated_receipt({"operationId": None, "status": "invented"},
                                  allow_unregistered=True)


def test_insertion_receipt_requires_inserted_state_and_stable_cell_id():
    import pytest

    script = Path(__file__).resolve().parents[1] / "scripts/worked_receipt_state.py"
    spec = importlib.util.spec_from_file_location("worked_receipt_state", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module._validated_insertion({"status": "inserted", "cellId": "inserted-cell"}) == {
        "status": "inserted", "cellId": "inserted-cell"
    }
    for state in ({"status": "requested", "cellId": None},
                  {"status": "error", "cellId": None},
                  {"status": "inserted", "cellId": "../../other"}):
        with pytest.raises(ValueError, match="completed stable cell ID"):
            module._validated_insertion(state)


def test_direct_probe_observes_executed_assignment_but_not_dead_code(monkeypatch, tmp_path):
    from jupyter_client import KernelManager

    from scripts.worked_direct_probe import _execute, arm, take

    kernel_id = "12345678-1234-1234-1234-123456789abc"
    monkeypatch.setenv("JUPYTER_RUNTIME_DIR", str(tmp_path))
    manager = KernelManager(connection_file=str(tmp_path / f"kernel-{kernel_id}.json"))
    manager.start_kernel(cwd=str(Path(__file__).resolve().parents[1]))
    try:
        _execute(kernel_id, "import sys\n"
                 "def prior_profile(frame, event, arg): pass\n"
                 "sys.setprofile(prior_profile)")
        assert take(kernel_id) == []
        assert _execute(kernel_id, "import sys\nprint(sys.getprofile() is prior_profile)") == "True"
        arm(kernel_id, ["search_kernel_names"])
        _execute(kernel_id, "from nbinlineai.tools import search_kernel_names\n"
                 "if False: search_kernel_names('proof')")
        assert take(kernel_id) == []
        arm(kernel_id, ["search_kernel_names"])
        assert _execute(kernel_id, "saved = search_kernel_names('unlikely_probe_name')") == ""
        assert take(kernel_id) == [{"name": "search_kernel_names", "completed": True}]
        assert _execute(kernel_id, "import sys\nprint(sys.getprofile() is prior_profile)") == "True"
        arm(kernel_id, ["search_docs"])
        _execute(kernel_id, "from nbinlineai.tools import search_docs\n"
                 "try:\n    search_docs('x', 'y', depth=3)\nexcept ValueError:\n    pass")
        assert take(kernel_id) == [{"name": "search_docs", "completed": False}]
        assert _execute(kernel_id, "import sys\nprint(sys.getprofile() is prior_profile)") == "True"
    finally:
        manager.shutdown_kernel(now=True)

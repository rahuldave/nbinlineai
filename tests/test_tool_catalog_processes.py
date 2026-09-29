"""The worked tmux example must never follow an inherited user session socket."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_process_example_uses_private_socket_and_restores_inherited_tmux(tmp_path: Path) -> None:
    if shutil.which("tmux") is None:
        pytest.skip("tmux is unavailable on this test host")

    notebook = json.loads((ROOT / "examples/tool-catalog-processes.ipynb").read_text())
    by_id = {cell["id"]: "".join(cell["source"]) for cell in notebook["cells"]}
    setup = by_id["catalog-exec-setup"]
    cleanup = by_id["catalog-exec-cleanup"]
    socket_root = Path(tempfile.mkdtemp(prefix="nbinlineai-tmux-owned-", dir="/tmp"))
    socket = socket_root / "owned.sock"
    prior_dir = tmp_path / "prior-tmux-dir"
    prior_dir.mkdir()
    clean_env = os.environ.copy()
    clean_env.pop("TMUX", None)
    clean_env.pop("TMUX_TMPDIR", None)
    try:
        subprocess.run(["tmux", "-S", str(socket), "new-session", "-d", "-s", "owned-review"],
                       env=clean_env, check=True, capture_output=True, text=True)
        child_env = clean_env | {
            "TMUX": f"{socket},1,0",
            "TMUX_TMPDIR": str(prior_dir),
            "PYTHONPATH": str(ROOT),
        }
        child_code = (
            "import os\n"
            f"setup = {setup!r}\n"
            f"cleanup = {cleanup!r}\n"
            "original_tmux = os.environ['TMUX']\n"
            "original_dir = os.environ['TMUX_TMPDIR']\n"
            "exec(setup, globals())\n"
            "try:\n"
            "    assert 'TMUX' not in os.environ\n"
            "    assert os.environ['TMUX_TMPDIR'] == catalog_tmux_temp.name\n"
            "    sessions = tmux_sessions()\n"
            "    assert catalog_tmux_name in sessions\n"
            "    assert 'owned-review' not in sessions\n"
            "finally:\n"
            "    exec(cleanup, globals())\n"
            "assert os.environ['TMUX'] == original_tmux\n"
            "assert os.environ['TMUX_TMPDIR'] == original_dir\n"
        )
        subprocess.run([sys.executable, "-c", child_code], cwd=ROOT, env=child_env,
                       check=True, capture_output=True, text=True, timeout=30)
        inherited = subprocess.run(["tmux", "-S", str(socket), "list-sessions"],
                                   env=clean_env, check=True, capture_output=True, text=True)
        assert "owned-review" in inherited.stdout
    finally:
        subprocess.run(["tmux", "-S", str(socket), "kill-server"], env=clean_env,
                       check=False, capture_output=True, text=True)
        shutil.rmtree(socket_root)

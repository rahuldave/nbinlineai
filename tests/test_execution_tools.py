"""Subprocess boundaries, including termination and bounded noisy output."""

import os
import time
from pathlib import Path

import pytest

from nbinlineai.execution_tools import run_python, run_shell, tmux_read


def test_subprocess_uses_requested_directory_and_reports_errors(tmp_path: Path) -> None:
    """A fresh process can write in its directory and reports failed Python."""
    result = run_python("from pathlib import Path; Path('done').write_text('ok'); print('finished')",
                        str(tmp_path))
    assert "Exit code: 0" in result and "finished" in result
    assert (tmp_path / "done").read_text() == "ok"
    error = run_python("raise ValueError('demonstration')", str(tmp_path))
    assert "Exit code: 1" in error and "ValueError: demonstration" in error
    assert "shell marker" in run_shell("echo shell marker", str(tmp_path))


def test_run_stops_infinite_and_noisy_programs() -> None:
    """Time and output limits stop the owned subprocess with a useful report."""
    assert "time limit" in run_python("while True: pass", timeout=1)
    noisy = run_python("while True: print('x' * 4096)", timeout=5)
    assert "output exceeded" in noisy and len(noisy) <= 4_000


def test_bad_process_arguments_do_not_run(tmp_path: Path) -> None:
    """Validate limits, paths and pane IDs before starting external commands."""
    with pytest.raises(ValueError, match="timeout"):
        run_python("print('unused')", timeout=21)
    with pytest.raises(ValueError, match="directory"):
        run_python("print('unused')", str(tmp_path / "missing"))
    with pytest.raises(ValueError, match="pane"):
        tmux_read("%1; echo invalid")


def test_normal_completion_never_signals_a_reaped_process(monkeypatch: pytest.MonkeyPatch) -> None:
    """A successful process is reaped once and receives no cleanup kill."""
    def unexpected_stop(process: object) -> None:
        raise AssertionError("normal completion must not signal a process group")

    monkeypatch.setattr("nbinlineai.execution_tools._stop_process", unexpected_stop)
    assert "Exit code: 0" in run_python("print('complete')")


@pytest.mark.skipif(os.name != "posix", reason="Process-group regression uses POSIX sessions")
def test_child_holding_stdout_does_not_keep_the_tool_waiting() -> None:
    """A child retaining stdout is stopped on timeout even after its parent exits."""
    started = time.monotonic()
    result = run_python(
        "import subprocess, sys; "
        "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)']); "
        "print('parent finished')", timeout=1,
    )
    assert "time limit" in result and "parent finished" in result
    assert time.monotonic() - started < 4

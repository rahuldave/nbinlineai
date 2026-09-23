"""Explicit, bounded subprocess and tmux tools for the kernel's machine."""

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from types import MappingProxyType

from ._tool_helpers import _bounded, _text

MAX_PROCESS_BYTES = 64_000


def _stop_process(
    process: subprocess.Popen,  # Only a process started by this tool.
) -> None:  # Terminate its process group where supported.
    """Stop owned work without touching a notebook kernel or server."""
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        elif process.returncode is None:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3,
                           check=False)
    except (OSError, subprocess.TimeoutExpired):
        if process.returncode is None:
            process.kill()


def _pipe_chunk(
    process: subprocess.Popen,  # Owned process with a captured stdout pipe.
) -> bytes | None:  # Available bytes, empty on EOF, or None while no data is ready.
    """Read a pipe without a blocking reader that detached children could retain."""
    assert process.stdout is not None
    if os.name == "nt":
        import ctypes
        import msvcrt
        from ctypes import wintypes

        available = wintypes.DWORD()
        peek = ctypes.WinDLL("kernel32", use_last_error=True).PeekNamedPipe
        peek.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                         wintypes.LPVOID, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
        peek.restype = wintypes.BOOL
        handle = msvcrt.get_osfhandle(process.stdout.fileno())
        if not peek(handle, None, 0, None, ctypes.byref(available), None):
            error = ctypes.get_last_error()
            if error in (109, 232):  # Broken/disconnected pipe: the writer closed it.
                return b""
            raise OSError(error, "Could not read subprocess output")
        if not available.value:
            return None
        return os.read(process.stdout.fileno(), min(4096, available.value))
    try:
        return os.read(process.stdout.fileno(), 4096)
    except BlockingIOError:
        return None


def _run_process(
    arguments: list[str],  # Explicit executable and arguments, or shell command wrapper.
    cwd: str,  # Existing working directory on the kernel machine.
    timeout: int,  # Maximum seconds before stopping the process.
) -> str:  # Bounded combined output and completion status.
    """Drain output with a byte cap and stop owned work on time/output limits."""
    if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 20:
        raise ValueError("timeout must be an integer from 1 to 20 seconds")
    root = Path(_text(cwd, "cwd")).expanduser().resolve()
    if not root.is_dir():
        raise ValueError("cwd must name an existing directory")
    output = bytearray()
    process = subprocess.Popen(arguments, cwd=root, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               start_new_session=os.name == "posix")
    assert process.stdout is not None
    if os.name != "nt":
        os.set_blocking(process.stdout.fileno(), False)
    deadline = time.monotonic() + timeout
    status = ""
    eof = False
    try:
        while True:
            if time.monotonic() >= deadline:
                status = f"Stopped: {timeout}-second time limit reached."
                break
            chunk = b"" if eof else _pipe_chunk(process)
            if chunk:
                remaining = MAX_PROCESS_BYTES - len(output)
                output.extend(chunk[:remaining])
                if len(output) >= MAX_PROCESS_BYTES:
                    status = "Stopped: output exceeded 64000 bytes."
                    break
            elif chunk == b"":
                eof = True
                try:
                    process.wait(timeout=0)
                    break
                except subprocess.TimeoutExpired:
                    pass
            if not chunk:
                time.sleep(0.01)
    finally:
        # Do not poll/reap while readers remain: keeping the leader's PID reserved
        # ensures a timeout cannot signal a subsequently reused process group.
        # A completed process with closed stdout needs no kill at all.
        if process.returncode is None:
            _stop_process(process)
        process.wait(timeout=3)
        process.stdout.close()
    if not status:
        status = f"Exit code: {process.returncode}."
    return _bounded(f"{status}\nWorking directory: {root}\n\n"
                    + output.decode("utf-8", errors="replace"))


def run_shell(
    command: str,  # Shell command; executes with the kernel user's permissions.
    cwd: str = ".",  # Working directory relative to the kernel, or absolute.
    timeout: int = 10,  # Maximum runtime in seconds, from 1 through 20.
) -> str:  # Exit status and bounded combined output.
    """Execute a shell command in a separate process; effects are real, not sandboxed."""
    command = _text(command, "command", 8_000)
    arguments = ([os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c", command]
                 if os.name == "nt" else ["/bin/sh", "-c", command])
    return _run_process(arguments, cwd, timeout)


def run_python(
    code: str,  # Python source to execute in a fresh subprocess, not the live namespace.
    cwd: str = ".",  # Working directory relative to the kernel, or absolute.
    timeout: int = 10,  # Maximum runtime in seconds, from 1 through 20.
) -> str:  # Exit status and bounded combined output.
    """Execute Python with the kernel's interpreter in a fresh process; effects are real."""
    return _run_process([sys.executable, "-u", "-c", _text(code, "code", 8_000)], cwd, timeout)


def tmux_sessions() -> str:  # Bounded local tmux session/window/pane inventory.
    """List local tmux panes; requires tmux and does not list JupyterLab terminals."""
    executable = shutil.which("tmux")
    if executable is None:
        raise RuntimeError("tmux is not installed on the kernel machine")
    return _run_process([executable, "list-panes", "-a", "-F",
                         ("#{session_name}:#{window_index}.#{pane_index} #{pane_id} "
                          "#{pane_current_command}")], ".", 5)


def tmux_read(
    pane: str,  # Exact local pane ID such as %3 from tmux_sessions.
    lines: int = 40,  # Last 1 through 100 lines of pane content.
) -> str:  # Bounded plain terminal text.
    """Read a local tmux pane's recent screen/scrollback without sending input."""
    if not isinstance(pane, str) or not pane.startswith("%") or not pane[1:].isdigit():
        raise ValueError("pane must be an exact tmux pane ID such as %3")
    if isinstance(lines, bool) or not isinstance(lines, int) or not 1 <= lines <= 100:
        raise ValueError("lines must be an integer from 1 to 100")
    executable = shutil.which("tmux")
    if executable is None:
        raise RuntimeError("tmux is not installed on the kernel machine")
    return _run_process([executable, "capture-pane", "-p", "-t", pane,
                         "-S", f"-{lines}", "-E", "-"], ".", 5)


EXECUTION_TOOL_FUNCTIONS = MappingProxyType({
    function.__name__: function
    for function in (run_shell, run_python, tmux_sessions, tmux_read)
})

__all__ = list(EXECUTION_TOOL_FUNCTIONS)

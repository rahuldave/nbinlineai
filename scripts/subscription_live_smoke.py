"""Opt-in, bounded real-ChatGPT acceptance harness on an isolated JupyterLab.

The parent launches a temporary 8897 server with production subscription code.
Only the browser driver can initiate model turns after interactive sign-in.
No API provider, repository .env, existing Codex state, or personal notebook is used.
"""

from __future__ import annotations

import argparse
import os
import runpy
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
PORT = 8897


def _server_child() -> None:
    # This process is launched with a fresh XDG store by e2e_server. Disable
    # source-root .env loading and paid providers even if configuration changes.
    from nbinlineai import config, providers

    async def reject_api(*_args, **_kwargs):
        raise RuntimeError("Paid API transport is disabled in subscription smoke")

    config.load_server_env = lambda: None
    providers.complete = reject_api
    runpy.run_path(str(ROOT / "tests/support/e2e_server.py"), run_name="__main__")


def _port_free() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", PORT))
        except OSError:
            return False
    return True


def _wait_ready(process: subprocess.Popen, timeout: float = 120) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Isolated JupyterLab stopped before it became ready")
        try:
            with urlopen(f"http://127.0.0.1:{PORT}/lab", timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, URLError):
            pass
        time.sleep(0.5)
    raise RuntimeError("Isolated JupyterLab did not become ready")


def _stop_owned_server(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser(description="Isolated interactive ChatGPT subscription acceptance")
    parser.add_argument("--server-child", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.server_child:
        _server_child()
        return
    if not _port_free():
        raise SystemExit("Port 8897 is occupied; the smoke harness will not reuse or stop that server")
    node = shutil.which("node")
    if node is None:
        raise SystemExit("Node.js is required for the isolated browser driver")

    child_env = os.environ.copy()
    for name in tuple(child_env):
        if (name.endswith(("_API_KEY", "_ACCESS_TOKEN"))
                or name.startswith(("CODEX_", "OPENAI_"))):
            child_env.pop(name, None)
    child_env.update({
        "OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": "",
        "NBINLINEAI_E2E_LIVE": "1", "NBINLINEAI_E2E_PORT": str(PORT),
    })
    child_env.pop("NBINLINEAI_E2E_SUBSCRIPTION", None)
    with tempfile.TemporaryDirectory(prefix="nbinlineai-live-smoke-") as directory:
        log_path = Path(directory) / "server.log"
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), "--server-child"],
                cwd=ROOT, env=child_env, stdout=log, stderr=subprocess.STDOUT,
            )
            try:
                _wait_ready(process)
                print("Isolated JupyterLab is ready on port 8897. Complete device-code sign-in using your preferred browser.")
                browser = subprocess.run(
                    [node, str(ROOT / "scripts/subscription_live_smoke.mjs")],
                    cwd=ROOT, env=child_env, check=False,
                )
                if browser.returncode:
                    raise SystemExit("Subscription acceptance did not pass; no API fallback was used")
                print("Subscription acceptance passed; stopping the isolated JupyterLab.")
            finally:
                _stop_owned_server(process)


if __name__ == "__main__":
    main()

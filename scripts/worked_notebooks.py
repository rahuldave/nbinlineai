"""Run worked examples in one isolated Lab using the user's nbinlineai ChatGPT store.

This is an opt-in local runner. It never reads or copies managed account files;
the ordinary subscription manager discovers them through its supported path.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from nbinlineai.credentials import credential_directory

ROOT = Path(__file__).resolve().parents[1]
PORT = 8897
PASSTHROUGH_ENV = frozenset({
    "HOME", "XDG_CONFIG_HOME", "PATH", "TMPDIR", "TEMP", "TMP", "LANG",
    "LC_ALL", "LC_CTYPE", "TZ", "PLAYWRIGHT_BROWSERS_PATH",
})


def _private_directory(path: Path) -> bool:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return False
    return stat.S_ISDIR(mode) and (os.name == "nt" or not stat.S_IMODE(mode) & 0o077)


def _port_free() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        try:
            listener.bind(("127.0.0.1", PORT))
        except OSError:
            return False
    return True


def _server_child() -> None:
    from nbinlineai import config, providers

    async def reject_api(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("API transport is disabled for worked subscription notebooks")

    # Do not load a repository .env or use an API backend, even if one exists
    # in the user's normal store. SubscriptionRuntime keeps its own isolation.
    config.load_server_env = lambda: None
    providers.complete = reject_api
    from jupyterlab.labapp import main as lab_main

    sys.argv = ["jupyter-lab", "--ServerApp.port=8897", "--ServerApp.port_retries=0",
                "--ServerApp.open_browser=False", "--ServerApp.ip=127.0.0.1",
                "--ServerApp.allow_remote_access=False"]
    lab_main()


def _wait_ready(process: subprocess.Popen[bytes], token: str) -> None:
    deadline = time.monotonic() + 120
    request = Request(f"http://127.0.0.1:{PORT}/api/status",
                      headers={"Authorization": f"token {token}"})
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Owned JupyterLab stopped before readiness")
        try:
            with urlopen(request, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, URLError, HTTPError):
            pass
        time.sleep(0.5)
    raise RuntimeError("Owned JupyterLab did not become ready")


def _stop_owned_server(process: subprocess.Popen[bytes]) -> None:
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


def _copy_examples(destination: Path, source: Path) -> None:
    for original in source.rglob("*"):
        if original.is_symlink():
            raise ValueError("Worked examples must not contain symbolic links")
        if not original.is_file():
            continue
        relative = original.relative_to(source)
        if any(part.startswith(".") for part in relative.parts):
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)


def _child_environment(base: Path, token: str) -> dict[str, str]:
    """Keep only ordinary system paths and the supported managed account home."""
    child_env = {name: value for name, value in os.environ.items() if name in PASSTHROUGH_ENV}
    child_env.update({"OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": "",
                      "JUPYTER_CONFIG_DIR": str(base / "config"),
                      "JUPYTER_RUNTIME_DIR": str(base / "runtime"),
                      "JUPYTER_DATA_DIR": str(base / "data"),
                      "IPYTHONDIR": str(base / "ipython"),
                      "NBINLINEAI_WORKED_TOKEN": token,
                      "NBINLINEAI_WORKED_ROOT": str(base / "root")})
    return child_env


def main() -> None:
    parser = argparse.ArgumentParser(description="Run worked notebooks with one live ChatGPT subscription session")
    parser.add_argument("--manifest", type=Path, help="JSON execution plan for one or more source notebooks")
    parser.add_argument("--output-dir", type=Path, help="Where validated worked notebook copies are saved")
    parser.add_argument("--source-dir", type=Path, default=ROOT / "examples",
                        help="Directory of trusted source example notebooks")
    parser.add_argument("--server-child", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.server_child:
        _server_child()
        return
    if not args.manifest or not args.output_dir:
        parser.error("--manifest and --output-dir are required")
    if not _port_free():
        raise SystemExit("Port 8897 is occupied; refusing to reuse or stop that server")
    if not _private_directory(credential_directory() / "codex-subscription"):
        raise SystemExit("No private managed nbinlineai ChatGPT directory is available")
    plan = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not isinstance(plan, dict) or not isinstance(plan.get("notebooks"), list) or (
            not plan["notebooks"] and not plan.get("continuous")):
        raise SystemExit("Manifest needs notebooks or continuous mode")
    source = args.source_dir.resolve(strict=True)
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.chmod(0o700)
    token = secrets.token_urlsafe(32)
    with tempfile.TemporaryDirectory(prefix="nbinlineai-worked-") as directory:
        base = Path(directory)
        for name in ("root", "config", "runtime", "data", "ipython"):
            (base / name).mkdir(mode=0o700)
        _copy_examples(base / "root", source)
        config_path = base / "config" / "jupyter_server_config.json"
        config_path.write_text(json.dumps({"ServerApp": {"token": token, "password": "",
            "root_dir": str(base / "root")}}), encoding="utf-8")
        config_path.chmod(0o600)
        child_env = _child_environment(base, token)
        # Preserve XDG_CONFIG_HOME: it is the supported normal nbinlineai
        # subscription location, unlike the disposable Jupyter directories.
        log_path = base / "server.log"
        with log_path.open("wb") as log:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--server-child"],
                                       cwd=ROOT, env=child_env, stdout=log, stderr=subprocess.STDOUT)
            try:
                _wait_ready(process, token)
                print("Owned JupyterLab ready on port 8897; checking the managed ChatGPT connection.")
                driver_env = {**child_env, "NBINLINEAI_WORKED_MANIFEST": str(args.manifest.resolve()),
                              "NBINLINEAI_WORKED_OUTPUT": str(output),
                              "NBINLINEAI_WORKED_PYTHON": sys.executable}
                browser_channel = os.environ.get("WORKED_BROWSER_CHANNEL", "")
                if browser_channel:
                    if browser_channel != "chrome":
                        raise ValueError("Only the installed Chrome channel is supported")
                    # This launch choice belongs to the browser driver, never the
                    # notebook server or its kernel environment.
                    driver_env["WORKED_BROWSER_CHANNEL"] = browser_channel
                result = subprocess.run(["node", str(ROOT / "scripts/worked_notebooks.mjs")],
                                        cwd=ROOT, env=driver_env, check=False)
                if result.returncode:
                    raise SystemExit("Worked notebook execution did not complete; no API fallback was used")
            finally:
                _stop_owned_server(process)


if __name__ == "__main__":
    main()

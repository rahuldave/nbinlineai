"""Check a built wheel in the existing disposable Python 3.14 environment.

Run only after building and inspecting the final 0.1.13 wheel. This script never
imports nbinlineai from the checkout and owns only its temporary port-8897 server.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
PORT = 8897


def _clean_env(venv: Path, scratch: Path) -> dict[str, str]:
    env = os.environ.copy()
    for name in tuple(env):
        if (name.startswith(("CODEX_", "OPENAI_", "ANTHROPIC_", "JUPYTER_"))
                or name.endswith(("_API_KEY", "_ACCESS_TOKEN"))
                or name in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}):
            env.pop(name, None)
    env.update({
        "PATH": os.pathsep.join((str(venv / "bin"), "/usr/bin", "/bin")),
        "HOME": str(scratch),
        "XDG_CONFIG_HOME": str(scratch / "xdg"),
        "JUPYTER_CONFIG_DIR": str(scratch / "config"),
        "JUPYTER_RUNTIME_DIR": str(scratch / "runtime"),
        "JUPYTER_DATA_DIR": str(scratch / "data"),
        "IPYTHONDIR": str(scratch / "ipython"),
        "PYTHONNOUSERSITE": "1",
        "OPENAI_API_KEY": "",
        "ANTHROPIC_API_KEY": "",
    })
    return env


def _check_port() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", PORT))
        except OSError as exc:
            raise SystemExit("Port 8897 is occupied; refusing to attach to another server") from exc


def _stop(process: subprocess.Popen) -> None:
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
    parser = argparse.ArgumentParser(description="Isolated installed-wheel and quickstart UI check")
    parser.add_argument("wheel", type=Path, help="Final inspected 0.1.13 wheel")
    parser.add_argument("--info", type=Path,
                        default=Path("/tmp/nbinlineai-0113-clean-info.json"))
    args = parser.parse_args()
    wheel = args.wheel.resolve(strict=True)
    if not wheel.name.startswith("nbinlineai-0.1.13-") or wheel.suffix != ".whl":
        raise SystemExit("Expected a built nbinlineai 0.1.13 wheel")
    info = json.loads(args.info.read_text(encoding="utf-8"))
    base = Path(info["base"]).resolve(strict=True)
    python = Path(info["python"]).absolute()
    venv = python.parent.parent
    if (not python.is_file() or not python.is_relative_to(base)
            or venv == base or ROOT.is_relative_to(base)):
        raise SystemExit("The clean interpreter must belong to the disposable environment")
    _check_port()
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js is needed only for the external browser check")
    uv = shutil.which("uv")
    if not uv:
        raise SystemExit("uv is required to install the local wheel")

    # Dependencies were installed separately with wheels only. Do not fetch an
    # index package or allow a source-tree editable install during this check.
    subprocess.run([uv, "pip", "install", "--python", str(python), "--no-deps",
                    "--offline", "--reinstall", str(wheel)], check=True)
    with tempfile.TemporaryDirectory(prefix="nbinlineai-0113-wheel-") as directory:
        scratch = Path(directory)
        for name in ("root", "config", "runtime", "data", "xdg", "ipython"):
            (scratch / name).mkdir()
        env = _clean_env(venv, scratch)
        check = """
import importlib.metadata as metadata
import nbinlineai
from pathlib import Path
import sys
assert metadata.version('nbinlineai') == '0.1.13'
assert metadata.version('openai-codex') == '0.156.1'
package = Path(nbinlineai.__file__).resolve()
assert package.is_relative_to(Path(sys.prefix).resolve())
assert 'site-packages' in package.parts
quickstart = Path(sys.prefix) / 'share/doc/nbinlineai/examples/quickstart.ipynb'
assert quickstart.is_file()
print(quickstart)
"""
        result = subprocess.run([str(python), "-I", "-c", check], cwd=scratch, env=env,
                                capture_output=True, text=True, timeout=30, check=True)
        quickstart = Path(result.stdout.strip())
        shutil.copyfile(quickstart, scratch / "root/quickstart.ipynb")

        for command in (("labextension", "list"), ("server", "extension", "list")):
            result = subprocess.run([str(venv / "bin/jupyter"), *command], cwd=scratch,
                                    env=env, capture_output=True, text=True, timeout=120,
                                    check=False)
            output = result.stdout + result.stderr
            if result.returncode or "nbinlineai" not in output or "enabled" not in output or "OK" not in output:
                raise RuntimeError(f"Installed Jupyter {command[0]} discovery failed")

        server = """
from jupyterlab.labapp import main
import sys
sys.argv = ['jupyter-lab', '--ServerApp.port=8897', '--ServerApp.port_retries=0',
            '--ServerApp.ip=127.0.0.1', '--ServerApp.allow_remote_access=False',
            '--ServerApp.open_browser=False', '--ServerApp.token=',
            '--ServerApp.password=', '--ServerApp.root_dir=""" + str(scratch / "root") + """']
main()
"""
        with (scratch / "server.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(python), "-I", "-c", server], cwd=scratch,
                                       env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("Installed-wheel JupyterLab stopped before readiness")
                    try:
                        with urlopen(f"http://127.0.0.1:{PORT}/lab", timeout=2) as response:
                            if response.status == 200:
                                break
                    except (OSError, URLError):
                        pass
                    time.sleep(0.5)
                else:
                    raise RuntimeError("Installed-wheel JupyterLab did not become ready")
                with urlopen(f"http://127.0.0.1:{PORT}/nbinlineai/status", timeout=10) as response:
                    status = json.load(response)
                    if response.status != 200 or status.get("version") != "0.1.13":
                        raise RuntimeError("Installed-wheel status did not report 0.1.13")
                browser_env = os.environ.copy()
                for name in tuple(browser_env):
                    if (name.startswith(("CODEX_", "OPENAI_", "ANTHROPIC_"))
                            or name.endswith(("_API_KEY", "_ACCESS_TOKEN"))):
                        browser_env.pop(name, None)
                browser = subprocess.run([node, str(ROOT / "scripts/check_clean_wheel_ui.mjs")],
                                         cwd=ROOT, env=browser_env, timeout=120, check=False)
                if browser.returncode:
                    raise RuntimeError("Installed-wheel quickstart UI check failed")
            finally:
                _stop(process)
    print("Installed 0.1.13 wheel, both extensions, and isolated quickstart UI passed")


if __name__ == "__main__":
    main()

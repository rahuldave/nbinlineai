"""Credential-free packaged-runtime startup in a Jupyter/Tornado event loop.

Run in CI with an isolated empty state directory. This never starts a model
turn, reads a user's Codex state, or opens a browser.
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jupyter_server.serverapp import ServerApp
from tornado.ioloop import IOLoop

from nbinlineai.subscription_runtime import (
    SubscriptionRuntime,
    _packaged_binary,
    _WindowsSubscriptionRuntime,
)


async def check() -> None:
    if os.name == "nt":
        assert isinstance(asyncio.get_running_loop(), asyncio.SelectorEventLoop)
    binary = _packaged_binary()
    assert binary.is_file()
    with tempfile.TemporaryDirectory(prefix="nbinlineai-platform-check-") as folder:
        manager_class = _WindowsSubscriptionRuntime if os.name == "nt" else SubscriptionRuntime
        manager = manager_class(state_directory=Path(folder) / "private")
        try:
            status = await asyncio.wait_for(manager.status(), timeout=35)
            assert status["state"] == "signed_out", status["state"]
            assert status["configured"] is False
            assert status["auth_mode"] == "signed_out"
            control = manager._core._control if os.name == "nt" else manager._control
            assert control is not None and control.process is not None
        finally:
            await asyncio.wait_for(manager.close(), timeout=10)
        assert control.process is None


if __name__ == "__main__":
    # Jupyter Server changes Windows from Proactor to Selector before Tornado
    # starts. Reproduce that exact policy instead of testing only asyncio.run.
    ServerApp._init_asyncio_patch()
    IOLoop.current().run_sync(check)
    print("packaged runtime started and stopped without credentials")

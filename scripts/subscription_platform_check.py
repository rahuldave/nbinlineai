"""Credential-free packaged-runtime startup in a Jupyter/Tornado event loop.

Run in CI with an isolated empty state directory. This never starts a model
turn, reads a user's Codex state, or opens a browser.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tornado.ioloop import IOLoop

from nbinlineai.subscription_runtime import SubscriptionRuntime, _packaged_binary


async def check() -> None:
    binary = _packaged_binary()
    assert binary.is_file()
    with tempfile.TemporaryDirectory(prefix="nbinlineai-platform-check-") as folder:
        manager = SubscriptionRuntime(state_directory=Path(folder) / "private")
        try:
            status = await asyncio.wait_for(manager.status(), timeout=35)
            assert status["state"] == "signed_out", status["state"]
            assert status["configured"] is False
            assert status["auth_mode"] == "signed_out"
            control = manager._control
            assert control is not None and control.process is not None
        finally:
            await asyncio.wait_for(manager.close(), timeout=10)
        assert control.process is None


if __name__ == "__main__":
    IOLoop.current().run_sync(check)
    print("packaged runtime started and stopped without credentials")

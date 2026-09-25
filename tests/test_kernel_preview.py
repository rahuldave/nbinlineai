"""Preview inspection waits for the server kernel manager's separate status stream."""

import asyncio
import json

import pytest
from traitlets import HasTraits, Unicode

from nbinlineai.kernel import MARKER, KernelDispatcher


def _message(kind, parent="own", **content):
    return {"msg_type": kind, "parent_header": {"msg_id": parent}, "content": content}


class _Client:
    def __init__(self):
        self.iopub = asyncio.Queue()
        self.stopped = False

    def start_channels(self):
        pass

    def stop_channels(self):
        self.stopped = True

    def execute(self, *_args, **_kwargs):
        self.iopub.put_nowait(_message("status", execution_state="busy"))
        self.iopub.put_nowait(_message("stream", text=MARKER + json.dumps({"bump": {"docstring": "ok"}})))
        self.iopub.put_nowait(_message("status", execution_state="idle"))
        return "own"

    async def get_iopub_msg(self, timeout):
        if timeout == 0:
            return self.iopub.get_nowait()
        return await asyncio.wait_for(self.iopub.get(), timeout)

    async def get_shell_msg(self, timeout):
        return _message("execute_reply", status="ok")


class _Kernel(HasTraits):
    execution_state = Unicode("idle")

    def __init__(self):
        super().__init__()
        self.test_client = _Client()
        self.observers = 0

    def client(self):
        return self.test_client

    def observe(self, handler, names="execution_state", type="change"):
        self.observers += 1
        return super().observe(handler, names=names, type=type)

    def unobserve(self, handler, names="execution_state", type="change"):
        self.observers -= 1
        return super().unobserve(handler, names=names, type=type)

    async def interrupt_kernel(self):
        raise AssertionError("A completed inspection must not interrupt the kernel")


@pytest.mark.parametrize("outcome", ["delayed_idle", "foreign_execution", "foreign_already_settled",
                                     "no_idle", "cancelled"])
def test_preview_inspection_status_synchronization(outcome):
    async def run():
        kernel = _Kernel()
        dispatcher = KernelDispatcher(None, None)
        loop = asyncio.get_running_loop()
        if outcome not in ("no_idle", "foreign_already_settled"):
            loop.call_later(0.01, setattr, kernel, "execution_state", "busy")
            loop.call_later(0.08, setattr, kernel, "execution_state", "idle")
        if outcome == "foreign_execution":
            loop.call_later(0.03, kernel.test_client.iopub.put_nowait,
                            _message("status", parent="other", execution_state="busy"))
        if outcome == "foreign_already_settled":
            async def shell_with_foreign_execution(timeout):
                kernel.execution_state = "busy"
                kernel.execution_state = "idle"
                kernel.test_client.iopub.put_nowait(
                    _message("status", parent="other", execution_state="busy"))
                return _message("execute_reply", status="ok")

            kernel.test_client.get_shell_msg = shell_with_foreign_execution
        task = asyncio.create_task(dispatcher.inspect_preview("kernel-1", kernel, [], ["bump"]))
        try:
            if outcome == "delayed_idle":
                await asyncio.sleep(0.04)
                assert not task.done(), "Dispatcher returned before the manager observed idle"
                assert await task == {"bump": {"docstring": "ok"}}
            elif outcome == "cancelled":
                await asyncio.sleep(0.04)
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
            else:
                with pytest.raises(ValueError, match="Kernel is busy"):
                    await task
        finally:
            assert kernel.observers == 0
            assert kernel.test_client.stopped

    asyncio.run(run())

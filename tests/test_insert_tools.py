"""Kernel-side insert_tools helper requests and asynchronous receipts."""

from typing import Any

import pytest

from nbinlineai import kernel_insert_tools
from nbinlineai.tools import TOOL_FUNCTIONS, insert_tools, tools_markdown


class FakeComm:
    """Record a kernel comm without opening a real Jupyter browser."""

    def __init__(
        self,
        target_name: str,  # Requested frontend target.
        data: dict[str, Any],  # Versioned insertion payload.
    ) -> None:
        """Keep the sent request for assertions."""
        self.target_name = target_name
        self.data = data
        self.message_callback: Any = None
        self.close_callback: Any = None
        self.was_closed = False

    def on_msg(
        self,
        callback: Any,  # Browser acknowledgement callback.
    ) -> None:
        """Remember the result handler."""
        self.message_callback = callback

    def on_close(
        self,
        callback: Any,  # Unexpected close callback.
    ) -> None:
        """Remember the close handler."""
        self.close_callback = callback

    def close(self) -> None:
        """Mark the one-shot channel closed."""
        self.was_closed = True


class FakeKernel:
    """Expose the current Jupyter execution parent."""

    def get_parent(self) -> dict[str, Any]:
        """Return one code-cell execute request."""
        return {"header": {"msg_type": "execute_request", "msg_id": "exec-123"},
                "metadata": {"cellId": "code-abc"}}


class FakeShell:
    """Provide the active fake kernel to the helper."""

    kernel = FakeKernel()


class FakeDeadline:
    """Manually fired event-loop acknowledgement timeout."""

    def __init__(
        self,
        callback: Any,  # Function called when the acknowledgement expires.
    ) -> None:
        """Retain the scheduled callback."""
        self.callback = callback
        self.cancelled = False

    def cancel(self) -> None:
        """Record that the browser answered in time."""
        self.cancelled = True


class FakeLoop:
    """Offer nonblocking scheduling to the helper."""

    def __init__(self) -> None:
        """Start without a deadline."""
        self.deadline: FakeDeadline | None = None

    def call_later(
        self,
        delay: int,  # Timeout in seconds.
        callback: Any,  # Expiry callback.
    ) -> FakeDeadline:
        """Record rather than wait for a deadline."""
        assert delay == 30
        self.deadline = FakeDeadline(callback)
        return self.deadline


def test_insert_tools_sends_markdown_and_updates_receipt_after_ack(
    monkeypatch: pytest.MonkeyPatch,  # Replace kernel and comm transport.
) -> None:
    """Generate selected/custom references and never claim early success."""
    created: list[FakeComm] = []

    def create(
        target_name: str,  # Browser comm target.
        data: dict[str, Any],  # Markdown insertion request.
    ) -> FakeComm:
        """Capture the outbound request."""
        channel = FakeComm(target_name, data)
        created.append(channel)
        return channel

    monkeypatch.setattr(kernel_insert_tools, "get_ipython", lambda: FakeShell())
    monkeypatch.setattr(kernel_insert_tools, "create_comm", create)
    loop = FakeLoop()
    monkeypatch.setattr(kernel_insert_tools.asyncio, "get_running_loop", lambda: loop)

    def helper() -> str:
        """Simple custom callable to list by alias."""
        return "ok"

    receipt = insert_tools(["read_cell", "my_helper"], custom={"my_helper": helper})
    assert receipt.status == "requested" and receipt.cell_id is None
    assert "requested" in repr(receipt) and "inserted" not in repr(receipt)
    assert created[0].target_name == "nbinlineai.insert_tools.v1"
    assert created[0].data == {
        "version": 1,
        "content": tools_markdown(["read_cell", "my_helper"], custom={"my_helper": helper}),
        "source_cell_id": "code-abc",
        "execute_request_id": "exec-123",
    }
    created[0].message_callback({"content": {"data": {"ok": True, "cell_id": "note-1"}}})
    assert receipt.status == "inserted" and receipt.cell_id == "note-1"
    assert "save the notebook" in repr(receipt)
    assert created[0].was_closed
    assert loop.deadline is not None and loop.deadline.cancelled
    assert "insert_tools" not in TOOL_FUNCTIONS


def test_insert_tools_rejects_missing_origin_and_empty_selection(
    monkeypatch: pytest.MonkeyPatch,  # Replace active shell.
) -> None:
    """Avoid a misleading request from an ordinary interpreter or empty list."""
    monkeypatch.setattr(kernel_insert_tools, "get_ipython", lambda: None)
    with pytest.raises(RuntimeError, match="running Jupyter notebook"):
        insert_tools(["read_cell"])
    with pytest.raises(ValueError, match="at least one tool"):
        insert_tools([])


def test_failed_ack_remains_visible_on_receipt(
    monkeypatch: pytest.MonkeyPatch,  # Replace kernel and comm transport.
) -> None:
    """Keep a failed browser insertion explicit without claiming a saved cell."""
    created: list[FakeComm] = []

    def create(
        target_name: str,  # Browser comm target.
        data: dict[str, Any],  # Markdown insertion request.
    ) -> FakeComm:
        """Capture the outbound request."""
        channel = FakeComm(target_name, data)
        created.append(channel)
        return channel

    monkeypatch.setattr(kernel_insert_tools, "get_ipython", lambda: FakeShell())
    monkeypatch.setattr(kernel_insert_tools, "create_comm", create)
    loop = FakeLoop()
    monkeypatch.setattr(kernel_insert_tools.asyncio, "get_running_loop", lambda: loop)
    receipt = insert_tools(["read_cell"])
    created[0].message_callback({"content": {"data": {"ok": False, "error": "Source cell removed"}}})
    assert receipt.status == "error" and receipt.error == "Source cell removed"
    assert "Source cell removed" in repr(receipt)


def test_unacknowledged_insert_expires_without_blocking_kernel(
    monkeypatch: pytest.MonkeyPatch,  # Replace kernel and comm transport.
) -> None:
    """A headless or disconnected client receives a later explicit error."""
    created: list[FakeComm] = []

    def create(
        target_name: str,  # Browser comm target.
        data: dict[str, Any],  # Markdown insertion request.
    ) -> FakeComm:
        """Capture the outbound request."""
        channel = FakeComm(target_name, data)
        created.append(channel)
        return channel

    loop = FakeLoop()
    monkeypatch.setattr(kernel_insert_tools, "get_ipython", lambda: FakeShell())
    monkeypatch.setattr(kernel_insert_tools, "create_comm", create)
    monkeypatch.setattr(kernel_insert_tools.asyncio, "get_running_loop", lambda: loop)
    receipt = insert_tools(["read_cell"])
    assert receipt.status == "requested"
    assert loop.deadline is not None
    loop.deadline.callback()
    assert receipt.status == "error" and "check for the new note before retrying" in receipt.error
    assert created[0].was_closed

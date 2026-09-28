"""Nonblocking execution-bound comm requests for notebook handoffs.

The browser owns the live model and serial notebook queue.  A Python caller
only schedules a successor and returns; it never waits for another shell run.
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any

from comm import create_comm

from .frontend_bridge import TERMINAL_ACTIONS, normalize_action
from .kernel_insert_tools import _origin

COMM_TARGET = "nbinlineai.execution_handoff.v1"
ACK_TIMEOUT_SECONDS = 30


@dataclass
class ExecutionHandoffReceipt:
    """One mutable scheduling acknowledgement, never an execution result."""

    request_id: str
    status: str = "requested"
    chain_id: str | None = None
    step_id: str | None = None
    cell_id: str | None = None
    error: str | None = None
    _comm: Any = field(default=None, repr=False)
    _deadline: Any = field(default=None, repr=False)

    def __repr__(self) -> str:
        if self.status == "requested":
            return f"ExecutionHandoffReceipt({self.request_id}: requested)"
        if self.status == "scheduled":
            return f"ExecutionHandoffReceipt({self.request_id}: scheduled {self.chain_id}/{self.step_id})"
        return f"ExecutionHandoffReceipt({self.request_id}: {self.status}: {self.error})"


def request_execution_handoff(operation: str, arguments: dict[str, Any]) -> ExecutionHandoffReceipt:
    """Request one bounded handoff from a running code cell without blocking."""
    if operation not in TERMINAL_ACTIONS:
        raise ValueError("Unknown notebook execution handoff")
    normalized = normalize_action(operation, arguments)
    execute_request_id, source_cell_id = _origin()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError as exc:
        raise RuntimeError("Notebook handoffs require an active Jupyter kernel event loop") from exc
    receipt = ExecutionHandoffReceipt(uuid.uuid4().hex)
    channel = create_comm(target_name=COMM_TARGET, data={
        "version": 1, "operation": operation, "arguments": normalized,
        "source_cell_id": source_cell_id, "execute_request_id": execute_request_id,
        "request_id": receipt.request_id,
    })
    receipt._comm = channel

    def acknowledge(message: dict[str, Any]) -> None:
        if receipt.status != "requested":
            return
        receipt._deadline.cancel()
        data = message.get("content", {}).get("data", {})
        if (isinstance(data, dict) and data.get("ok") is True
                and data.get("request_id") == receipt.request_id
                and isinstance(data.get("chain_id"), str) and data["chain_id"]
                and isinstance(data.get("step_id"), str) and data["step_id"]):
            receipt.status = "scheduled"
            receipt.chain_id = data["chain_id"]
            receipt.step_id = data["step_id"]
            if isinstance(data.get("cell_id"), str):
                receipt.cell_id = data["cell_id"]
        else:
            receipt.status = "error"
            receipt.error = (str(data.get("error", "Notebook handoff was rejected"))[:500]
                             if isinstance(data, dict) else "Notebook handoff was rejected")
        channel.close()
        receipt._comm = None

    def closed(_message: dict[str, Any]) -> None:
        if receipt.status == "requested":
            receipt._deadline.cancel()
            receipt.status = "error"
            receipt.error = "Notebook handoff channel closed without acknowledgement"
            receipt._comm = None

    def expired() -> None:
        if receipt.status == "requested":
            receipt.status = "error"
            receipt.error = "No notebook acknowledgement; inspect the notebook before retrying"
            channel.close()
            receipt._comm = None

    channel.on_msg(acknowledge)
    channel.on_close(closed)
    receipt._deadline = loop.call_later(ACK_TIMEOUT_SECONDS, expired)
    return receipt

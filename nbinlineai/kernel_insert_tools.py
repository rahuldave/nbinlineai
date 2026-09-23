"""Asynchronous, execution-bound notebook insertion for ``insert_tools``.

The kernel only requests an insertion. The JupyterLab extension verifies the
originating execute request and acknowledges success after changing the live
notebook model. No provider or saved notebook file is involved.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any

from comm import create_comm
from IPython import get_ipython

COMM_TARGET = "nbinlineai.insert_tools.v1"
MAX_MARKDOWN_CHARS = 8_000
ACK_TIMEOUT_SECONDS = 30


@dataclass
class InsertToolsReceipt:
    """Mutable acknowledgement for one requested live notebook insertion."""

    status: str = "requested"  # requested, inserted, or error.
    cell_id: str | None = None  # New Markdown cell ID after acknowledgement.
    error: str | None = None  # Reason an insertion could not be completed.
    _comm: Any = field(default=None, repr=False)  # Retain the channel until acknowledgement.
    _deadline: Any = field(default=None, repr=False)  # Active loop timeout handle.

    def __repr__(self) -> str:
        """Describe the current state without claiming an unacknowledged save."""
        if self.status == "inserted":
            return f"InsertToolsReceipt(inserted in cell {self.cell_id}; save the notebook to keep it)"
        if self.status == "error":
            return f"InsertToolsReceipt(error: {self.error})"
        return "InsertToolsReceipt(requested; wait for the new Markdown cell, then save the notebook)"


def _origin() -> tuple[str, str]:
    """Read the Jupyter execute request that is currently running this code."""
    shell = get_ipython()
    kernel = getattr(shell, "kernel", None)
    if kernel is None:
        raise RuntimeError("insert_tools requires a running Jupyter notebook Python kernel")
    parent = kernel.get_parent()
    if not isinstance(parent, dict):
        raise TypeError("insert_tools could not identify the executing code cell")
    header = parent.get("header", {})
    metadata = parent.get("metadata", {})
    request_id = header.get("msg_id") if isinstance(header, dict) else None
    message_type = header.get("msg_type") if isinstance(header, dict) else None
    cell_id = metadata.get("cellId") if isinstance(metadata, dict) else None
    if (message_type != "execute_request" or not isinstance(request_id, str) or not request_id
            or not isinstance(cell_id, str) or not cell_id):
        raise RuntimeError(
            "insert_tools requires a code cell run by the nbinlineai JupyterLab extension"
        )
    return request_id, cell_id


def request_insert_tools(
    markdown: str,  # Generated tool-reference Markdown to insert.
) -> InsertToolsReceipt:  # Receipt updated after the browser acknowledges insertion.
    """Send one bounded insertion request without waiting on the kernel event loop."""
    if not isinstance(markdown, str) or not markdown.strip() or len(markdown) > MAX_MARKDOWN_CHARS:
        raise ValueError("Generated tool Markdown must be nonempty and at most 8000 characters")
    request_id, cell_id = _origin()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError as exc:
        raise RuntimeError("insert_tools requires an active Jupyter kernel event loop") from exc
    receipt = InsertToolsReceipt()
    channel = create_comm(
        target_name=COMM_TARGET,
        data={"version": 1, "content": markdown, "source_cell_id": cell_id,
              "execute_request_id": request_id},
    )
    receipt._comm = channel

    def acknowledge(
        message: dict[str, Any],  # Incoming comm_msg from the originating JupyterLab client.
    ) -> None:
        """Record the browser's result and close this one-shot channel."""
        if receipt.status != "requested":
            return
        receipt._deadline.cancel()
        data = message.get("content", {}).get("data", {})
        if isinstance(data, dict) and data.get("ok") is True and isinstance(data.get("cell_id"), str):
            receipt.status = "inserted"
            receipt.cell_id = data["cell_id"]
        else:
            receipt.status = "error"
            receipt.error = (str(data.get("error", "Notebook insertion failed"))[:500]
                             if isinstance(data, dict) else "Notebook insertion failed")
        channel.close()
        receipt._comm = None

    def closed(
        _message: dict[str, Any],  # Kernel comm_close notification.
    ) -> None:
        """Report a closed channel if no result was acknowledged."""
        if receipt.status == "requested":
            receipt._deadline.cancel()
            receipt.status = "error"
            receipt.error = "The notebook insertion channel closed without an acknowledgement"
            receipt._comm = None

    def expired() -> None:
        """Fail a request that no browser acknowledged without blocking execution."""
        if receipt.status == "requested":
            receipt.status = "error"
            receipt.error = "No JupyterLab acknowledgement; check for the new note before retrying"
            channel.close()
            receipt._comm = None

    channel.on_msg(acknowledge)
    channel.on_close(closed)
    receipt._deadline = loop.call_later(ACK_TIMEOUT_SECONDS, expired)
    return receipt

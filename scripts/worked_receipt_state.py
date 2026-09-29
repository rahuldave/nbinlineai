"""Read only a named live receipt's operation ID and status from an owned kernel.

The worked runner calls this after a visible inspection cell executes. It does
not run notebook tools or read media bytes, source IDs, account data, or output.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from jupyter_client import BlockingKernelClient


def receipt_state(kernel_id: str, variable: str) -> dict[str, str]:
    if not re.fullmatch(r"[0-9a-f-]{36}", kernel_id):
        raise ValueError("Invalid owned kernel ID")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]{0,100}", variable):
        raise ValueError("Invalid receipt variable")
    runtime = Path(os.environ["JUPYTER_RUNTIME_DIR"]).resolve(strict=True)
    connection = (runtime / f"kernel-{kernel_id}.json").resolve(strict=True)
    if connection.parent != runtime:
        raise ValueError("Kernel connection is outside the owned runtime")
    client = BlockingKernelClient(connection_file=str(connection))
    client.load_connection_file()
    client.start_channels()
    try:
        client.wait_for_ready(timeout=10)
        code = ("import json\n"
                f"_worked_receipt = globals()[{variable!r}]\n"
                "print(json.dumps({'operationId': getattr(_worked_receipt, 'operation_id', None), "
                "'status': getattr(_worked_receipt, 'status', None)}))")
        message_id = client.execute(code, silent=False, store_history=False)
        observed: dict[str, str] | None = None
        while True:
            message = client.get_iopub_msg(timeout=15)
            if message["parent_header"].get("msg_id") != message_id:
                continue
            if message["msg_type"] == "stream":
                parsed = json.loads(message["content"]["text"])
                if isinstance(parsed, dict):
                    observed = parsed
            elif message["msg_type"] == "error":
                raise RuntimeError("Live receipt inspection failed")
            elif message["msg_type"] == "status" and message["content"].get("execution_state") == "idle":
                break
        if observed is None:
            raise RuntimeError("Live receipt inspection returned no state")
        operation_id = observed.get("operationId")
        status = observed.get("status")
        if not isinstance(operation_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation_id):
            raise ValueError("Invalid live operation ID")
        if status not in {"pending", "waiting_for_user", "running", "saving", "paused",
                          "completed", "failed", "cancelled", "expired"}:
            raise ValueError("Invalid live operation state")
        return {"operationId": operation_id, "status": status}
    finally:
        client.stop_channels()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kernel_id")
    parser.add_argument("variable")
    args = parser.parse_args()
    print(json.dumps(receipt_state(args.kernel_id, args.variable)))


if __name__ == "__main__":
    main()

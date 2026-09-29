"""Observe registered direct Python tool calls in an owned worked notebook kernel.

The probe records only tool names and whether their functions returned. It is
armed before one visible code cell, taken immediately afterward, and never
stores arguments, return values, paths, or media bytes in a notebook.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from jupyter_client import BlockingKernelClient


def _execute(kernel_id: str, code: str) -> str:
    if not re.fullmatch(r"[0-9a-f-]{36}", kernel_id):
        raise ValueError("Invalid owned kernel ID")
    runtime = Path(os.environ["JUPYTER_RUNTIME_DIR"]).resolve(strict=True)
    connection = (runtime / f"kernel-{kernel_id}.json").resolve(strict=True)
    if connection.parent != runtime:
        raise ValueError("Kernel connection is outside the owned runtime")
    client = BlockingKernelClient(connection_file=str(connection))
    client.load_connection_file()
    client.start_channels()
    try:
        client.wait_for_ready(timeout=10)
        message_id = client.execute(code, silent=False, store_history=False)
        text = ""
        while True:
            message = client.get_iopub_msg(timeout=15)
            if message["parent_header"].get("msg_id") != message_id:
                continue
            if message["msg_type"] == "stream":
                text += message["content"]["text"]
            elif message["msg_type"] == "error":
                raise RuntimeError("Direct-call probe failed in the owned kernel")
            elif message["msg_type"] == "status" and message["content"].get("execution_state") == "idle":
                break
        return text.strip()
    finally:
        client.stop_channels()


def arm(kernel_id: str, names: list[str]) -> None:
    if not names or len(names) > 20 or any(not re.fullmatch(r"[a-z][a-z0-9_]{0,99}", name) for name in names):
        raise ValueError("Invalid direct tool names")
    code = ("import sys\n"
            "from nbinlineai.tools import TOOL_FUNCTIONS as _worked_tools\n"
            f"_worked_names = {names!r}\n"
            "_worked_codes = {_worked_tools[name].__code__: name for name in _worked_names}\n"
            "_worked_calls = []\n"
            "_worked_active = {}\n"
            "_worked_previous_profile = sys.getprofile()\n"
            "def _worked_profile(frame, event, arg, previous=_worked_previous_profile):\n"
            "    if previous is not None:\n"
            "        previous(frame, event, arg)\n"
            "    name = _worked_codes.get(frame.f_code)\n"
            "    if name is None:\n"
            "        return\n"
            "    if event == 'call':\n"
            "        _worked_active[id(frame)] = len(_worked_calls)\n"
            "        _worked_calls.append({'name': name, 'completed': False})\n"
            "    elif event == 'return':\n"
            "        index = _worked_active.pop(id(frame), None)\n"
            "        if index is not None:\n"
            "            _worked_calls[index]['completed'] = (arg is not None and "
            "not (isinstance(arg, str) and arg.startswith('Error:')))\n"
            "sys.setprofile(_worked_profile)\n"
            "print('armed')")
    if _execute(kernel_id, code) != "armed":
        raise RuntimeError("Direct-call probe did not arm")


def take(kernel_id: str) -> list[dict[str, object]]:
    text = _execute(kernel_id, "import sys, json\n"
                    "if '_worked_previous_profile' in globals():\n"
                    "    sys.setprofile(globals().pop('_worked_previous_profile'))\n"
                    "print(json.dumps(globals().pop('_worked_calls', [])))")
    calls = json.loads(text)
    if not isinstance(calls, list) or len(calls) > 100:
        raise ValueError("Direct-call probe returned invalid count")
    if any(not isinstance(item, dict) or set(item) != {"name", "completed"}
           or not isinstance(item["name"], str) or not isinstance(item["completed"], bool)
           for item in calls):
        raise ValueError("Direct-call probe returned invalid entry")
    return calls


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kernel_id")
    parser.add_argument("action", choices=("arm", "take"))
    parser.add_argument("names", nargs="?")
    args = parser.parse_args()
    if args.action == "arm":
        names = json.loads(args.names or "null")
        if not isinstance(names, list):
            raise ValueError("Direct tool names must be a list")
        arm(args.kernel_id, names)
        print("armed")
    else:
        print(json.dumps(take(args.kernel_id)))


if __name__ == "__main__":
    main()

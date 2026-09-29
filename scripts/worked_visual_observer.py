"""Opt-in, private, single-question guard for visual worked-notebook trials.

The caller creates a private directory and arms one question with ``arm_question``.
Run this module as the isolated server child in place of ``scripts.worked_notebooks``.
No account state, prompts, cell source, tool output, or SSE payload is logged.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import stat
from pathlib import Path
from typing import Any

_FIELDS = frozenset({"session_id", "kernel_id", "path", "prompt_cell_id", "backend", "model", "max_tool_steps"})
_ID = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")
_ARM = "arm.json"
_LOG = "events.jsonl"


def _private_dir(directory: Path) -> None:
    mode = directory.lstat().st_mode
    if not stat.S_ISDIR(mode) or stat.S_IMODE(mode) & 0o077:
        raise ValueError("Observer directory must be a private directory (0700)")


def _write_exclusive(path: Path, data: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(data)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _validate_arm(arm: Any) -> dict:
    if (not isinstance(arm, dict) or set(arm) not in (
        {"binding", "groups"}, {"binding", "groups", "optional_terminal_group"},
        {"binding", "group_shapes"}, {"binding", "group_shapes", "optional_merge_terminal_read"},
    )):
        raise ValueError("Invalid observer arm")
    binding, groups = arm["binding"], arm.get("groups")
    if not isinstance(binding, dict) or set(binding) != _FIELDS:
        raise ValueError("Invalid observer binding")
    if any(not isinstance(binding[key], str) or not binding[key] or len(binding[key]) > 300
           for key in _FIELDS - {"max_tool_steps"}):
        raise ValueError("Invalid observer binding value")
    if type(binding["max_tool_steps"]) is not int or not 1 <= binding["max_tool_steps"] <= 10:
        raise ValueError("Invalid observer step limit")
    shapes = arm.get("group_shapes")
    if shapes is None:
        if (not isinstance(groups, list) or not 1 <= len(groups) <= binding["max_tool_steps"]
                or any(not isinstance(group, list) or not 1 <= len(group) <= 10 for group in groups)):
            raise ValueError("Invalid observer groups")
    elif (not isinstance(shapes, list) or len(shapes) != 2 or
          any(not isinstance(shape, list) or len(shape) not in (2, 3) or
              len(shape) > binding["max_tool_steps"] or
              any(not isinstance(group, list) or not 1 <= len(group) <= 10 for group in shape)
              for shape in shapes)):
        raise ValueError("Invalid observer group shapes")
    merge_terminal_read = arm.get("optional_merge_terminal_read", False)
    if merge_terminal_read is not False and merge_terminal_read is not True:
        raise ValueError("Invalid optional merge read flag")
    if merge_terminal_read and (shapes is None or binding["max_tool_steps"] < 4):
        raise ValueError("Optional merge read requires four allowed tool steps")
    optional = arm.get("optional_terminal_group")
    if optional is not None:
        if (not isinstance(optional, list) or len(optional) != 1 or
                len(groups) + 1 > binding["max_tool_steps"]):
            raise ValueError("Invalid optional terminal group")
        call = optional[0]
        if (not isinstance(call, dict) or set(call) != {"name", "argument_options"} or
                call["name"] != "list_cells" or not isinstance(call["argument_options"], list) or
                len(call["argument_options"]) != 1 or not isinstance(call["argument_options"][0], dict)):
            raise ValueError("Optional terminal group must be one exact list_cells call")
        values = call["argument_options"][0]
        if (set(values) != {"start", "limit"} or type(values["start"]) is not int or
                type(values["limit"]) is not int or not 0 <= values["start"] <= 10000 or
                not 1 <= values["limit"] <= 20):
            raise ValueError("Invalid optional list_cells bounds")
    all_groups = ([group for shape in shapes for group in shape] if shapes is not None else
                  [*groups, *([optional] if optional is not None else [])])
    for group in all_groups:
        for call in group:
            if (not isinstance(call, dict) or
                    set(call) not in ({"name", "arguments"}, {"name", "argument_options"})):
                raise ValueError("Invalid observer call policy")
            if not isinstance(call["name"], str) or not _ID.fullmatch(call["name"]):
                raise ValueError("Invalid observer tool name")
            if "argument_options" in call:
                options = call["argument_options"]
                if not isinstance(options, list) or not 1 <= len(options) <= 4:
                    raise ValueError("Invalid observer argument options")
                for option in options:
                    if not isinstance(option, dict) or len(option) > 20:
                        raise ValueError("Invalid observer argument option")
                    for key, value in option.items():
                        if not isinstance(key, str) or not _ID.fullmatch(key):
                            raise ValueError("Invalid observer argument key")
                        if (type(value) not in (str, int, bool, type(None)) or
                                isinstance(value, str) and len(value) > 4000 or
                                isinstance(value, int) and len(str(value)) > 30):
                            raise ValueError("Invalid exact argument value")
                continue
            rules = call["arguments"]
            if not isinstance(rules, dict) or len(rules) > 20:
                raise ValueError("Invalid observer argument rules")
            for key, rule in rules.items():
                if not isinstance(key, str) or not _ID.fullmatch(key):
                    raise ValueError("Invalid observer argument key")
                if not isinstance(rule, dict) or len(rule) != 1:
                    raise ValueError("Invalid observer argument rule")
                kind, value = next(iter(rule.items()))
                if kind == "equals":
                    if not isinstance(value, (str, int, float, bool, type(None))) or len(str(value)) > 300:
                        raise ValueError("Invalid equality rule")
                elif kind == "one_of":
                    if not isinstance(value, list) or not value or len(value) > 100 or any(
                        not isinstance(item, str) or len(item) > 300 for item in value
                    ):
                        raise ValueError("Invalid choices rule")
                elif kind == "text_max":
                    if type(value) is not int or not 1 <= value <= 4000:
                        raise ValueError("Invalid text rule")
                elif kind == "int_range":
                    if (not isinstance(value, list) or len(value) != 2 or
                            any(type(item) is not int for item in value) or
                            not 0 <= value[0] <= value[1] <= 10000):
                        raise ValueError("Invalid integer rule")
                else:
                    raise ValueError("Unknown observer argument rule")
    if shapes is not None:
        first, second = shapes
        if (len(first) != 2 or [len(group) for group in first] != [2, 1] or
                len(second) != 3 or [len(group) for group in second] != [1, 1, 1] or
                first[0][0] != second[0][0] or first[0][1] != second[1][0] or
                first[1][0] != second[2][0]):
            raise ValueError("Observer merge shapes must contain the same ordered calls")
        read_first, read_second, merge = first[0][0], first[0][1], first[1][0]
        if (read_first["name"] != "read_cell" or read_second["name"] != "read_cell" or
                merge["name"] != "merge_cells" or
                any(set(call) != {"name", "argument_options"} or
                    len(call["argument_options"]) != 1 for call in (read_first, read_second, merge))):
            raise ValueError("Observer merge shapes require exact read and merge calls")
        first_args = read_first["argument_options"][0]
        second_args = read_second["argument_options"][0]
        merge_args = merge["argument_options"][0]
        if (set(first_args) != {"cell_id"} or set(second_args) != {"cell_id"} or
                not isinstance(first_args["cell_id"], str) or
                not isinstance(second_args["cell_id"], str) or
                not _ID.fullmatch(first_args["cell_id"]) or
                not _ID.fullmatch(second_args["cell_id"]) or
                first_args["cell_id"] == second_args["cell_id"] or
                set(merge_args) != {"first_cell_id", "second_cell_id", "expected_first", "expected_second"} or
                merge_args["first_cell_id"] != first_args["cell_id"] or
                merge_args["second_cell_id"] != second_args["cell_id"] or
                not isinstance(merge_args["expected_first"], str) or not merge_args["expected_first"] or
                not isinstance(merge_args["expected_second"], str) or not merge_args["expected_second"]):
            raise ValueError("Observer merge arguments must bind two distinct cells and exact sources")
    return arm


def arm_question(directory: Path, binding: dict, groups: list[list[dict]] | None = None,
                 optional_terminal_group: list[dict] | None = None,
                 *, group_shapes: list[list[list[dict]]] | None = None,
                 optional_merge_terminal_read: bool = False) -> None:
    """Create one private arm; the next matching prompt consumes it exactly once."""
    _private_dir(directory)
    if type(optional_merge_terminal_read) is not bool:
        raise ValueError("Invalid optional merge read flag")
    if ((groups is None) == (group_shapes is None) or
            (group_shapes is not None and optional_terminal_group is not None) or
            (optional_merge_terminal_read and group_shapes is None)):
        raise ValueError("Choose one observer group policy")
    policy = {"binding": binding}
    if group_shapes is not None:
        policy["group_shapes"] = group_shapes
        if optional_merge_terminal_read:
            policy["optional_merge_terminal_read"] = optional_merge_terminal_read
    else:
        policy["groups"] = groups
    if optional_terminal_group is not None:
        policy["optional_terminal_group"] = optional_terminal_group
    arm = _validate_arm(policy)
    _write_exclusive(directory / _ARM, json.dumps(arm, ensure_ascii=True, separators=(",", ":")))


def _consume_arm(directory: Path) -> dict:
    path = directory / _ARM
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode) or stat.S_IMODE(os.fstat(fd).st_mode) & 0o077:
            raise ValueError("Observer arm must be a private regular file")
        raw = os.read(fd, 32769)
        if len(raw) > 32768:
            raise ValueError("Observer arm is too large")
        arm = _validate_arm(json.loads(raw))
    finally:
        os.close(fd)
        path.unlink(missing_ok=True)
    return arm


def _arguments(raw: Any, policy: dict) -> tuple[str | None, list[str]]:
    if isinstance(raw, str):
        if len(raw) > 12000:
            return "argument_values", []
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return "argument_values", []
    if not isinstance(raw, dict):
        return "argument_values", []
    if "argument_options" in policy:
        same_keys = [option for option in policy["argument_options"] if set(raw) == set(option)]
        if not same_keys:
            return "argument_keys", []
        for option in same_keys:
            if all(type(raw[key]) is type(value) and raw[key] == value for key, value in option.items()):
                return None, sorted(option)
        return "argument_values", []
    rules = policy["arguments"]
    if set(raw) != set(rules):
        return "argument_keys", []
    for key, rule in rules.items():
        kind, bound = next(iter(rule.items()))
        value = raw[key]
        if kind == "equals" and (type(value) is not type(bound) or value != bound):
            return "argument_values", []
        if kind == "one_of" and (not isinstance(value, str) or value not in bound):
            return "argument_values", []
        if kind == "text_max" and (not isinstance(value, str) or not 1 <= len(value) <= bound):
            return "argument_values", []
        if kind == "int_range" and (type(value) is not int or not bound[0] <= value <= bound[1]):
            return "argument_values", []
    return None, sorted(rules)


def _result_state(text: Any) -> str:
    if isinstance(text, str):
        if text.startswith("Error:"):
            return "reported_error"
        if len(text) <= 12000:
            try:
                parsed = json.loads(text)
            except (TypeError, ValueError):
                pass
            else:
                if (isinstance(parsed, dict) and isinstance(parsed.get("status"), str) and
                        parsed["status"] in {"error", "failed", "rejected"}):
                    return "reported_error"
    return "returned"


class VisualObserver:
    def __init__(self, directory: Path, original):
        _private_dir(directory)
        self.directory = directory
        self.original = original
        self.active = False
        self.lock = asyncio.Lock()
        log_path = directory / _LOG
        if log_path.exists() and (not log_path.is_file() or stat.S_IMODE(log_path.stat().st_mode) & 0o077):
            raise ValueError("Observer log must be a private regular file")
        self.log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND |
                              getattr(os, "O_NOFOLLOW", 0), 0o600)

    def close(self) -> None:
        os.close(self.log_fd)

    def _log(self, **record) -> None:
        # Only records assembled from constants, bounded counters and policy names reach here.
        os.write(self.log_fd, (json.dumps(record, separators=(",", ":")) + "\n").encode())

    async def __call__(self, body, *args, **kwargs):
        async with self.lock:
            if self.active:
                self._log(kind="denied", reason="active")
                raise ValueError("Observer already has an active question")
            try:
                arm = _consume_arm(self.directory)
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                self._log(kind="denied", reason="unarmed_or_invalid")
                raise ValueError("Observer requires a fresh valid arm") from None
            self.active = True
        binding = arm["binding"]
        scope = kwargs.get("subscription_scope")
        matched = (len(args) >= 2 and isinstance(scope, dict)
                   and body.get("session_id") == binding["session_id"]
                   and args[1] == binding["kernel_id"]
                   and scope.get("session_id") == binding["session_id"]
                   and scope.get("notebook_path") == binding["path"]
                   and all(body.get(key) == binding[key] for key in
                           ("prompt_cell_id", "backend", "model", "max_tool_steps")))
        if not matched:
            self._log(kind="denied", reason="binding")
            self.active = False
            raise ValueError("Observer request did not match its arm")
        optional = arm.get("optional_terminal_group")
        if "group_shapes" in arm:
            shapes = list(arm["group_shapes"])
            if arm.get("optional_merge_terminal_read"):
                terminal_read = [shapes[0][0][0]]
                shapes.extend([*shape, terminal_read] for shape in arm["group_shapes"])
        else:
            required_groups = arm["groups"]
            shapes = [required_groups]
            if optional is not None:
                shapes.append([*required_groups, optional])
        self._log(kind="admitted", groups=len(shapes[0]), alternatives=len(shapes),
                  optional_terminal=optional is not None)
        generator = self.original(body, *args, **kwargs)
        group = -1
        call_index = 0
        pending = None
        terminal = False
        try:
            async for event in generator:
                if terminal:
                    self._log(kind="blocked", reason="after_terminal")
                    raise ValueError("Observer blocked events after completion")
                kind = event.get("type")
                if kind == "context":
                    if pending is not None:
                        self._log(kind="blocked", reason="incomplete_group")
                        raise ValueError("Observer expected another tool call")
                    next_shapes = ([shape for shape in shapes if group < 0] if group < 0 else
                                   [shape for shape in shapes if group < len(shape) and
                                    call_index == len(shape[group])])
                    if not next_shapes:
                        reason = ("incomplete_group" if any(
                            group < len(shape) and call_index < len(shape[group]) for shape in shapes
                        ) else "extra_group")
                        self._log(kind="blocked", reason=reason)
                        raise ValueError("Observer blocked another model round")
                    shapes = next_shapes
                    group += 1
                    call_index = 0
                elif kind == "tool_start":
                    name = event.get("name")
                    available = ([shape[group][call_index] for shape in shapes if
                                  0 <= group < len(shape) and call_index < len(shape[group])]
                                 if pending is None else [])
                    if not available:
                        self._log(kind="blocked", reason="unexpected_call")
                        raise ValueError("Observer blocked an unexpected tool")
                    named = [policy for policy in available if name == policy["name"]]
                    if not named:
                        self._log(kind="blocked", reason="tool_name")
                        raise ValueError("Observer blocked a tool outside the question policy")
                    checked = [(policy, *_arguments(event.get("arguments"), policy)) for policy in named]
                    matched_policy = next(((policy, fields) for policy, mismatch, fields in checked
                                           if mismatch is None), None)
                    if matched_policy is None:
                        reason = ("argument_values" if any(mismatch == "argument_values"
                                                          for _, mismatch, _ in checked) else "argument_keys")
                        self._log(kind="blocked", reason=reason)
                        raise ValueError("Observer blocked a tool outside the question policy")
                    if not isinstance(event.get("id"), str) or not event["id"] or len(event["id"]) > 200:
                        self._log(kind="blocked", reason="call_id")
                        raise ValueError("Observer blocked a tool outside the question policy")
                    policy, fields = matched_policy
                    shapes = [shape for shape in shapes if 0 <= group < len(shape) and
                              call_index < len(shape[group]) and shape[group][call_index] == policy]
                    pending = (event["id"], name)
                    self._log(kind="tool_start", group=group, call=call_index, name=name,
                              argument_fields=fields)
                elif kind == "tool_result":
                    if pending != (event.get("id"), event.get("name")):
                        self._log(kind="blocked", reason="result_order")
                        raise ValueError("Observer blocked an unmatched tool result")
                    self._log(kind="tool_result", group=group, call=call_index,
                              name=pending[1], state=_result_state(event.get("text")))
                    pending = None
                    call_index += 1
                elif kind == "done":
                    exact = [shape for shape in shapes if group == len(shape) and call_index == 0 and
                             event.get("tool_steps") == len(shape)]
                    if pending is not None or not exact:
                        self._log(kind="blocked", reason="count")
                        raise ValueError("Observer expected the exact tool count")
                    terminal = True
                    self._log(kind="terminal", state="done", groups=event["tool_steps"])
                elif kind == "error":
                    terminal = True
                    self._log(kind="terminal", state="error")
                yield event
            if not terminal:
                self._log(kind="terminal", state="incomplete")
                raise ValueError("Observer prompt ended without a terminal event")
        except BaseException:
            if not terminal:
                self._log(kind="terminal", state="aborted")
            raise
        finally:
            await generator.aclose()
            self.active = False


def install(directory: Path) -> VisualObserver:
    """Patch only this isolated server process; returns an owner to close at exit."""
    from nbinlineai import handlers

    observer = VisualObserver(directory, handlers.run_prompt)
    handlers.run_prompt = observer
    return observer


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    directory = parser.parse_args().directory
    observer = install(directory)
    try:
        from scripts.worked_notebooks import _server_child

        _server_child()
    finally:
        observer.close()


if __name__ == "__main__":
    main()

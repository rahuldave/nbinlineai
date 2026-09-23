"""Correlate one browser notebook action with an authenticated prompt run."""

import asyncio
import json
import uuid
from dataclasses import dataclass
from typing import Any

ACTION_TIMEOUT_SECONDS = 45
MAX_REPLY_CHARS = 4_000
MAX_ERROR_CHARS = 500
MAX_INSERT_CHARS = 8_000
MAX_ACTIVE_RUNS = 64


class BridgeNotFound(LookupError):
    """A run or action has ended."""


class BridgeConflict(RuntimeError):
    """An action reply has already been accepted."""


@dataclass
class PendingAction:
    """One action awaiting a browser reply."""

    request_id: str
    name: str
    future: asyncio.Future[str]


@dataclass
class PromptRun:
    """Session and kernel binding for one SSE prompt."""

    run_id: str
    session_id: str
    prompt_cell_id: str
    kernel_id: str
    kernel: Any
    pending: PendingAction | None = None


def _text(
    value: Any,  # Value received from a model or browser.
    label: str,  # Field name in a safe validation error.
    maximum: int,  # Maximum accepted character count.
    allow_empty: bool = False,  # Whether empty text is valid.
) -> str:  # Validated string.
    """Validate bounded text without including its value in errors."""
    if (not isinstance(value, str) or len(value) > maximum
            or (not allow_empty and not value.strip())):
        raise ValueError(f"{label} must be text of at most {maximum} characters")
    return value


def _integer(
    value: Any,  # Value received from a model.
    label: str,  # Field name in a safe validation error.
    minimum: int,  # Smallest accepted value.
    maximum: int,  # Largest accepted value.
) -> int:  # Validated integer.
    """Reject booleans and out-of-range action numbers."""
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be an integer from {minimum} to {maximum}")
    return value


def normalize_action(
    name: str,  # Canonical front-end action name.
    arguments: Any,  # Model tool-call arguments.
) -> dict[str, Any]:  # Validated arguments for the browser.
    """Validate an allowlisted browser action before sending it over SSE."""
    if isinstance(arguments, str):
        if len(arguments) > 16_000:
            raise ValueError("Action arguments are too large")
        try:
            arguments = json.loads(arguments)
        except ValueError as exc:
            raise ValueError("Action arguments are invalid JSON") from exc
    if not isinstance(arguments, dict):
        raise TypeError("Action arguments must be a JSON object")
    try:
        size = len(json.dumps(arguments))
    except (TypeError, ValueError) as exc:
        raise ValueError("Action arguments must be JSON values") from exc
    if size > 16_000:
        raise ValueError("Action arguments are too large")
    if name == "list_cells":
        if set(arguments) - {"start", "limit"}:
            raise ValueError("Unexpected list_cells argument")
        return {
            "start": _integer(arguments.get("start", 0), "start", 0, 100_000),
            "limit": _integer(arguments.get("limit", 20), "limit", 1, 50),
        }
    if name == "read_cell":
        if set(arguments) - {"cell_id", "start_line", "end_line"}:
            raise ValueError("Unexpected read_cell argument")
        start = _integer(arguments.get("start_line", 1), "start_line", 1, 1_000_000)
        end = _integer(arguments.get("end_line", 40), "end_line", start, 1_000_000)
        if end - start >= 80:
            raise ValueError("read_cell can request at most 80 lines")
        return {
            "cell_id": _text(arguments.get("cell_id"), "cell_id", 200),
            "start_line": start,
            "end_line": end,
        }
    if name == "insert_markdown":
        if set(arguments) - {"content", "after_cell_id"}:
            raise ValueError("Unexpected insert_markdown argument")
        return {
            "content": _text(arguments.get("content"), "content", MAX_INSERT_CHARS),
            "after_cell_id": _text(arguments.get("after_cell_id", ""), "after_cell_id", 200,
                                   allow_empty=True),
        }
    raise ValueError("Unsupported front-end action")


class FrontendBridge:
    """Hold short-lived action futures shared by prompt and reply handlers."""

    def __init__(self) -> None:
        """Create an empty server-local run registry."""
        self.runs: dict[str, PromptRun] = {}

    def start(
        self,
        session_id: str,  # Bound Jupyter notebook session.
        prompt_cell_id: str,  # Bound AI prompt model ID.
        kernel_id: str,  # Bound Python kernel ID.
        kernel: Any,  # Bound kernel manager object.
    ) -> PromptRun:  # New active prompt run.
        """Create an unpredictable run ID after session authorization."""
        if len(self.runs) >= MAX_ACTIVE_RUNS:
            raise ValueError("Too many active AI prompts")
        run = PromptRun(uuid.uuid4().hex, session_id, prompt_cell_id, kernel_id, kernel)
        self.runs[run.run_id] = run
        return run

    def prepare(
        self,
        run: PromptRun,  # Active run requesting an action.
        name: str,  # Canonical browser action name.
        arguments: Any,  # Model tool-call arguments.
    ) -> tuple[dict[str, Any], PendingAction]:  # SSE event and pending action.
        """Register one bounded action and build its SSE event."""
        if self.runs.get(run.run_id) is not run:
            raise BridgeNotFound("AI prompt run has ended")
        if run.pending is not None:
            raise BridgeConflict("Another notebook action is pending")
        normalized = normalize_action(name, arguments)
        pending = PendingAction(uuid.uuid4().hex, name, asyncio.get_running_loop().create_future())
        run.pending = pending
        return {
            "type": "frontend_action", "run_id": run.run_id, "request_id": pending.request_id,
            "name": name, "arguments": normalized,
        }, pending

    async def wait(
        self,
        run: PromptRun,  # Active prompt run.
        pending: PendingAction,  # Previously emitted action.
    ) -> str:  # Browser result for the model.
        """Wait for one reply; expire its ID on timeout or cancellation."""
        try:
            return await asyncio.wait_for(pending.future, ACTION_TIMEOUT_SECONDS)
        except TimeoutError as exc:
            raise TimeoutError("Notebook action timed out") from exc
        finally:
            if run.pending is pending:
                run.pending = None

    async def reply(
        self,
        body: Any,  # Authenticated JSON request body.
        dispatcher: Any,  # Session-bound kernel dispatcher.
    ) -> None:  # Accepted reply has no secret-bearing return value.
        """Accept exactly one correctly bound reply for an active action."""
        if not isinstance(body, dict):
            raise TypeError("Action reply must be a JSON object")
        run_id = _text(body.get("run_id"), "run_id", 64)
        request_id = _text(body.get("request_id"), "request_id", 64)
        run = self.runs.get(run_id)
        if run is None:
            raise BridgeNotFound("AI prompt run has ended")
        if body.get("session_id") != run.session_id or body.get("prompt_cell_id") != run.prompt_cell_id:
            raise ValueError("Action reply does not match its notebook prompt")
        pending = run.pending
        if pending is None or pending.request_id != request_id:
            raise BridgeNotFound("Notebook action has expired")
        if pending.future.done():
            raise BridgeConflict("Notebook action reply was already accepted")
        if not isinstance(body.get("ok"), bool):
            raise TypeError("Action reply ok must be a boolean")
        allowed = {"run_id", "request_id", "session_id", "prompt_cell_id", "ok"}
        if body["ok"] and pending.name == "insert_markdown":
            allowed.add("cell_id")
            cell_id = _text(body.get("cell_id"), "cell_id", 200)
            result = f"Inserted Markdown cell {cell_id} in the live notebook model (not saved to disk)."
        else:
            allowed.add("text")
            result = _text(body.get("text"), "text",
                           MAX_REPLY_CHARS if body["ok"] else MAX_ERROR_CHARS)
            if not body["ok"]:
                result = f"Error: {result}"
        if set(body) - allowed:
            raise ValueError("Unexpected action reply field")
        current_id, current_kernel = await dispatcher.resolve(run.session_id)
        if current_id != run.kernel_id or current_kernel is not run.kernel:
            raise ValueError("Notebook session changed kernels during the prompt")
        if self.runs.get(run_id) is not run or run.pending is not pending:
            raise BridgeNotFound("Notebook action has expired")
        if pending.future.done():
            raise BridgeConflict("Notebook action reply was already accepted")
        pending.future.set_result(result)

    def close(
        self,
        run: PromptRun,  # Prompt run that completed or disconnected.
    ) -> None:  # Registry cleanup.
        """Expire all action IDs and cancel a remaining waiter."""
        if self.runs.pop(run.run_id, None) is not run:
            return
        if run.pending is not None and not run.pending.future.done():
            run.pending.future.cancel()
        run.pending = None

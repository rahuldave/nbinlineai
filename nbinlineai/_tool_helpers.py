"""Shared bounds, validation, and static live-name lookup for kernel tools."""

import builtins
import inspect
import re
from typing import Any

MAX_RESULT_CHARS = 3_200
MAX_REPR_CHARS = 3_900
PUBLIC_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def _bounded(
    value: str,  # Full result text.
    notice: str = "\n[truncated; narrow the request]",  # Visible truncation notice.
) -> str:  # Result small enough for the kernel bridge.
    """Bound result text with an explicit truncation notice."""
    if len(value) <= MAX_RESULT_CHARS and len(repr(value)) <= MAX_REPR_CHARS:
        return value
    low, high = 0, min(len(value), MAX_RESULT_CHARS - len(notice))
    while low < high:
        middle = (low + high + 1) // 2
        if len(repr(value[:middle] + notice)) <= MAX_REPR_CHARS:
            low = middle
        else:
            high = middle - 1
    return value[:low] + notice


def _text(
    value: str,  # User-supplied text.
    label: str,  # Field name for errors.
    maximum: int = 1_000,  # Maximum accepted length.
) -> str:  # Validated text.
    """Require a bounded, nonblank string."""
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{label} must be nonempty text of at most {maximum} characters")
    return value


def _limit(
    value: int,  # Requested result count.
    maximum: int,  # Maximum accepted count.
) -> int:  # Validated count.
    """Require a small positive integer result count."""
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f"limit must be an integer from 1 to {maximum}")
    return value


def _resolve_python_name(
    name: str,  # Name in the live user namespace or Python builtins.
) -> Any:  # Explicitly resolved object without evaluating source code.
    """Resolve a public name or short attribute path without calling it."""
    parts = _text(name, "name", 200).split(".")
    if len(parts) > 4 or any(PUBLIC_NAME.fullmatch(part) is None for part in parts):
        raise ValueError("name must be a public Python identifier or short attribute path")
    from IPython import get_ipython

    shell = get_ipython()
    namespace = getattr(shell, "user_ns", {}) if shell is not None else {}
    if parts[0] in namespace:
        value = namespace[parts[0]]
    elif parts[0] in vars(builtins):
        value = vars(builtins)[parts[0]]
    else:
        raise ValueError("Python name is not defined in the live kernel or builtins")
    for part in parts[1:]:
        try:
            value = inspect.getattr_static(value, part)
        except AttributeError as exc:
            raise ValueError(f"Python attribute {part} is not present") from exc
    return value

"""Bounded live-object inspection, installed-skill discovery, and teaching traces."""

import ast
import importlib
import inspect
import json
import linecache
import os
import re
import sys
from importlib.metadata import entry_points
from itertools import islice
from pathlib import Path
from types import MappingProxyType, ModuleType
from typing import Any

from ._tool_helpers import _bounded, _limit, _resolve_python_name, _text

_MODULE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$")
_MAX_SCAN = 500
_MAX_SOURCE_BYTES = 1_000_000
_SIMPLE = (str, int, float, bool, type(None))
__all__ = (
    "INSPECTION_TOOL_FUNCTIONS",
    "api_names",
    "inspect_value",
    "list_skills",
    "read_skill",
    "search_docs",
    "search_value",
    "source_files",
    "trace_function",
)


def _target(name: str, module: str = "") -> Any:
    """Resolve a live symbol, or explicitly import one installed module."""
    if not module:
        return _resolve_python_name(name)
    if not isinstance(module, str) or len(module) > 200 or not _MODULE.fullmatch(module):
        raise ValueError("module must be a public dotted Python module name")
    imported = importlib.import_module(module)
    if not name or name == module:
        return imported
    parts = _text(name, "name", 200).split(".")
    if parts[:len(module.split("."))] == module.split("."):
        parts = parts[len(module.split(".")):]
    value: Any = imported
    for part in parts:
        if not _MODULE.fullmatch(part) or part.startswith("_"):
            raise ValueError("name must contain public Python identifiers")
        try:
            value = inspect.getattr_static(value, part)
        except AttributeError as exc:
            raise ValueError(f"Python attribute {part} is not present") from exc
    return value


def _members(value: Any) -> list[tuple[str, Any]]:
    """Read public attributes without invoking descriptors or custom __dir__."""
    if isinstance(value, ModuleType):
        mappings = [vars(value)]
    elif inspect.isclass(value):
        mappings = [vars(cls) for cls in value.__mro__]
    else:
        try:
            mappings = [vars(value)]
        except TypeError:
            mappings = []
        mappings.extend(vars(cls) for cls in type(value).__mro__)
    names: set[str] = set()
    for mapping in mappings:
        names.update(
            key for key in islice(mapping, _MAX_SCAN * 4)
            if isinstance(key, str) and key and not key.startswith("_")
        )
        if len(names) > _MAX_SCAN * 4:
            break
    output: list[tuple[str, Any]] = []
    for key in sorted(names)[:_MAX_SCAN]:
        try:
            output.append((key, inspect.getattr_static(value, key)))
        except AttributeError:
            continue
    return output


def _doc(value: Any) -> str:
    """Read a direct docstring without property access or source execution."""
    if inspect.ismethod(value):
        value = value.__func__
    if inspect.isfunction(value) or inspect.isbuiltin(value):
        raw = value.__doc__
    else:
        try:
            raw = vars(value).get("__doc__")
        except TypeError:
            return ""
    return inspect.cleandoc(raw[:1_000]) if isinstance(raw, str) else ""


def api_names(
    name: str,  # Live Python name, or public name within module.
    module: str = "",  # Explicit installed module to import.
    query: str = "",  # Optional name filter.
    limit: int = 30,  # Maximum matching names to show.
) -> str:
    """List public members of a live object or explicitly imported module."""
    limit = _limit(limit, 100)
    if not isinstance(query, str) or len(query) > 200:
        raise ValueError("query must be text of at most 200 characters")
    value = _target(name, module)
    needle = query.casefold()
    matches = [key for key, _ in _members(value) if needle in key.casefold()]
    body = "\n".join(matches[:limit]) or "[no public names matched]"
    if len(matches) > limit:
        body += "\n[partial results; narrow the query]"
    return _bounded(f"Public API of {name or module} ({type(value).__name__}):\n{body}")


def search_docs(
    name: str,  # Live Python name, or public name within module.
    query: str,  # Text to find in names or docstrings.
    module: str = "",  # Explicit installed module to import.
    depth: int = 1,  # Public member levels to inspect.
    limit: int = 20,  # Maximum matches to show.
) -> str:
    """Search public names and direct docstrings in a bounded object tree."""
    needle = _text(query, "query", 200).casefold()
    limit = _limit(limit, 50)
    if isinstance(depth, bool) or not isinstance(depth, int) or not 0 <= depth <= 2:
        raise ValueError("depth must be an integer from 0 to 2")
    root = _target(name, module)
    pending = [(name or module, root, 0)]
    seen: set[int] = set()
    found: list[str] = []
    scanned = 0
    while pending and scanned < _MAX_SCAN and len(found) < limit:
        label, value, level = pending.pop(0)
        if id(value) in seen:
            continue
        seen.add(id(value))
        scanned += 1
        doc = _doc(value)
        if needle in label.casefold() or needle in doc.casefold():
            excerpt = next((line.strip() for line in doc.splitlines() if needle in line.casefold()), "")
            found.append(f"{label}: {excerpt[:180] or '[name match]'}")
        if level < depth and scanned + len(pending) < _MAX_SCAN:
            pending.extend((f"{label}.{key}", member, level + 1) for key, member in _members(value))
    body = "\n".join(found) or "[no documentation matched]"
    if pending or scanned >= _MAX_SCAN:
        body += "\n[partial results; narrow the query or depth]"
    return _bounded(f"Documentation matches for {query!r}:\n{body}")


def _preview(value: Any) -> str:
    if type(value) in _SIMPLE:
        return repr(value[:120] if isinstance(value, str) else value)[:160]
    if type(value) is bytes:
        return repr(value[:80])[:160]
    return f"<{type(value).__name__}>"


def _container(value: Any) -> tuple[str, int, Any]:
    kind = type(value)
    if kind is str:
        if len(value) > _MAX_SOURCE_BYTES:
            raise ValueError("Text exceeds the 1 MB inspection limit")
        return "text", len(value), value
    if kind in (list, tuple, dict, set, frozenset, range):
        return kind.__name__, len(value), value
    raise ValueError("Supported values are text and built-in list, tuple, dict, set, frozenset, or range")


def inspect_value(
    name: str,  # Live text or built-in container name.
    start: int = 0,  # Zero-based start index.
    limit: int = 20,  # Maximum characters or items to show.
) -> str:
    """Show a bounded slice of a live built-in container or text value."""
    if isinstance(start, bool) or not isinstance(start, int) or not 0 <= start <= 10_000:
        raise ValueError("start must be an integer from 0 to 10000")
    limit = _limit(limit, 100)
    kind, length, value = _container(_resolve_python_name(name))
    if kind == "text":
        excerpt = repr(value[start:start + min(limit, 100)])
    else:
        values = value.items() if kind == "dict" else value
        excerpt = "\n".join(
            f"{start + offset}: " + (
                f"{_preview(item[0])} -> {_preview(item[1])}" if kind == "dict" else _preview(item)
            )
            for offset, item in enumerate(islice(values, start, start + limit))
        ) or "[no items in this slice]"
    return _bounded(f"{name}: {kind}, length {length}, start {start}\n{excerpt}")


def search_value(
    name: str,  # Live text or built-in container name.
    query: str,  # Text to find in visible values.
    limit: int = 20,  # Maximum matches to show.
) -> str:
    """Search bounded visible values in live text or a built-in container."""
    needle = _text(query, "query", 200).casefold()
    limit = _limit(limit, 50)
    kind, length, value = _container(_resolve_python_name(name))
    found: list[str] = []
    if kind == "text":
        matches = re.finditer(re.escape(query), value, flags=re.IGNORECASE)
        for match in islice(matches, limit):
            position = match.start()
            found.append(f"{position}: {value[max(0, position - 40):position + len(query) + 40]!r}")
        partial = next(matches, None) is not None if len(found) == limit else False
    else:
        values = value.items() if kind == "dict" else value
        scanned = 0
        for index, item in enumerate(islice(values, _MAX_SCAN + 1)):
            if index == _MAX_SCAN:
                break
            scanned += 1
            display = (f"{_preview(item[0])} -> {_preview(item[1])}" if kind == "dict"
                       else _preview(item))
            if needle in display.casefold():
                found.append(f"{index}: {display}")
                if len(found) == limit:
                    break
        partial = len(found) == limit or length > scanned
    body = "\n".join(found) or "[no matches]"
    if partial:
        body += "\n[partial results; narrow the query]"
    return _bounded(f"Matches in {name} ({kind}, length {length}):\n{body}")


def source_files(
    name: str,  # Live Python name, or public name within module.
    module: str = "",  # Explicit installed module to import.
    limit: int = 30,  # Maximum nearby Python paths to show.
) -> str:
    """Find nearby Python source files for a live symbol or imported module."""
    limit = _limit(limit, 100)
    value = _target(name, module)
    try:
        source = inspect.getsourcefile(value)
    except (TypeError, OSError):
        source = None
    if source is None:
        return _bounded(f"No Python source file is available for {name or module}")
    primary = Path(source).resolve()
    files = [primary]
    inspected = 0
    with os.scandir(primary.parent) as listing:
        for entry in listing:
            inspected += 1
            if inspected > _MAX_SCAN:
                break
            if entry.name.endswith(".py") and not entry.is_symlink() and entry.is_file(follow_symlinks=False):
                path = Path(entry.path).resolve()
                if path != primary:
                    files.append(path)
    ordered = [primary, *sorted(files[1:])]
    body = "\n".join(str(path) for path in ordered[:limit])
    if len(ordered) > limit or inspected > _MAX_SCAN:
        body += "\n[partial results; narrow the module or limit]"
    return _bounded(f"Source files for {name or module}:\n{body}")


def _skill_source(module: str, entries: list | None = None) -> tuple[str, str]:
    """Locate a registered pyskill's Python source without loading its module."""
    requested = _text(module, "module", 200)
    for entry in entries if entries is not None else entry_points(group="pyskills"):
        target = entry.value.split(":", 1)[0]
        if requested not in (entry.name, target):
            continue
        if not _MODULE.fullmatch(target):
            raise ValueError(f"Registered skill module path is invalid: {requested}")
        base = Path(*target.split("."))
        candidates = (base.with_suffix(".py"), base / "__init__.py")
        files = {str(path) for path in (entry.dist.files or ())}
        for candidate in candidates:
            paths = ([Path(entry.dist.locate_file(str(candidate)))] if str(candidate) in files else [])
            paths.extend(Path(root) / candidate for root in sys.path if isinstance(root, str) and root)
            for path in paths:
                if not path.is_file():
                    continue
                with path.open("rb") as stream:
                    raw = stream.read(_MAX_SOURCE_BYTES + 1)
                if len(raw) > _MAX_SOURCE_BYTES:
                    raise ValueError("Skill source exceeds the 1 MB inspection limit")
                return target, raw.decode("utf-8")
        raise ValueError(f"Registered skill source is unavailable: {requested}")
    raise ValueError(f"No installed pyskill entry point matches {requested}")


def list_skills(
    query: str = "",  # Optional entry-point or description filter.
    limit: int = 30,  # Maximum installed skill descriptions to show.
) -> str:
    """List installed pyskill entry points and static module descriptions."""
    if not isinstance(query, str) or len(query) > 200:
        raise ValueError("query must be text of at most 200 characters")
    limit = _limit(limit, 100)
    found: list[str] = []
    entries = sorted(entry_points(group="pyskills"), key=lambda entry: entry.name)
    for entry in entries[:_MAX_SCAN]:
        try:
            target, source = _skill_source(entry.name, entries)
            description = (ast.get_docstring(ast.parse(source)) or "").split("\n\n", 1)[0]
        except (ValueError, OSError, SyntaxError, UnicodeError):
            target, description = entry.value, "[description unavailable]"
        line = f"{entry.name} ({target}): {description[:220]}"
        if query.casefold() in line.casefold():
            found.append(line)
    body = "\n".join(found[:limit]) or "[no installed skills matched]"
    if len(found) > limit or len(entries) > _MAX_SCAN:
        body += "\n[partial results; narrow the query]"
    return _bounded(f"Installed pyskill entry points:\n{body}")


def read_skill(module: str) -> str:  # Registered skill entry-point name or module.
    """Read a registered pyskill's static module instructions without importing it."""
    target, source = _skill_source(module)
    instructions = ast.get_docstring(ast.parse(source)) or "[no module instructions]"
    return _bounded(f"Pyskill {target}:\n{instructions}")


def trace_function(
    name: str,  # Live synchronous Python function to execute once.
    args_json: str = "[]",  # Positional arguments as a JSON array.
    kwargs_json: str = "{}",  # Keyword arguments as a JSON object.
    max_events: int = 40,  # Maximum trace events to record.
) -> str:
    """Call a live Python function once and show a bounded execution trace.

    The function really runs, so its state changes and external effects occur once.
    """
    max_events = _limit(max_events, 100)
    args = json.loads(_text(args_json, "args_json", 8_000))
    kwargs = json.loads(_text(kwargs_json, "kwargs_json", 8_000))
    if not isinstance(args, list) or not isinstance(kwargs, dict) or any(
        not isinstance(key, str) for key in kwargs
    ):
        raise ValueError("args_json must be an array and kwargs_json an object")
    value = _resolve_python_name(name)
    if (inspect.iscoroutinefunction(value) or inspect.isgeneratorfunction(value)
            or inspect.isasyncgenfunction(value)):
        raise ValueError("trace_function requires a synchronous Python function")
    if not (inspect.isfunction(value) or inspect.ismethod(value)):
        raise ValueError("trace_function requires a live Python function or method")
    inspect.signature(value).bind(*args, **kwargs)
    code = value.__func__.__code__ if inspect.ismethod(value) else value.__code__
    events: list[str] = []
    prior = sys.gettrace()

    def record(frame: Any, event: str, arg: Any) -> Any:
        if frame.f_code is not code or len(events) >= max_events:
            return None
        if event in ("call", "line", "return", "exception"):
            source = linecache.getline(frame.f_code.co_filename, frame.f_lineno).strip()[:120]
            locals_text = ", ".join(
                f"{key}={_preview(item)}" for key, item in islice(frame.f_locals.items(), 6)
                if isinstance(key, str) and not key.startswith("_")
            )
            events.append(f"{event} {frame.f_code.co_name}:{frame.f_lineno} {source}"
                          + (f" | {locals_text}" if locals_text else ""))
        return record

    try:
        sys.settrace(record)
        try:
            result = value(*args, **kwargs)
            outcome = f"return {_preview(result)}"
        except Exception as exc:  # noqa: BLE001 - report the called user's failure in the trace.
            outcome = f"raised {type(exc).__name__}: {str(exc)[:200]}"
    finally:
        sys.settrace(prior)
    body = "\n".join(events) or "[no Python line events]"
    if len(events) >= max_events:
        body += "\n[trace event limit reached]"
    return _bounded(f"Executed {name} once; effects are retained. {outcome}\n{body}")


INSPECTION_TOOL_FUNCTIONS = MappingProxyType({
    name: globals()[name] for name in (
        "api_names", "search_docs", "inspect_value", "search_value", "source_files",
        "list_skills", "read_skill", "trace_function",
    )
})

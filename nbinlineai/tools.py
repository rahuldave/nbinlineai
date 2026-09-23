"""Opt-in kernel and notebook tools for AI prompt cells.

File tools inspect saved .ipynb files relative to the kernel working directory.
Live cell tools are dispatched by the JupyterLab extension; their Python stubs
are intentionally not callable directly.
"""

import builtins
import inspect
import json
import os
import re
from collections.abc import Callable, Mapping
from inspect import getdoc
from itertools import islice
from pathlib import Path
from types import MappingProxyType
from typing import Any

from .kernel_insert_tools import InsertToolsReceipt, request_insert_tools
from .web_tools import fetch_url_markdown

MAX_NOTEBOOK_BYTES = 8_000_000
MAX_RESULT_CHARS = 3_200  # The kernel bridge returns at most 4,000 characters.
MAX_REPR_CHARS = 3_900  # Its result is repr(text), which may escape every character.
MAX_VISITED_ENTRIES = 2_000
MAX_DIRECTORY_DEPTH = 6
SKIP_DIRECTORIES = {".git", ".venv", "venv", "node_modules", "__pycache__"}
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


def _cells(
    path: str,  # Saved notebook path, relative to kernel cwd or absolute.
) -> list[dict[str, Any]]:  # Parsed saved cells.
    """Read a size-bounded saved notebook without using its outputs."""
    file = Path(_text(path, "path")).expanduser()
    if file.suffix.lower() != ".ipynb":
        raise ValueError("path must name a saved .ipynb file")
    try:
        if file.stat().st_size > MAX_NOTEBOOK_BYTES:
            raise ValueError("Saved notebook is too large to inspect (8 MB limit)")
        with file.open("rb") as stream:
            raw = stream.read(MAX_NOTEBOOK_BYTES + 1)
        if len(raw) > MAX_NOTEBOOK_BYTES:
            raise ValueError("Saved notebook is too large to inspect (8 MB limit)")
        notebook = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Could not read saved notebook file") from exc
    if not isinstance(notebook, dict) or not isinstance(notebook.get("cells"), list):
        raise TypeError("Saved notebook has no valid cells list")
    cells = notebook["cells"]
    if any(not isinstance(cell, dict) for cell in cells):
        raise ValueError("Saved notebook contains an invalid cell")
    return cells


def _source(
    cell: dict[str, Any],  # Saved notebook cell.
) -> str:  # Plain cell source.
    """Normalize nbformat string or list-of-lines source."""
    source = cell.get("source", "")
    if isinstance(source, str):
        return source
    if isinstance(source, list) and all(isinstance(line, str) for line in source):
        return "".join(source)
    raise ValueError("Saved notebook contains invalid cell source")


def _reference(
    cell: dict[str, Any],  # Saved notebook cell.
    index: int,  # Zero-based saved cell position.
) -> str:  # ID plus deterministic positional fallback.
    """Show a position that works when a cell ID is absent or duplicated."""
    cell_id = cell.get("id")
    return f"index:{index}" + (f" id:{cell_id}" if isinstance(cell_id, str) and cell_id else "")


def search_kernel_names(
    query: str,  # Literal fragment in a live kernel name.
    limit: int = 20,  # Maximum names, from 1 through 50.
) -> str:  # Matching names and types, with no value reprs.
    """Find live Python kernel names containing a literal query, with types only."""
    needle = _text(query, "query", 100).casefold()
    limit = _limit(limit, 50)
    from IPython import get_ipython  # Lazy import; file tools work outside a kernel.

    shell = get_ipython()
    if shell is None or not hasattr(shell, "user_ns"):
        raise RuntimeError("search_kernel_names requires an active IPython kernel")
    matches = [(name, type(value).__name__) for name, value in shell.user_ns.items()
               if isinstance(name, str) and not name.startswith("_") and needle in name.casefold()]
    matches.sort(key=lambda pair: pair[0].casefold())
    if not matches:
        return "No matching live kernel names."
    lines = [f"{name} ({kind})" for name, kind in matches[:limit]]
    if len(matches) > limit:
        lines.append(f"[{len(matches) - limit} more names; narrow query or raise limit]")
    return _bounded("\n".join(lines))


def list_notebooks(
    path: str = ".",  # Directory relative to kernel cwd, or absolute.
    limit: int = 30,  # Maximum paths, from 1 through 100.
) -> str:  # Saved notebook paths, not content.
    """List saved .ipynb paths, skipping hidden and environment directories."""
    root = Path(_text(path, "path")).expanduser()
    limit = _limit(limit, 100)
    if not root.is_dir():
        raise ValueError("path must name an existing directory")
    found: list[str] = []
    stack = [(root, 0)]
    visited = 0
    stopped = False
    omitted_by_depth = False
    while stack:
        directory, depth = stack.pop()
        try:
            remaining = MAX_VISITED_ENTRIES - visited
            with os.scandir(directory) as listing:
                entries = list(islice(listing, remaining + 1))
            if len(entries) > remaining:
                stopped = True
                entries.pop()
            entries.sort(key=lambda entry: entry.name.casefold())
        except OSError as exc:
            raise ValueError("Could not list notebook directory") from exc
        children = []
        for entry in entries:
            visited += 1
            if visited > MAX_VISITED_ENTRIES:
                stopped = True
                break
            if entry.is_symlink() or entry.name.startswith("."):
                continue
            if entry.is_dir(follow_symlinks=False):
                if depth < MAX_DIRECTORY_DEPTH and entry.name not in SKIP_DIRECTORIES:
                    children.append(Path(entry.path))
                elif entry.name not in SKIP_DIRECTORIES:
                    omitted_by_depth = True
            elif entry.is_file(follow_symlinks=False) and entry.name.lower().endswith(".ipynb"):
                found.append(str(root / Path(entry.path).relative_to(root)))
                if len(found) > limit:
                    stopped = True
                    break
        if stopped:
            break
        stack.extend((child, depth + 1) for child in reversed(children))
    if not found:
        return "No saved notebooks found within the traversal limit."
    lines = found[:limit]
    if stopped or stack or omitted_by_depth:
        lines.append("[more notebooks may exist; narrow path or raise limit]")
    return _bounded("\n".join(lines))


def find_notebook_cells(
    path: str,  # Saved .ipynb path relative to kernel cwd, or absolute.
    query: str,  # Case-insensitive literal source fragment.
    limit: int = 10,  # Maximum matching cells, from 1 through 50.
) -> str:  # Matching cell references and short source snippets.
    """Find saved notebook cells by case-insensitive literal source text."""
    cells = _cells(path)
    needle = _text(query, "query", 200)
    limit = _limit(limit, 50)
    matches = []
    for index, cell in enumerate(cells):
        source = _source(cell)
        match = re.search(re.escape(needle), source, re.IGNORECASE)
        if match is None:
            continue
        snippet = " ".join(source[max(0, match.start() - 50):match.end() + 90].split())[:180]
        matches.append(f"- {_reference(cell, index)} ({cell.get('cell_type', 'unknown')}): {snippet}")
    if not matches:
        return "No matching source in saved notebook. Unsaved edits are not searched."
    lines = [f"Saved source matches in {path}:", *matches[:limit]]
    if len(matches) > limit:
        lines.append(f"[{len(matches) - limit} more matching cells; narrow query or raise limit]")
    return _bounded("\n".join(lines))


def read_notebook_cell(
    path: str,  # Saved .ipynb path relative to kernel cwd, or absolute.
    cell_id: str,  # Exact ID, or index:N for a zero-based fallback.
    start_line: int = 1,  # First one-based source line, inclusive.
    end_line: int = 40,  # Last one-based source line, inclusive.
) -> str:  # Numbered saved source excerpt.
    """Read numbered saved cell source by ID or zero-based index:N fallback."""
    cells = _cells(path)
    reference = _text(cell_id, "cell_id", 200)
    if reference.startswith("index:"):
        number = reference.removeprefix("index:")
        if not number.isdecimal():
            raise ValueError("cell_id index fallback must be index:N with zero-based N")
        index = int(number)
        if index >= len(cells):
            raise ValueError("Saved notebook cell index is out of range")
    else:
        matches = [i for i, cell in enumerate(cells) if cell.get("id") == reference]
        if not matches:
            raise ValueError("Cell ID is absent from the saved notebook; try index:N")
        if len(matches) > 1:
            raise ValueError("Cell ID is duplicated in the saved notebook; use index:N")
        index = matches[0]
    if (isinstance(start_line, bool) or isinstance(end_line, bool)
            or not isinstance(start_line, int) or not isinstance(end_line, int)
            or start_line < 1 or end_line < start_line or end_line - start_line >= 80):
        raise ValueError("Line range must be one-based, ordered, and at most 80 lines")
    cell = cells[index]
    lines = _source(cell).splitlines()
    header = f"Saved source from {path}, {_reference(cell, index)} ({cell.get('cell_type', 'unknown')}):"
    if not lines:
        return _bounded(header + "\n[empty saved cell source]")
    if start_line > len(lines):
        raise ValueError(f"Cell has {len(lines)} source lines; start_line is beyond the end")
    excerpt = [f"{number}: {lines[number - 1]}"
               for number in range(start_line, min(end_line, len(lines)) + 1)]
    if end_line < len(lines):
        excerpt.append(f"[{len(lines) - end_line} later lines; request the next range]")
    return _bounded("\n".join([header, *excerpt]), "\n[truncated; request a narrower line range]")


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


def inspect_python(
    name: str,  # Explicit public name in the live kernel or builtins.
    section: str = "help",  # help, signature, or source.
) -> str:  # Bounded documentation, signature, or source excerpt.
    """Inspect a live Python name's help, signature, or available source."""
    value = _resolve_python_name(name)
    if section not in ("help", "signature", "source"):
        raise ValueError("section must be help, signature, or source")
    try:
        signature = str(inspect.signature(value))
    except (TypeError, ValueError):
        signature = "[signature unavailable]"
    if section == "signature":
        return _bounded(f"{name}{signature}")
    if section == "source":
        try:
            source = inspect.getsource(value)
        except (OSError, TypeError):
            source = "[source unavailable for this Python object]"
        return _bounded(f"Source for {name}:\n{source}")
    documentation = inspect.getdoc(value) or "[no docstring available]"
    module = getattr(value, "__module__", type(value).__module__)
    return _bounded(f"{name}{signature} (module {module})\n\n{documentation}")


def read_url(
    url: str,  # Public HTTP(S) documentation page.
) -> str:  # Short source-attributed Markdown excerpt.
    """Read a public web page as bounded, sanitized Markdown with its source URL."""
    return _bounded(fetch_url_markdown(url), "\n[truncated; use url_to_note for a longer excerpt]")


def _requires_ai_prompt(
    name: str,  # Special tool called directly from Python.
) -> str:  # Never returns during a direct Python call.
    """Explain why browser-backed functions are not ordinary Python APIs."""
    raise RuntimeError(
        f"{name} runs only through an &`{name}` reference in an AI Prompt cell; "
        "the live JupyterLab notebook dispatches it."
    )


def list_cells(
    start: int = 0,  # First zero-based live notebook cell.
    limit: int = 20,  # Maximum cells to summarize.
) -> str:  # Live notebook cell IDs, types, and brief source previews.
    """List live notebook cells, including unsaved edits, by ID and position."""
    return _requires_ai_prompt("list_cells")


def read_cell(
    cell_id: str,  # Live cell ID returned by list_cells.
    start_line: int = 1,  # First one-based source line, inclusive.
    end_line: int = 40,  # Last one-based source line, inclusive.
) -> str:  # Bounded numbered live cell source excerpt.
    """Read live notebook cell source, including unsaved edits, by cell ID."""
    return _requires_ai_prompt("read_cell")


def insert_markdown(
    content: str,  # Markdown source to insert as a new notebook cell.
    after_cell_id: str = "",  # Optional live cell ID to insert after.
) -> str:  # Confirmation of the requested notebook insertion.
    """Insert a Markdown note into the current live notebook after a cell."""
    return _requires_ai_prompt("insert_markdown")


def insert_code(
    content: str,  # Python source to insert as a new unexecuted code cell.
    after_cell_id: str = "",  # Optional live cell ID to insert after.
) -> str:  # Confirmation only after the browser inserts the cell.
    """Insert an unexecuted code cell below the AI answer, or after a chosen cell."""
    return _requires_ai_prompt("insert_code")


def url_to_note(
    url: str,  # Public HTTP(S) page to summarize as source-attributed Markdown.
    after_cell_id: str = "",  # Optional live cell ID to insert after.
) -> str:  # Confirmation of the requested notebook insertion.
    """Fetch a public page and insert its bounded Markdown as a notebook note."""
    return _requires_ai_prompt("url_to_note")


SPECIAL_TOOL_FUNCTIONS: Mapping[str, Callable[..., str]] = MappingProxyType({
    "list_cells": list_cells,
    "read_cell": read_cell,
    "insert_markdown": insert_markdown,
    "insert_code": insert_code,
    "url_to_note": url_to_note,
})


# Only these approved functions are advertised; helpers never appear as tools.
TOOL_FUNCTIONS: Mapping[str, Callable[..., str]] = MappingProxyType({
    "search_kernel_names": search_kernel_names,
    "list_notebooks": list_notebooks,
    "find_notebook_cells": find_notebook_cells,
    "read_notebook_cell": read_notebook_cell,
    "inspect_python": inspect_python,
    "read_url": read_url,
    **SPECIAL_TOOL_FUNCTIONS,
})


def tools_markdown(
    names: list[str] | None = None,  # Selected registered/custom names, or all known names.
    custom: Mapping[str, Callable[..., Any]] | None = None,  # Explicit custom alias-to-callable map.
) -> str:  # Markdown with one removable reference per tool.
    """Print chosen built-in/custom references; this does not register a tool."""
    aliases = {} if custom is None else custom
    if not isinstance(aliases, Mapping):
        raise TypeError("custom must map public Python names to callables")
    for alias, function in aliases.items():
        if (not isinstance(alias, str) or PUBLIC_NAME.fullmatch(alias) is None
                or alias in TOOL_FUNCTIONS or not callable(function)):
            raise ValueError("custom aliases must be distinct public names bound to callables")
    available = {**TOOL_FUNCTIONS, **aliases}
    selected = list(available) if names is None else names
    if not isinstance(selected, list) or any(not isinstance(name, str) for name in selected):
        raise TypeError("names must be a list of registered tool names or None")
    if len(selected) != len(set(selected)):
        raise ValueError("Tool names must not be repeated")
    unknown = [name for name in selected if name not in available]
    if unknown:
        raise ValueError(f"Unknown built-in tool: {unknown[0]}")
    if not selected:
        return "No built-in tools selected."
    lines = ["Available tools (delete any line you do not want to offer):"]
    for name in selected:
        summary = " ".join((getdoc(available[name]) or "Call this tool.").splitlines()[0].split())[:180]
        lines.append(f"- &`{name}` — {summary}")
    return "\n".join(lines)


def insert_tools(
    names: list[str] | None = None,  # Selected registered/custom names, or all known names.
    custom: Mapping[str, Callable[..., Any]] | None = None,  # Explicit custom aliases.
) -> "InsertToolsReceipt":  # Asynchronous status of the new Markdown cell.
    """Request a Markdown tool-reference cell immediately below this code cell.

    The nbinlineai JupyterLab extension inserts into the live notebook model.
    The returned receipt starts as requested and later says inserted or error;
    save the notebook after the new cell appears. No model or API key is used.
    """
    markdown = tools_markdown(names, custom)
    if markdown == "No built-in tools selected.":
        raise ValueError("Choose at least one tool to insert")
    return request_insert_tools(markdown)

"""Bounded, opt-in filesystem and Python documentation tools for a live kernel."""

import importlib
import inspect
import os
import re
import stat
import tempfile
from fnmatch import fnmatch
from itertools import islice
from pathlib import Path
from types import MappingProxyType, ModuleType
from typing import Any, Self

from fastcore.docments import MarkdownRenderer
from fastcore.tools import replace_lines, str_replace
from fastcore.xtras import str_diff

from ._tool_helpers import (
    MAX_REPR_CHARS,
    MAX_RESULT_CHARS,
    _bounded,
    _limit,
    _resolve_python_name,
    _text,
)

MAX_FILE_BYTES = 1_000_000
MAX_NEW_CHARS = 8_000
MAX_VIEW_LINES = 80
MAX_VISITED = 2_000
MAX_DEPTH = 6
SKIP_FOLDERS = {".git", ".venv", "venv", "env", "node_modules", "__pycache__"}
MODULE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$")


class _DocText(str):
    """Plain tool result with a richer display for direct notebook calls."""

    def __new__(cls, value: str, markdown: str) -> Self:
        result = super().__new__(cls, value)
        result.markdown = markdown
        return result

    def _repr_markdown_(self) -> str:
        return self.markdown


def _path(path: str) -> Path:
    return Path(_text(path, "path")).expanduser().resolve()


def _editable_path(path: str) -> Path:
    requested = Path(_text(path, "path")).expanduser()
    target = requested.resolve()
    if requested.suffix.lower() == ".ipynb" or target.suffix.lower() == ".ipynb":
        raise ValueError("Edit the open notebook through JupyterLab, not its .ipynb file")
    return target


def _read_file(path: Path) -> tuple[str, os.stat_result]:
    try:
        before = path.stat()
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f"Not a regular file: {path}")
        if before.st_size > MAX_FILE_BYTES:
            raise ValueError("File exceeds the 1 MB text limit")
        with path.open("rb") as stream:
            raw = stream.read(MAX_FILE_BYTES + 1)
        if len(raw) > MAX_FILE_BYTES:
            raise ValueError("File exceeds the 1 MB text limit")
        if b"\x00" in raw:
            raise ValueError("File contains NUL bytes and is not plain text")
        return raw.decode("utf-8"), before
    except UnicodeDecodeError as exc:
        raise ValueError("File is not UTF-8 text") from exc


def _write_changed(path: Path, original: str, before: os.stat_result, changed: str) -> str:
    encoded = changed.encode("utf-8")
    if len(encoded) > MAX_FILE_BYTES:
        raise ValueError("Result exceeds the 1 MB text limit")
    if changed == original:
        return _bounded(f"No change: {path}")
    current = path.stat()
    if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) != (
        before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns
    ):
        raise ValueError("File changed since it was read; inspect it and retry")
    staged: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, delete=False) as stream:
            staged = Path(stream.name)
            stream.write(encoded)
        os.chmod(staged, stat.S_IMODE(before.st_mode))
        os.replace(staged, path)
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)
    diff = str_diff(original, changed, n=1)
    return _bounded(f"Updated: {path}\n{diff}", "\n[diff truncated; view the file]")


def _new_content(value: str, label: str) -> str:
    if not isinstance(value, str) or len(value) > MAX_NEW_CHARS:
        raise ValueError(f"{label} must be text of at most {MAX_NEW_CHARS} characters")
    if "\x00" in value:
        raise ValueError(f"{label} must not contain NUL bytes")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError(f"{label} must be valid UTF-8 text") from exc
    return value


def path_info(path: str = ".") -> str:
    """Show the kernel working directory and a path's resolved type and size."""
    target = _path(path)
    cwd = Path.cwd().resolve()
    try:
        info = target.stat()
    except FileNotFoundError:
        kind, size = "missing", "unknown"
    else:
        kind = "file" if stat.S_ISREG(info.st_mode) else "directory" if stat.S_ISDIR(info.st_mode) else "other"
        size = f"{info.st_size} bytes" if kind == "file" else "not applicable"
    return _bounded(f"Kernel cwd: {cwd}\nResolved path: {target}\nType: {kind}\nSize: {size}")


def list_files(path: str = ".", pattern: str = "*", recursive: bool = False, limit: int = 30) -> str:
    """List visible file and directory paths, optionally matching a name pattern."""
    root = _path(path)
    pattern = _text(pattern, "pattern", 200)
    limit = _limit(limit, 100)
    if not isinstance(recursive, bool):
        raise TypeError("recursive must be true or false")
    if not root.is_dir():
        raise ValueError(f"Not a directory: {root}")
    visited = 0
    results: list[str] = []
    partial = False
    stack = [(root, 1)]
    while stack:
        directory, depth = stack.pop()
        remaining = MAX_VISITED - visited
        if remaining <= 0:
            partial = True
            break
        try:
            with os.scandir(directory) as listing:
                entries = list(islice(listing, remaining + 1))
            if len(entries) > remaining:
                entries.pop()
                partial = True
            entries.sort(key=lambda entry: entry.name.casefold())
        except OSError as exc:
            raise ValueError(f"Could not list directory: {directory}") from exc
        children: list[Path] = []
        for entry in entries:
            visited += 1
            if entry.name.startswith(".") or entry.name in SKIP_FOLDERS or entry.is_symlink():
                continue
            is_directory = entry.is_dir(follow_symlinks=False)
            if is_directory and recursive:
                if depth < MAX_DEPTH:
                    children.append(Path(entry.path))
                else:
                    partial = True
            if not (is_directory or entry.is_file(follow_symlinks=False)):
                continue
            if fnmatch(entry.name, pattern):
                if len(results) == limit:
                    partial = True
                    break
                results.append(str(Path(entry.path).relative_to(root)) + ("/" if is_directory else ""))
        if len(results) == limit and partial:
            break
        if visited >= MAX_VISITED:
            partial = partial or bool(children or stack)
            break
        stack.extend((child, depth + 1) for child in reversed(children))
    body = "\n".join(results) if results else "[no matches]"
    if partial:
        body += "\n[partial results; narrow the path or pattern]"
    return _bounded(f"Files under {root}:\n{body}")


def view_file(path: str, start_line: int = 1, end_line: int = 40) -> str:
    """Read a bounded range of one UTF-8 text file with one-based line numbers."""
    target = _path(path)
    content, _ = _read_file(target)
    lines = content.splitlines()
    if isinstance(start_line, bool) or not isinstance(start_line, int) or start_line < 1:
        raise ValueError("start_line must be a positive integer")
    if isinstance(end_line, bool) or not isinstance(end_line, int) or end_line < start_line:
        raise ValueError("end_line must be at least start_line")
    if end_line - start_line + 1 > MAX_VIEW_LINES:
        raise ValueError("View at most 80 lines at once")
    if lines and start_line > len(lines):
        raise ValueError(f"File has {len(lines)} lines; start_line is beyond the end")
    excerpt = [f"{index}: {lines[index - 1]}" for index in range(start_line, min(end_line, len(lines)) + 1)]
    if not lines:
        excerpt = ["[empty file]"]
    elif end_line < len(lines):
        excerpt.append(f"[{len(lines) - end_line} later lines; request the next range]")
    return _bounded(f"File: {target}\n" + "\n".join(excerpt), "\n[truncated; request fewer lines]")


def create_file(path: str, contents: str) -> str:
    """Create a new UTF-8 text file without replacing an existing path."""
    requested = Path(_text(path, "path")).expanduser()
    target = _editable_path(path)
    if os.path.lexists(requested):
        raise ValueError(f"File already exists: {requested.absolute()}")
    contents = _new_content(contents, "contents")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
    except FileExistsError as exc:
        raise ValueError(f"File already exists: {target}") from exc
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(contents.encode("utf-8"))
    return _bounded(f"Created: {target} ({len(contents.encode('utf-8'))} bytes)")


def file_str_replace(path: str, old_str: str, new_str: str, expected_matches: int = 1) -> str:
    """Replace an exact literal only when its occurrence count matches expectation."""
    target = _editable_path(path)
    old_str = _new_content(old_str, "old_str")
    new_str = _new_content(new_str, "new_str")
    if not old_str:
        raise ValueError("old_str must not be empty")
    expected_matches = _limit(expected_matches, 100)
    original, before = _read_file(target)
    actual = original.count(old_str)
    if actual != expected_matches:
        raise ValueError(f"Expected {expected_matches} matches; found {actual}. No change made")
    return _write_changed(target, original, before, str_replace(original, old_str, new_str))


def file_insert_line(path: str, line: int, new_str: str) -> str:
    """Insert text after a one-based line; line 0 inserts before the first line."""
    target = _editable_path(path)
    new_str = _new_content(new_str, "new_str")
    if not new_str:
        raise ValueError("new_str must not be empty")
    original, before = _read_file(target)
    count = len(original.splitlines())
    if isinstance(line, bool) or not isinstance(line, int) or not 0 <= line <= count:
        raise ValueError(f"line must be an integer from 0 to {count}")
    lines = original.splitlines(keepends=True)
    separator = "\r\n" if "\r\n" in original else "\r" if "\r" in original else "\n"
    prefix, suffix = "".join(lines[:line]), "".join(lines[line:])
    inserted = new_str
    if prefix and not prefix.endswith(("\n", "\r")):
        inserted = separator + inserted
    if (suffix or original.endswith(("\n", "\r"))) and not inserted.endswith(("\n", "\r")):
        inserted += separator
    changed = prefix + inserted + suffix
    return _write_changed(target, original, before, changed)


def file_replace_lines(path: str, start_line: int, end_line: int, new_content: str) -> str:
    """Replace an explicit inclusive, one-based line range with UTF-8 text."""
    target = _editable_path(path)
    new_content = _new_content(new_content, "new_content")
    original, before = _read_file(target)
    count = len(original.splitlines())
    if (isinstance(start_line, bool) or not isinstance(start_line, int)
            or isinstance(end_line, bool) or not isinstance(end_line, int)
            or not 1 <= start_line <= end_line <= count):
        raise ValueError(f"Line range must be within 1-{count}, start through end")
    separator = "\r\n" if "\r\n" in original else "\r" if "\r" in original else "\n"
    replacement = new_content.replace("\r\n", "\n").replace("\r", "\n")
    explicit_final_newline = replacement.endswith("\n")
    replacement = replacement.replace("\n", separator)
    if replacement and not replacement.endswith(separator):
        replacement += separator
    working_original = original.replace("\r", "\n") if separator == "\r" else original
    working_replacement = replacement.replace("\r", "\n") if separator == "\r" else replacement
    changed = replace_lines(working_original, start_line, end_line, working_replacement)
    if separator == "\r":
        changed = changed.replace("\n", "\r")
    if (replacement and end_line == count and not original.endswith(("\n", "\r"))
            and not explicit_final_newline):
        changed = changed[:-len(separator)]
    return _write_changed(target, original, before, changed)


def _module_symbol(module: ModuleType, name: str) -> Any:
    if not name or name == module.__name__:
        return module
    parts = name.split(".")
    if any(not MODULE_NAME.fullmatch(part) for part in parts):
        raise ValueError("name must be a public Python identifier or dotted path")
    if parts[:len(module.__name__.split("."))] == module.__name__.split("."):
        parts = parts[len(module.__name__.split(".")):]
    value: Any = module
    for part in parts:
        if part.startswith("_"):
            raise ValueError("Only public Python attributes may be inspected")
        try:
            value = inspect.getattr_static(value, part)
        except AttributeError as exc:
            raise ValueError(f"Python attribute {part} is not present in {module.__name__}") from exc
    return value


def _bounded_markdown(value: str) -> str:
    """Fit a Markdown result while closing a fence cut by truncation."""
    if len(value) <= MAX_RESULT_CHARS and len(repr(value)) <= MAX_REPR_CHARS:
        return value
    notice = "\n[truncated; narrow the request]"
    largest_footer = "\n```" + notice
    low, high = 0, min(len(value), MAX_RESULT_CHARS)
    while low < high:
        middle = (low + high + 1) // 2
        candidate = value[:middle] + largest_footer
        if len(candidate) <= MAX_RESULT_CHARS and len(repr(candidate)) <= MAX_REPR_CHARS:
            low = middle
        else:
            high = middle - 1
    prefix = value[:low].rstrip("`")
    footer = ("\n```" if prefix.count("```") % 2 else "") + notice
    return prefix + footer


def show_doc(name: str, module: str = "") -> str:
    """Show docs for a live name, or import `module` and inspect its public name.

    An explicit module import runs that module's initialization. Use name="" with
    module to show the module's own docs; this never calls the named symbol.
    """
    if not isinstance(name, str) or len(name) > 200:
        raise ValueError("name must be a public Python identifier or dotted path")
    if not isinstance(module, str) or len(module) > 200:
        raise ValueError("module must be a public dotted Python module name")
    if (not name and not module) or (name and not MODULE_NAME.fullmatch(name)):
        raise ValueError("name must be a public Python identifier or dotted path")
    if module:
        if not MODULE_NAME.fullmatch(module):
            raise ValueError("module must be a public dotted Python module name")
        try:
            imported = importlib.import_module(module)
        except (ImportError, ModuleNotFoundError) as exc:
            raise ValueError(f"Module is not installed or could not be imported: {module}") from exc
        value = _module_symbol(imported, name)
        label = name or module
    else:
        value = _resolve_python_name(name)
        label = name
    if isinstance(value, ModuleType):
        public = [item for item in vars(value) if item and not item.startswith("_")]
        outline = ", ".join(sorted(public)[:80])
        if len(public) > 80:
            outline += ", …"
        markdown = f"### {value.__name__}\n\n{inspect.getdoc(value) or '[no module docstring]'}\n\nPublic names: {outline or '[none]'}"
    else:
        try:
            rendered = MarkdownRenderer(value, name=label)
            markdown = f"### {label}\n\n{rendered._repr_markdown_()}"
        except (TypeError, ValueError, AttributeError, NameError):
            signature = ""
            try:
                signature = str(inspect.signature(value, eval_str=False))
            except (TypeError, ValueError):
                pass
            markdown = (f"### {label}\n\n```python\n{label}{signature}\n```\n\n"
                        f"{inspect.getdoc(value) or '[no docstring available]'}")
    bounded = _bounded_markdown(markdown)
    return _DocText(bounded, bounded)


FASTCORE_TOOL_FUNCTIONS = MappingProxyType({
    name: globals()[name] for name in (
        "path_info", "list_files", "view_file", "create_file", "file_str_replace",
        "file_insert_line", "file_replace_lines", "show_doc",
    )
})

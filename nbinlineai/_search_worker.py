"""One-shot saved-source scanner for :mod:`nbinlineai._search`."""

from __future__ import annotations

import fnmatch
import json
import os
import re
import stat
import sys
from itertools import islice
from pathlib import Path

from pathspec import GitIgnoreSpec

MAX_VISITED = 2_000
MAX_DEPTH = 6
MAX_FILE_BYTES = 1_000_000
IGNORE_FILES = (".gitignore", ".ignore", ".rgignore")
SKIP_DIRS = {"node_modules", "__pycache__", "venv", "env"}


def _emit(kind: str, **fields: object) -> None:
    print(json.dumps({"type": kind, **fields}, ensure_ascii=True), flush=True)


def _specs(directory: Path, reasons: set[str]) -> list[GitIgnoreSpec]:
    result = []
    for name in IGNORE_FILES:
        file = directory / name
        try:
            info = file.lstat()
            if not stat.S_ISREG(info.st_mode):
                continue
            if info.st_size > MAX_FILE_BYTES:
                reasons.add("oversized ignore file")
                continue
            with file.open("rb") as handle:
                content = handle.read(MAX_FILE_BYTES + 1)
            if len(content) > MAX_FILE_BYTES:
                reasons.add("oversized ignore file")
                continue
            lines = content.decode("utf-8").splitlines()
            result.append(GitIgnoreSpec.from_lines(lines, backend="simple"))
        except FileNotFoundError:
            pass
        except (OSError, UnicodeError):
            reasons.add("unreadable ignore file")
    return result


def _ignored(relative: str, specs: list[tuple[Path, GitIgnoreSpec]], root: Path,
             is_dir: bool) -> bool:
    ignored = False
    target = root / relative
    for base, spec in specs:
        try:
            subpath = target.relative_to(base).as_posix()
        except ValueError:
            continue
        # Each nested ignore file overrides matching decisions from its parents.
        if is_dir:
            subpath += "/"
        for rule in spec.patterns:
            if rule.include is not None and rule.match_file(subpath) is not None:
                ignored = rule.include
    return ignored


def _files(root: Path, reasons: set[str]):
    """Walk saved files under the caller's selected root; this is not a sandbox."""
    if root.is_symlink():
        raise ValueError("Search path cannot be a symlink")
    if root.is_file():
        yield root
        return
    if not root.is_dir():
        raise ValueError(f"Path is not a file or directory: {root}")
    # Sorted within each directory, DFS with sorted directories, for stable output.
    stack = [(root, 0, [])]
    visited = 0
    while stack:
        directory, depth, inherited = stack.pop()
        local = inherited + [(directory, s) for s in _specs(directory, reasons)]
        remaining = MAX_VISITED - visited
        if remaining <= 0:
            reasons.add("visit limit")
            break
        try:
            with os.scandir(directory) as scan:
                entries = list(islice(scan, remaining + 1))
        except OSError:
            reasons.add("unreadable directory")
            continue
        if len(entries) > remaining:
            entries = entries[:remaining]
            reasons.add("visit limit")
        entries.sort(key=lambda entry: entry.name)
        dirs = []
        for entry in entries:
            visited += 1
            if entry.name.startswith(".") or entry.name in SKIP_DIRS:
                continue
            try:
                if entry.is_symlink():
                    continue
                is_dir = entry.is_dir(follow_symlinks=False)
                is_file = entry.is_file(follow_symlinks=False)
            except OSError:
                reasons.add("unreadable entry")
                continue
            if not (is_dir or is_file):
                continue
            rel = Path(entry.path).relative_to(root).as_posix()
            if _ignored(rel, local, root, is_dir):
                continue
            if is_dir:
                if depth < MAX_DEPTH:
                    dirs.append((Path(entry.path), depth + 1, local))
                else:
                    reasons.add("depth limit")
            else:
                yield Path(entry.path)
        stack.extend(reversed(dirs))


def _read(file: Path, reasons: set[str]) -> str | None:
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        fd = os.open(file, flags)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                reasons.add("special file")
                return None
            data = os.read(fd, MAX_FILE_BYTES + 1)
        finally:
            os.close(fd)
    except OSError:
        reasons.add("unreadable file")
        return None
    if len(data) > MAX_FILE_BYTES:
        reasons.add("oversized file")
        return None
    if b"\0" in data:
        reasons.add("binary file")
        return None
    try:
        return data.decode("utf-8")
    except UnicodeError:
        reasons.add("binary file")
        return None


def _source(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and all(isinstance(part, str) for part in value):
        return "".join(value)
    return None


def _excerpt(line: str, length: int) -> str:
    line = line.strip().replace("\t", " ")
    return line[:length] + ("…" if len(line) > length else "")


def _scan(request: dict) -> None:
    root = Path(request["root"])
    query = request["query"]
    limit = request["limit"]
    notebooks = request["notebooks"]
    expression = re.compile(query) if request["regex"] else None
    reasons: set[str] = set()
    count = 0
    for file in _files(root, reasons):
        if notebooks:
            if file.suffix.lower() != ".ipynb":
                continue
        else:
            pattern = request["pattern"]
            candidate = file.relative_to(root).as_posix() if root.is_dir() else file.name
            if not fnmatch.fnmatch(candidate if "/" in pattern else file.name, pattern):
                continue
        content = _read(file, reasons)
        if content is None:
            continue
        label = file.as_posix()
        if notebooks:
            try:
                data = json.loads(content)
            except ValueError:
                reasons.add("invalid notebook")
                continue
            cells = data.get("cells") if isinstance(data, dict) else None
            if not isinstance(cells, list):
                reasons.add("invalid notebook")
                continue
            sources = []
            for index, cell in enumerate(cells):
                if not isinstance(cell, dict) or cell.get("cell_type") not in {"code", "markdown", "raw"}:
                    reasons.add("invalid notebook")
                    continue
                source = _source(cell.get("source"))
                if source is None:
                    reasons.add("invalid notebook")
                    continue
                cell_id = cell.get("id")
                if cell_id is None:
                    cell_id = f"[missing-id:cell-{index + 1}]"
                elif not isinstance(cell_id, str) or re.fullmatch(r"[A-Za-z0-9_-]{1,64}", cell_id) is None:
                    cell_id = f"[invalid-id:cell-{index + 1}]"
                    reasons.add("invalid notebook")
                sources.append((cell_id, source))
        else:
            sources = [("", content)]
        for cell_id, source in sources:
            for line_number, line in enumerate(source.splitlines(), 1):
                if (expression.search(line) if expression else query in line):
                    location = f"{label}:{cell_id}:{line_number}" if notebooks else f"{label}:{line_number}"
                    _emit("row", text=f"{location}: {_excerpt(line, 140 if notebooks else 180)}")
                    count += 1
                    if count > limit:
                        _emit("done", more=True, reasons=sorted(reasons))
                        return
                    if notebooks:
                        break
    _emit("done", more=False, reasons=sorted(reasons))


def main() -> None:
    try:
        _scan(json.load(sys.stdin))
    except (ValueError, re.error, KeyError, TypeError) as exc:
        _emit("error", message=str(exc)[:300])


if __name__ == "__main__":
    main()

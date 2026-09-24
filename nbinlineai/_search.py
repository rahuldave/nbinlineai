"""Bounded saved-file search with a hard deadline outside the notebook kernel."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SEARCH_TIMEOUT = 1.5


def search(
    root: Path, query: str, pattern: str, regex: bool, limit: int, notebooks: bool = False
) -> tuple[list[str], str]:
    """Return display rows and a notice for a saved-file or notebook-source search.

    Input validation belongs to the public tool wrappers. The worker emits each row
    immediately, allowing a timeout to retain already completed matches.
    """
    request = {
        "root": str(root), "query": query, "pattern": pattern,
        "regex": regex, "limit": limit, "notebooks": notebooks,
    }
    try:
        completed = subprocess.run(
            [sys.executable, "-I", str(Path(__file__).with_name("_search_worker.py"))],
            input=json.dumps(request), text=True, encoding="utf-8",
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=SEARCH_TIMEOUT,
            check=False,
        )
        output = completed.stdout
        timed_out = False
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or b""
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        timed_out = True
        completed = None

    rows: list[str] = []
    reasons: list[str] = []
    more = False
    error = ""
    for line in output.splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue  # A killed worker may leave a partial final record.
        if record.get("type") == "row":
            if len(rows) < limit:
                rows.append(record["text"])
            else:
                more = True
        elif record.get("type") == "done":
            more |= bool(record.get("more"))
            reasons.extend(record.get("reasons", []))
        elif record.get("type") == "error":
            error = record.get("message", "search failed")
    if error:
        raise ValueError(error)
    if completed is not None and completed.returncode != 0:
        reasons.append("search worker failed")
    if timed_out:
        reasons.append("timeout")
    notice = "\n[more matches; narrow the search]" if more else ""
    if reasons:
        notice += f"\n[partial results: {', '.join(dict.fromkeys(reasons))}; narrow the search]"
    return rows, notice

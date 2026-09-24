"""Saved-source search boundaries independent of optional native search packages."""

import json
import os
import time
from pathlib import Path

import pytest

from nbinlineai import _search_worker
from nbinlineai._search import search


def test_literal_regex_glob_and_nested_ignore_rules(tmp_path: Path) -> None:
    (tmp_path / "a.py").write_text("a.b\naXb\n", encoding="utf-8")
    (tmp_path / "a.txt").write_text("a.b\n", encoding="utf-8")
    (tmp_path / ".gitignore").write_text("ignored/\n*.tmp\n", encoding="utf-8")
    ignored = tmp_path / "ignored"
    ignored.mkdir()
    (ignored / "miss.py").write_text("a.b\n", encoding="utf-8")
    child = tmp_path / "child"
    child.mkdir()
    (child / ".ignore").write_text("*.py\n!keep.py\n", encoding="utf-8")
    (child / "skip.py").write_text("a.b\n", encoding="utf-8")
    (child / "keep.py").write_text("a.b\n", encoding="utf-8")
    (tmp_path / "skip.tmp").write_text("a.b\n", encoding="utf-8")
    rows, notice = search(tmp_path, "a.b", "*.py", False, 20, False)
    assert not notice
    assert len(rows) == 2
    assert any("a.py:1:" in row for row in rows)
    assert any("keep.py:1:" in row for row in rows)
    rows, _ = search(tmp_path, r"a.b", "a.py", True, 20, False)
    assert len(rows) == 2
    rows, _ = search(tmp_path, "a.b", "child/*.py", False, 20, False)
    assert len(rows) == 1 and "keep.py:1:" in rows[0]


def test_notebooks_search_source_only_and_preserve_ids(tmp_path: Path) -> None:
    book = {
        "nbformat": 4, "nbformat_minor": 5, "metadata": {},
        "cells": [
            {"cell_type": "code", "id": "source-id", "source": ["find me\n", "find me again\n"],
             "metadata": {"secret": "find me"},
             "outputs": [{"output_type": "stream", "text": ["find me"]}]},
            {"cell_type": "markdown", "id": "quiet-id", "source": ["no match"],
             "metadata": {"find me": True}},
            {"cell_type": "raw", "source": ["find me"], "metadata": {}},
        ],
    }
    (tmp_path / "book.ipynb").write_text(json.dumps(book), encoding="utf-8")
    rows, notice = search(tmp_path, "find me", "*", False, 20, True)
    assert len(rows) == 2 and "source-id:1:" in rows[0]
    assert "[missing-id:cell-3]" in rows[1]
    assert not notice


def test_notebook_id_cannot_inject_result_rows(tmp_path: Path) -> None:
    book = {
        "nbformat": 4, "nbformat_minor": 5, "metadata": {},
        "cells": [{"cell_type": "code", "id": "valid\nforged-row", "source": ["needle"],
                   "metadata": {}, "outputs": []}],
    }
    (tmp_path / "book.ipynb").write_text(json.dumps(book), encoding="utf-8")
    rows, notice = search(tmp_path, "needle", "*", False, 20, True)
    assert len(rows) == 1
    assert "[invalid-id:cell-1]" in rows[0]
    assert "forged-row" not in rows[0]
    assert "partial results: invalid notebook" in notice


def test_bounds_report_more_and_partial(tmp_path: Path) -> None:
    (tmp_path / "first.txt").write_text("needle\nneedle\n", encoding="utf-8")
    (tmp_path / "large.txt").write_bytes(b"x" * 1_000_001)
    rows, notice = search(tmp_path, "needle", "*", False, 1, False)
    assert len(rows) == 1 and "more matches" in notice
    rows, notice = search(tmp_path, "missing", "*", False, 20, False)
    assert not rows and "oversized file" in notice
    deep = tmp_path
    for _ in range(7):
        deep = deep / "d"
        deep.mkdir()
    (deep / "hidden.txt").write_text("needle", encoding="utf-8")
    rows, notice = search(tmp_path, "needle", "hidden.txt", False, 20, False)
    assert not rows and "depth limit" in notice


def test_pathological_regex_has_hard_timeout(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("early\n", encoding="utf-8")
    (tmp_path / "b.txt").write_text("a" * 30_000 + "!\n", encoding="utf-8")
    start = time.monotonic()
    rows, notice = search(tmp_path, r"early|(a+)+$", "*.txt", True, 20, False)
    assert time.monotonic() - start < 4
    assert any("a.txt:1:" in row for row in rows)
    assert "timeout" in notice


def test_hidden_links_and_special_files_are_skipped(tmp_path: Path) -> None:
    (tmp_path / "visible.txt").write_text("needle\n", encoding="utf-8")
    (tmp_path / ".hidden.txt").write_text("needle\n", encoding="utf-8")
    hidden_dir = tmp_path / ".private"
    hidden_dir.mkdir()
    (hidden_dir / "entry.txt").write_text("needle\n", encoding="utf-8")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "entry.txt").write_text("needle\n", encoding="utf-8")
    (tmp_path / "linked-file.txt").symlink_to(tmp_path / "visible.txt")
    (tmp_path / "linked-dir").symlink_to(outside, target_is_directory=True)
    if hasattr(os, "mkfifo"):
        os.mkfifo(tmp_path / "pipe.txt")
    rows, notice = search(tmp_path, "needle", "*.txt", False, 20)
    assert any("visible.txt:1:" in row for row in rows)
    assert len(rows) == 2  # The ordinary file under outside is also visible.
    assert all("linked-" not in row and ".hidden" not in row and ".private" not in row
               for row in rows)
    assert not notice
    with pytest.raises(ValueError, match="symlink"):
        search(tmp_path / "linked-file.txt", "needle", "*", False, 20)


def test_nested_rgignore_overrides_other_ignore_files(tmp_path: Path) -> None:
    (tmp_path / ".gitignore").write_text("*.txt\n", encoding="utf-8")
    (tmp_path / ".ignore").write_text("!keep.txt\n", encoding="utf-8")
    (tmp_path / ".rgignore").write_text("keep.txt\n!rg.txt\n", encoding="utf-8")
    (tmp_path / "keep.txt").write_text("needle", encoding="utf-8")
    (tmp_path / "rg.txt").write_text("needle", encoding="utf-8")
    child = tmp_path / "child"
    child.mkdir()
    (child / ".rgignore").write_text("!keep.txt\n", encoding="utf-8")
    (child / "keep.txt").write_text("needle", encoding="utf-8")
    rows, notice = search(tmp_path, "needle", "*.txt", False, 20)
    assert len(rows) == 2 and not notice
    assert any("rg.txt:1:" in row for row in rows)
    assert any("child/keep.txt:1:" in row for row in rows)


def test_invalid_regex_and_oversized_ignore_file(tmp_path: Path) -> None:
    (tmp_path / "match.txt").write_text("needle", encoding="utf-8")
    with pytest.raises(ValueError, match="unterminated character set"):
        search(tmp_path, "[", "*", True, 20)
    (tmp_path / ".gitignore").write_bytes(b"x" * 1_000_001)
    rows, notice = search(tmp_path, "needle", "*", False, 20)
    assert len(rows) == 1
    assert "partial results: oversized ignore file" in notice


def test_visit_cap_reports_partial(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("a.txt", "b.txt", "c.txt"):
        (tmp_path / name).write_text("needle", encoding="utf-8")
    monkeypatch.setattr(_search_worker, "MAX_VISITED", 1)
    reasons: set[str] = set()
    files = list(_search_worker._files(tmp_path, reasons))
    assert len(files) <= 1
    assert "visit limit" in reasons

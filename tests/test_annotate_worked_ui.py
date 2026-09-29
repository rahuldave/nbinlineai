"""A real manual comparison can be published without altering its AI run."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path

import pytest

from scripts.annotate_worked_ui import annotate, publish


def _write(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=1) + "\n", encoding="utf-8")


def _fixture(tmp_path: Path) -> tuple[Path, dict, dict]:
    examples = tmp_path / "examples"
    examples.mkdir()
    mappings = {
        name: {"normal_example": {"notebook": "catalog.ipynb", "cell_id": "manual", "mode": "jupyterlab"}}
        for name in ("list_cells", "read_cell")
    }
    mappings["search_docs"] = {
        "normal_example": {"notebook": "catalog.ipynb", "cell_id": "direct", "mode": "python"},
    }
    _write(examples / "tool-coverage.json", mappings)
    notebook = {"metadata": {"kernel": "owned"}, "cells": [
        {"id": "manual", "cell_type": "markdown", "metadata": {}, "source": [
            '<span id="manual"></span>\n', "\n",
            "For a manual comparison, inspect one disposable scratch cell in JupyterLab.\n",
        ]},
        {"id": "direct", "cell_type": "code", "metadata": {"keep": True},
         "source": ["saved = search_docs('short')"], "execution_count": 2,
         "outputs": [{"output_type": "stream", "text": ["real direct result\n"]}]},
        {"id": "answer", "cell_type": "markdown", "metadata": {"nbinlineai": {
            "isOutputCell": True, "promptCellId": "question", "status": "done",
        }}, "source": ["Observed real AI answer"]},
        {"id": "trace", "cell_type": "markdown", "metadata": {
            "nbinlineaiWorkedTrace": True, "nbinlineaiWorkedEvidence": {
                "questionCellId": "question", "observedTools": [{"name": "list_cells", "resultState": "completed"}],
            },
        }, "source": ["| `list_cells` | completed | actual result |"]},
    ]}
    _write(examples / "catalog.ipynb", notebook)
    row = {"notebook": "catalog.ipynb", "cellId": "manual", "name": "list_cells",
           "completed": True, "observedBefore": "The scratch cell was selected.",
           "observedAfter": "The visible cell order was intro, scratch, question."}
    return examples, notebook, row


def test_publish_two_distinct_actions_on_one_mapped_cell_preserves_everything_else(tmp_path: Path) -> None:
    examples, original, row = _fixture(tmp_path)
    second = {**row, "name": "read_cell", "observedBefore": "A scratch cell was open.",
              "observedAfter": "The scratch cell showed its exact source."}
    manifest = tmp_path / "private-ui.json"
    _write(manifest, [row, second])
    assert publish(examples, manifest) == ["catalog.ipynb"]

    changed = json.loads((examples / "catalog.ipynb").read_text(encoding="utf-8"))
    assert changed["metadata"] == original["metadata"]
    assert changed["cells"][1:] == original["cells"][1:]
    manual = changed["cells"][0]
    assert "".join(manual["source"]).startswith("".join(original["cells"][0]["source"]))
    assert manual["metadata"]["nbinlineaiWorkedUIActions"] == [
        {key: row[key] for key in ("name", "completed", "observedBefore", "observedAfter")},
        {key: second[key] for key in ("name", "completed", "observedBefore", "observedAfter")},
    ]
    assert all(action["observedAfter"] in "".join(manual["source"])
               for action in manual["metadata"]["nbinlineaiWorkedUIActions"])


@pytest.mark.parametrize("change", [
    {"name": "search_docs"}, {"name": "unknown_tool"},
    {"cellId": "direct"}, {"notebook": "../catalog.ipynb"},
    {"completed": False}, {"observedAfter": ""},
    {"observedAfter": "x" * 301},
    {"observedAfter": "Private path /Users/person/Notebook.ipynb"},
    {"observedAfter": "The URL was http://127.0.0.1:8897/lab?token=abc123."},
    {"observedAfter": "The source used token=abc123."},
    {"observedAfter": "A hidden [link](https://example.com)"},
    {"observedAfter": "A\nsecond line"},
])
def test_rejects_unmapped_incomplete_or_unsafe_actions_without_writing(
    tmp_path: Path, change: dict,
) -> None:
    examples, _original, row = _fixture(tmp_path)
    before = (examples / "catalog.ipynb").read_bytes()
    with pytest.raises(ValueError):
        annotate(examples, [{**row, **change}])
    assert (examples / "catalog.ipynb").read_bytes() == before


def test_rejects_duplicates_changed_prefix_and_all_batch_changes_atomically(tmp_path: Path) -> None:
    examples, _original, row = _fixture(tmp_path)
    before = (examples / "catalog.ipynb").read_bytes()
    with pytest.raises(ValueError, match="repeated"):
        annotate(examples, [row, row])
    with pytest.raises(ValueError):
        annotate(examples, [row, {**row, "name": "read_cell", "observedAfter": "<unsafe>"}])
    assert (examples / "catalog.ipynb").read_bytes() == before

    notebook = json.loads(before)
    notebook["cells"][0]["source"][0] = "Changed comparison heading\n"
    _write(examples / "catalog.ipynb", notebook)
    with pytest.raises(ValueError, match="source prefix"):
        annotate(examples, [row])


def test_incremental_publication_allows_distinct_action_but_not_replay(tmp_path: Path) -> None:
    examples, _original, row = _fixture(tmp_path)
    first = annotate(examples, [row])["catalog.ipynb"]
    _write(examples / "catalog.ipynb", first)
    second = {**row, "name": "read_cell", "observedAfter": "The source was visible."}
    updated = annotate(examples, [second])["catalog.ipynb"]
    assert len(updated["cells"][0]["metadata"]["nbinlineaiWorkedUIActions"]) == 2
    _write(examples / "catalog.ipynb", updated)
    assert annotate(examples, [copy.deepcopy(row)]) == {}
    with pytest.raises(ValueError, match="conflicts"):
        annotate(examples, [{**row, "observedAfter": "A different result appeared."}])


def test_partial_multi_notebook_publish_resumes_only_exact_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    examples, _original, row = _fixture(tmp_path)
    mapping_path = examples / "tool-coverage.json"
    mapping = json.loads(mapping_path.read_text())
    mapping["url_to_note"] = {"normal_example": {
        "notebook": "web.ipynb", "cell_id": "web-manual", "mode": "jupyterlab",
    }}
    _write(mapping_path, mapping)
    _write(examples / "web.ipynb", {"cells": [{
        "id": "web-manual", "cell_type": "markdown", "metadata": {},
        "source": ['<span id="web-manual"></span>\n',
                   "For a manual comparison, add a public-source note in JupyterLab.\n"],
    }]})
    second = {"notebook": "web.ipynb", "cellId": "web-manual", "name": "url_to_note",
              "completed": True, "observedBefore": "A disposable notebook was open.",
              "observedAfter": "A source-linked note appeared below the selected cell."}
    manifest = tmp_path / "private-ui.json"
    _write(manifest, [row, second])
    real_replace = os.replace
    calls = 0

    def interrupted_replace(source: Path, target: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("interrupted between notebook replacements")
        real_replace(source, target)

    with monkeypatch.context() as patch:
        patch.setattr("scripts.annotate_worked_ui.os.replace", interrupted_replace)
        with pytest.raises(OSError, match="interrupted"):
            publish(examples, manifest)
    first_bytes = (examples / "catalog.ipynb").read_bytes()
    assert "nbinlineaiWorkedUIActions" not in (examples / "web.ipynb").read_text()
    assert publish(examples, manifest) == ["web.ipynb"]
    assert (examples / "catalog.ipynb").read_bytes() == first_bytes
    assert publish(examples, manifest) == []
    with pytest.raises(ValueError, match="conflicts"):
        annotate(examples, [row, {**second, "observedBefore": "A changed claim."}])


def test_unknown_manifest_fields_and_unverified_prose_reject(tmp_path: Path) -> None:
    examples, _original, row = _fixture(tmp_path)
    with pytest.raises(ValueError, match="missing, extra"):
        annotate(examples, [{**row, "claimedOutput": "success"}])
    notebook = json.loads((examples / "catalog.ipynb").read_text())
    notebook["cells"][0]["source"].append("Observed in JupyterLab: unverified result\n")
    _write(examples / "catalog.ipynb", notebook)
    with pytest.raises(ValueError, match="unverified observation prose"):
        annotate(examples, [row])

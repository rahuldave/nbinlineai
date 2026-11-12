"""The starter lesson has runnable fixtures and a live catalog handoff."""

import csv
import json
from pathlib import Path

from nbinlineai.tools import TOOL_GROUPS, find_notebook_cells, read_notebook_cell

NOTEBOOK = Path(__file__).resolve().parents[1] / "examples/starter-tools-tutorial.ipynb"
PROMPTS = (
    "starter-ai-files-create",
    "starter-ai-files-edit",
    "starter-ai-saved-search",
    "starter-ai-live-read",
    "starter-ai-report-insert",
)


def _source(cell):
    source = cell["source"]
    return "".join(source) if isinstance(source, list) else source


def test_starter_lesson_runs_disposable_setup_and_finds_saved_cell(tmp_path, monkeypatch):
    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    ids = [cell["id"] for cell in notebook["cells"]]
    assert len(ids) == len(set(ids))
    assert len(TOOL_GROUPS["starter"]) == 19
    by_id = {cell["id"]: cell for cell in notebook["cells"]}
    assert _source(by_id["starter-catalog-call"]).startswith("from nbinlineai.tools import *\n")
    assert "catalog_receipt = insert_tool_catalog()" in _source(by_id["starter-catalog-call"])
    assert "catalog_receipt.status == \"inserted\"" in _source(by_id["starter-catalog-inspect"])
    assert not any(_source(cell).count("&`") >= 19 for cell in notebook["cells"]
                   if cell["cell_type"] == "markdown"
                   and not cell.get("metadata", {}).get("nbinlineai", {}).get("isPromptCell"))
    assert [cell["id"] for cell in notebook["cells"]
            if cell.get("metadata", {}).get("nbinlineai", {}).get("isPromptCell")] == list(PROMPTS)
    for prompt_id in PROMPTS:
        assert _source(by_id[prompt_id]).count("$`field_study`") == 1
    for cell in notebook["cells"]:
        if cell["cell_type"] == "code":
            compile(_source(cell), f"{NOTEBOOK}:{cell['id']}", "exec")
    generated_ids = set(notebook.get("metadata", {}).get("nbinlineaiTutorial", {})
                        .get("generatedCellIds", []))
    for cell in notebook["cells"]:
        if cell["id"] in generated_ids and cell["cell_type"] == "code":
            assert cell["execution_count"] is None
            assert cell["outputs"] == []

    monkeypatch.chdir(tmp_path)
    namespace = {"__name__": "__main__"}
    exec(compile(_source(by_id["starter-setup"]), "starter-setup", "exec"), namespace)  # noqa: S102
    task = namespace["field_study"]
    assert task["root"] == "starter_field_study"
    with Path(task["source"]).open(newline="", encoding="utf-8") as stream:
        assert list(csv.DictReader(stream)) == [
            {"bench": "A", "shade_minutes": "10", "temperature_c": "31"},
            {"bench": "B", "shade_minutes": "35", "temperature_c": "28"},
            {"bench": "C", "shade_minutes": "50", "temperature_c": "27"},
        ]
    matches = find_notebook_cells(task["saved_book"], task["saved_marker"])
    assert "field-log-observation" in matches
    excerpt = read_notebook_cell(task["saved_book"], "field-log-observation")
    assert "tree shade reached the seat by 14:00" in excerpt
    assert not Path(task["report"]).exists()

    exec(compile(_source(by_id["starter-cleanup"]), "starter-cleanup", "exec"), namespace)  # noqa: S102
    assert not Path(task["root"]).exists()

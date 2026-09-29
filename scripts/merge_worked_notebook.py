"""Combine retained real AI events with a later direct-only execution of one example.

This is an opt-in publication step for canonical ``examples/*.ipynb``. It keeps
the latest committed source cells and IDs, adds only observed code outputs and
linked AI answer/trace cells, and refuses changed source or unsafe output.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from nbinlineai.tools import SPECIAL_TOOL_FUNCTIONS

_ROW = re.compile(r"^\| `([a-z][a-z0-9_]*)` \| (completed|receipt accepted|failed) \|", re.MULTILINE)
_OLD_ROW = re.compile(r"^\| `([a-z][a-z0-9_]*)` \| .*? \| (.*) \|$", re.MULTILINE)
_LEGACY_TRACE_NOTEBOOKS = frozenset({
    "bundled-tools.ipynb", "context-selection.ipynb", "fastcore-tools.ipynb",
    "project-tools.ipynb", "quickstart.ipynb", "tool-catalog-inspection.ipynb",
    "tool-catalog-saved-notebooks.ipynb",
})
_PRIVATE = re.compile(r"(?:Bearer\s+|sk-[A-Za-z0-9_-]{20,}|/Users/|/home/rahul/|"
                      r"/tmp/nbinlineai-|/(?:private/)?var/folders/)", re.IGNORECASE)


def _source(cell: dict) -> str:
    source = cell.get("source", "")
    return "".join(source) if isinstance(source, list) else source


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def merge(source_path: Path, direct_path: Path, ai_path: Path) -> dict:
    source = _load(source_path)
    direct = _load(direct_path)
    ai = _load(ai_path)
    original = {cell["id"]: cell for cell in source["cells"]}
    direct_cells = {cell["id"]: cell for cell in direct["cells"]}
    ai_cells = {cell["id"]: cell for cell in ai["cells"]}
    if len(original) != len(source["cells"]) or len(direct_cells) != len(direct["cells"]):
        raise ValueError("Source or direct notebook repeats a cell ID")
    if any(cell["id"] not in direct_cells or _source(cell) != _source(direct_cells[cell["id"]])
           for cell in source["cells"]):
        raise ValueError("Direct run does not match the latest source cells")
    if any(_source(cell) != _source(ai_cells[cell["id"]])
           for cell in source["cells"] if cell["id"] in ai_cells):
        raise ValueError("Saved AI run used changed source or question text")

    linked_answers: dict[str, dict] = {}
    traces: dict[str, dict] = {}
    inserted: dict[str, list[dict]] = {}
    for index, cell in enumerate(ai["cells"]):
        prompt_id = cell.get("metadata", {}).get("nbinlineai", {}).get("promptCellId")
        if cell.get("metadata", {}).get("nbinlineai", {}).get("isOutputCell"):
            if not isinstance(prompt_id, str) or prompt_id in linked_answers:
                raise ValueError("Saved AI answer is ambiguous")
            if cell["metadata"]["nbinlineai"].get("status") != "done":
                raise ValueError("Saved AI answer did not finish")
            linked_answers[prompt_id] = cell
        if cell.get("metadata", {}).get("nbinlineaiWorkedTrace"):
            question_id = cell["metadata"].get("questionCellId")
            if not isinstance(question_id, str) or question_id in traces:
                raise ValueError("Saved tool trace is ambiguous")
            evidence = cell["metadata"].get("nbinlineaiWorkedEvidence")
            if evidence is None:
                if source_path.name not in _LEGACY_TRACE_NOTEBOOKS:
                    raise ValueError("Unstructured trace cannot be backfilled for this notebook")
                rows = _ROW.findall(_source(cell))
                if not rows and "| Result state |" not in _source(cell):
                    # Only the seven retained pre-structured, non-media runs
                    # used a three-column actual call/result event table.
                    old_rows = _OLD_ROW.findall(_source(cell))
                    if any(result.lstrip("\"' ").startswith("{") for _name, result in old_rows):
                        raise ValueError("Structured tool result needs its original event state")
                    rows = [(name, "failed" if result.lstrip("\"' ").startswith("Error:") else "completed")
                            for name, result in old_rows]
                if not rows:
                    raise ValueError("Saved tool trace contains no observed calls")
                evidence = {"questionCellId": question_id, "observedTools": [
                    {"name": name, "resultState": state, "frontendAction": name in SPECIAL_TOOL_FUNCTIONS}
                    for name, state in rows
                ]}
                cell["metadata"]["nbinlineaiWorkedEvidence"] = evidence
                cell["metadata"]["nbinlineaiWorkedBackfill"] = "classified from the retained live tool-result table"
            elif (not isinstance(evidence, dict) or evidence.get("questionCellId") != question_id
                  or not isinstance(evidence.get("observedTools"), list) or not evidence["observedTools"]):
                raise ValueError("Saved structured tool evidence is invalid")
            traces[question_id] = cell
        elif cell["id"] not in original and not cell.get("metadata", {}).get("nbinlineai", {}).get("isOutputCell"):
            if index == 0:
                raise ValueError("Unanchored inserted cell")
            prior = ai["cells"][index - 1]
            question_id = prior.get("metadata", {}).get("questionCellId")
            prior_evidence = prior.get("metadata", {}).get("nbinlineaiWorkedEvidence", {})
            expected_tools = ({"insert_code"} if cell["cell_type"] == "code"
                              else {"insert_markdown", "url_to_note"} if cell["cell_type"] == "markdown"
                              else set())
            if (not prior.get("metadata", {}).get("nbinlineaiWorkedTrace")
                    or not any(item.get("name") in expected_tools and item.get("resultState") == "completed"
                               for item in prior_evidence.get("observedTools", []))
                    or len(_source(cell)) > 8_000
                    or (cell["cell_type"] == "code" and (cell.get("outputs") or cell.get("execution_count") is not None))):
                raise ValueError("Unexpected or executed AI-inserted cell")
            inserted.setdefault(question_id, []).append(cell)

    merged = []
    for cell in source["cells"]:
        current = dict(cell)
        if cell["cell_type"] == "code":
            executed = direct_cells[cell["id"]]
            current["execution_count"] = executed.get("execution_count")
            current["outputs"] = executed.get("outputs", [])
            current["metadata"] = {**cell.get("metadata", {}), **{
                name: executed.get("metadata", {})[name]
                for name in ("nbinlineaiWorkedDirectCalls", "nbinlineaiWorkedReceipts")
                if name in executed.get("metadata", {})
            }}
        merged.append(current)
        if cell["id"] in linked_answers:
            if not cell.get("metadata", {}).get("nbinlineai", {}).get("isPromptCell"):
                raise ValueError("Answer is not linked to a question")
            merged.append(linked_answers.pop(cell["id"]))
            if cell["id"] in traces:
                merged.append(traces.pop(cell["id"]))
                merged.extend(inserted.pop(cell["id"], []))
    if linked_answers or traces or inserted:
        raise ValueError("Saved AI answer or trace has no current question")
    result = {**source, "cells": merged}
    result["metadata"] = {**source.get("metadata", {}), **{
        name: direct.get("metadata", {}).get(name) or ai.get("metadata", {})[name]
        for name in ("nbinlineai", "nbinlineaiWorked")
        if direct.get("metadata", {}).get(name) or name in ai.get("metadata", {})
    }}
    encoded = json.dumps(result, ensure_ascii=False)
    if _PRIVATE.search(encoded) or len(encoded) > 30_000_000:
        raise ValueError("Worked notebook includes a private path or excessive output")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("direct", type=Path)
    parser.add_argument("ai", type=Path)
    args = parser.parse_args()
    merged = merge(args.source, args.direct, args.ai)
    args.source.write_text(json.dumps(merged, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved {args.source.name} with {len(merged['cells'])} source and observed result cells")


if __name__ == "__main__":
    main()

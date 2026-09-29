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
_INSERT_ROW = re.compile(
    r"^\| `(insert_code|insert_markdown|url_to_note)` \| completed \| (.*?) \| (.*?) \|$",
    re.MULTILINE,
)
_TOOL_REFERENCE = re.compile(r"&`[A-Za-z_][A-Za-z0-9_]*`")
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


def _offered_any_tool(cells: list[dict], question_index: int) -> bool:
    """Mirror enabled Markdown declarations through one question, including inheritance."""
    for cell in cells[:question_index + 1]:
        if cell.get("cell_type") != "markdown":
            continue
        ai = cell.get("metadata", {}).get("nbinlineai", {})
        if ai.get("isOutputCell") or ai.get("promptCellId") or ai.get("toolsInclude") is False:
            continue
        if _TOOL_REFERENCE.search(_source(cell)):
            return True
    return False


def _observed_insertion(trace: dict, cell: dict, expected_tools: set[str]) -> tuple[str, int] | None:
    """Return the requested anchor and call order for an observed inserted cell.

    An empty string means the tool used its default position after the answer.
    """
    observed = trace["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"]
    for row_index, (tool, argument_text, result_text) in enumerate(_INSERT_ROW.findall(_source(trace))):
        result_text = result_text.replace(r"\|", "|").replace("<br>", "\n")
        try:
            result = json.loads(result_text)
        except json.JSONDecodeError:
            result = None
        if isinstance(result, dict):
            inserted_id = result.get("cell_id")
        else:
            match = re.search(r"\bcell(?:\s+id)?\s*[:=]?\s*`?([A-Za-z0-9_-]+)",
                              result_text, re.IGNORECASE)
            inserted_id = match.group(1) if match else None
        if (tool not in expected_tools
                or not any(isinstance(item, dict) and item.get("name") == tool
                           and item.get("resultState") == "completed"
                           for item in observed)
                or inserted_id != cell["id"]):
            continue
        try:
            arguments = json.loads(argument_text.replace(r"\|", "|").replace("<br>", "\n"))
        except json.JSONDecodeError:
            continue
        if not isinstance(arguments, dict):
            continue
        anchor = arguments.get("after_cell_id", "")
        if not isinstance(anchor, str):
            continue
        if tool in {"insert_code", "insert_markdown"} and arguments.get("content") != _source(cell):
            continue
        # url_to_note fetches the page inside the tool; the event records its
        # inserted cell ID but not the fetched body, so only attribution is checkable here.
        if tool == "url_to_note" and not _source(cell).startswith("Source: http"):
            continue
        return anchor, row_index
    return None


def merge(source_path: Path, direct_path: Path, ai_path: Path) -> dict:
    source = _load(source_path)
    direct = _load(direct_path)
    ai = _load(ai_path)
    original = {cell["id"]: cell for cell in source["cells"]}
    direct_cells = {cell["id"]: cell for cell in direct["cells"]}
    ai_cells = {cell["id"]: cell for cell in ai["cells"]}
    if (len(original) != len(source["cells"]) or len(direct_cells) != len(direct["cells"])
            or len(ai_cells) != len(ai["cells"])):
        raise ValueError("Source, direct, or AI notebook repeats a cell ID")
    if set(direct_cells) != set(original):
        raise ValueError("Direct run does not match the latest source cells")
    if any(cell["id"] not in direct_cells or _source(cell) != _source(direct_cells[cell["id"]])
           for cell in source["cells"]):
        raise ValueError("Direct run does not match the latest source cells")
    if any(cell["id"] not in ai_cells or _source(cell) != _source(ai_cells[cell["id"]])
           for cell in source["cells"]):
        raise ValueError("Saved AI run used changed source or question text")
    source_ids = [cell["id"] for cell in source["cells"]]
    if [cell["id"] for cell in ai["cells"] if cell["id"] in original] != source_ids:
        raise ValueError("Saved AI run changed source cell order")

    linked_answers: dict[str, dict] = {}
    traces: dict[str, dict] = {}
    for cell in ai["cells"]:
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
    for question_id, answer in linked_answers.items():
        if (question_id not in original
                or not original[question_id].get("metadata", {}).get("nbinlineai", {}).get("isPromptCell")
                or not _source(answer).strip()):
            raise ValueError("Saved AI answer or trace has no current question")
        question_index = ai["cells"].index(ai_cells[question_id])
        answer_index = ai["cells"].index(answer)
        if answer_index <= question_index:
            raise ValueError("Saved AI answer precedes its question")
        if question_id not in traces:
            if _offered_any_tool(ai["cells"], question_index):
                raise ValueError("Trace-free AI answer had enabled notebook tools")
            if answer_index != question_index + 1:
                raise ValueError("Trace-free AI answer is not adjacent to its question")
    if set(traces) - set(linked_answers):
        raise ValueError("Saved AI answer or trace has no current question")

    positions = {cell["id"]: index for index, cell in enumerate(ai["cells"])}
    inserted_ids: set[str] = set()
    insertion_tails: dict[tuple[str, str], str] = {}
    insertion_row_order: dict[tuple[str, str], int] = {}
    for cell in ai["cells"]:
        if (cell["id"] in original or cell in linked_answers.values()
                or cell in traces.values()):
            continue
        expected_tools = ({"insert_code"} if cell["cell_type"] == "code"
                          else {"insert_markdown", "url_to_note"} if cell["cell_type"] == "markdown"
                          else set())
        if (len(_source(cell)) > 8_000
                or (cell["cell_type"] == "code"
                    and (cell.get("outputs") or cell.get("execution_count") is not None))):
            raise ValueError("Unexpected or executed AI-inserted cell")
        matches = [(question_id, match) for question_id, trace in traces.items()
                   if (match := _observed_insertion(trace, cell, expected_tools)) is not None]
        if len(matches) != 1:
            raise ValueError("Unexpected or executed AI-inserted cell")
        question_id, (requested_anchor, row_index) = matches[0]
        anchor_id = requested_anchor or linked_answers[question_id]["id"]
        if anchor_id not in positions or anchor_id == cell["id"]:
            raise ValueError("AI-inserted cell has a missing requested anchor")
        tail_key = (question_id, anchor_id)
        if row_index <= insertion_row_order.get(tail_key, -1):
            raise ValueError("AI-inserted cells do not match observed call order")
        prior_id = insertion_tails.get(tail_key, anchor_id)
        between = ai["cells"][positions[prior_id] + 1:positions[cell["id"]]]
        if (positions[prior_id] >= positions[cell["id"]]
                or (between and (requested_anchor or prior_id != anchor_id
                                 or [item["id"] for item in between] != [traces[question_id]["id"]]))):
            raise ValueError("AI-inserted cell is not at its requested anchor")
        inserted_ids.add(cell["id"])
        insertion_tails[tail_key] = cell["id"]
        insertion_row_order[tail_key] = row_index

    merged = []
    for cell in ai["cells"]:
        if cell["id"] in original:
            current = dict(original[cell["id"]])
            if cell["cell_type"] == "code":
                executed = direct_cells[cell["id"]]
                current["execution_count"] = executed.get("execution_count")
                current["outputs"] = executed.get("outputs", [])
                current["metadata"] = {**current.get("metadata", {}), **{
                    name: executed.get("metadata", {})[name]
                    for name in ("nbinlineaiWorkedDirectCalls", "nbinlineaiWorkedReceipts")
                    if name in executed.get("metadata", {})
                }}
            merged.append(current)
        elif (cell in linked_answers.values() or cell in traces.values()
              or cell["id"] in inserted_ids):
            merged.append(cell)
        else:
            raise ValueError("Unexpected saved AI cell")
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

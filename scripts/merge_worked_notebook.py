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
from scripts.check_worked_evidence import _literal_insert_names

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


def _recorded_no_tool_plan(answer: dict, question_id: str) -> bool:
    """Accept only the runner's bounded summary of a completed zero-step SSE round."""
    evidence = answer.get("metadata", {}).get("nbinlineaiWorkedNoToolPlan")
    return (isinstance(evidence, dict)
            and set(evidence) == {"questionCellId", "source", "toolSteps", "toolEvents"}
            and evidence.get("questionCellId") == question_id
            and evidence.get("source") == "owned_subscription_sse"
            and type(evidence.get("toolSteps")) is int and evidence["toolSteps"] == 0
            and type(evidence.get("toolEvents")) is int and evidence["toolEvents"] == 0)


def _attested_direct_insertion(source_path: Path, source: dict, direct: dict) -> dict | None:
    """Accept the one execution-bound insert_tools cell observed in the direct run.

    This helper is deliberately tied to the catalog's mapped call and later
    inspection. AI answers may have been recorded before this direct insertion.
    """
    mapping_path = Path(__file__).resolve().parents[1] / "examples" / "tool-coverage.json"
    entry = json.loads(mapping_path.read_text(encoding="utf-8"))["insert_tools"]
    source_ids = [cell["id"] for cell in source["cells"]]
    direct_ids = [cell["id"] for cell in direct["cells"]]
    extras = [cell for cell in direct["cells"] if cell["id"] not in source_ids]
    if not extras:
        return None
    if (source_path.name != entry["normal_example"]["notebook"] or len(extras) != 1
            or entry.get("receipt_kind") != "insert_tools"):
        raise ValueError("Direct run contains an unexpected inserted cell")
    inserted = extras[0]
    call_id = entry["normal_example"]["cell_id"]
    inspect_id = entry["receipt_inspect_cell"]
    if (call_id not in source_ids or inspect_id not in source_ids
            or inserted["id"] in source_ids or direct_ids.index(inserted["id"]) != direct_ids.index(call_id) + 1
            or not source_ids.index(call_id) < source_ids.index(inspect_id)
            or inserted.get("cell_type") != "markdown"
            or inserted.get("metadata", {}).get("nbinlineai")
            or len(_source(inserted)) > 8_000):
        raise ValueError("Direct insertion does not follow its mapped calling cell")
    by_id = {cell["id"]: cell for cell in direct["cells"]}
    call = by_id[call_id]
    inspect = by_id[inspect_id]
    evidence = inspect.get("metadata", {}).get("nbinlineaiWorkedInsertion")
    if (call.get("execution_count") is None or inspect.get("execution_count") is None
            or any(output.get("output_type") == "error" for output in call.get("outputs", []))
            or any(output.get("output_type") == "error" for output in inspect.get("outputs", []))
            or not isinstance(evidence, dict) or evidence.get("variable") != entry["receipt_variable"]
            or evidence.get("status") != "inserted" or evidence.get("cellPresent") is not True
            or evidence.get("insertedCellId") != inserted["id"]):
        raise ValueError("Direct insertion lacks its completed later receipt")
    try:
        requested = _literal_insert_names(_source(call))
    except (SyntaxError, ValueError) as exc:
        raise ValueError("Direct insertion has no explicit literal request") from exc
    references = re.findall(r"&`([A-Za-z_][A-Za-z0-9_]*)`", _source(inserted))
    lines = _source(inserted).splitlines()
    declarations = evidence.get("declarations")
    if (not isinstance(declarations, list)
            or any(not isinstance(name, str) for name in declarations)
            or len(declarations) != len(requested) or set(declarations) != requested
            or len(references) != len(requested) or set(references) != requested
            or not lines or lines[0] != "Available tools (delete any line you do not want to offer):"
            or len(lines) != len(requested) + 1
            or any(not re.fullmatch(r"- &`[A-Za-z_][A-Za-z0-9_]*` — .+", line) for line in lines[1:])):
        raise ValueError("Direct insertion content does not match the requested declarations")
    displayed = "".join(
        "".join(output.get("text", [])) if isinstance(output.get("text"), list)
        else output.get("text", "") if isinstance(output.get("text"), str)
        else "" for output in inspect.get("outputs", [])
    )
    if "inserted" not in displayed or inserted["id"] not in displayed:
        raise ValueError("Direct insertion receipt was not visibly inspected")
    return inserted


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
    if any(cell["id"] not in direct_cells or _source(cell) != _source(direct_cells[cell["id"]])
           for cell in source["cells"]):
        raise ValueError("Direct run does not match the latest source cells")
    direct_inserted = _attested_direct_insertion(source_path, source, direct)
    if direct_inserted and direct_inserted["id"] in ai_cells:
        raise ValueError("Direct insertion duplicates a saved AI cell")
    if set(direct_cells) - ({direct_inserted["id"]} if direct_inserted else set()) != set(original):
        raise ValueError("Direct run does not match the latest source cells")
    if ([cell["id"] for cell in direct["cells"] if cell["id"] in original]
            != [cell["id"] for cell in source["cells"]]):
        raise ValueError("Direct run changed source cell order")
    direct_insert_after = (direct["cells"][[cell["id"] for cell in direct["cells"]].index(
        direct_inserted["id"]) - 1]["id"]
                           if direct_inserted else None)
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
            proof = answer.get("metadata", {}).get("nbinlineaiWorkedNoToolPlan")
            if proof is not None and not _recorded_no_tool_plan(answer, question_id):
                raise ValueError("Trace-free AI answer has invalid no-tool evidence")
            if _offered_any_tool(ai["cells"], question_index) and proof is None:
                raise ValueError("Trace-free AI answer had enabled notebook tools without no-tool evidence")
            if answer_index != question_index + 1:
                raise ValueError("Trace-free AI answer is not adjacent to its question")
        elif answer.get("metadata", {}).get("nbinlineaiWorkedNoToolPlan") is not None:
            raise ValueError("Tool trace conflicts with no-tool evidence")
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
                    for name in ("nbinlineaiWorkedDirectCalls", "nbinlineaiWorkedReceipts",
                                 "nbinlineaiWorkedInsertion")
                    if name in executed.get("metadata", {})
                }}
            merged.append(current)
            if direct_inserted and cell["id"] == direct_insert_after:
                merged.append(direct_inserted)
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

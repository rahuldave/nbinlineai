"""Check paired tool demonstrations and saved, machine-readable execution evidence.

The default pass checks source structure. ``--require-executed`` also checks the
saved top-level notebooks after the opt-in worked-notebook runner has run them.
It never infers a tool call or a finished browser operation from answer prose.
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Any

from nbinlineai.tools import TOOL_FUNCTIONS

HELPERS = frozenset({"insert_tools", "tool_catalog", "tools_markdown"})
TERMINAL_SUCCESS = frozenset({"completed"})
CONTROL_TARGET_STATES = {
    "pause_recording": frozenset({"paused"}),
    "resume_recording": frozenset({"running"}),
    "stop_recording": frozenset({"completed"}),
    "cancel_operation": frozenset({"cancelled"}),
}


def _source(cell: dict[str, Any]) -> str:
    source = cell.get("source", "")
    return "".join(source) if isinstance(source, list) else source


def _load_notebook(examples_dir: Path, filename: str) -> list[dict[str, Any]]:
    if Path(filename).name != filename or not filename.endswith(".ipynb"):
        raise ValueError(f"unsafe notebook name: {filename!r}")
    notebook = json.loads((examples_dir / filename).read_text(encoding="utf-8"))
    return notebook["cells"]


def _cell(cells: list[dict[str, Any]], cell_id: str) -> tuple[int, dict[str, Any]]:
    found = [(i, cell) for i, cell in enumerate(cells) if cell.get("id") == cell_id]
    if len(found) != 1:
        raise ValueError(f"expected exactly one cell {cell_id!r}, got {len(found)}")
    return found[0]


def _calls_name(source: str, name: str) -> bool:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    return any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == name
        for node in ast.walk(tree)
    )


def _offered_before(cells: list[dict[str, Any]], index: int, name: str) -> bool:
    declaration = f"&`{name}`"
    for cell in cells[:index + 1]:
        if cell.get("cell_type") != "markdown":
            continue
        meta = cell.get("metadata", {}).get("nbinlineai", {})
        if meta.get("isOutputCell") or meta.get("promptCellId") or meta.get("toolsInclude") is False:
            continue
        if declaration in _source(cell):
            return True
    return False


def _answer(cells: list[dict[str, Any]], question_id: str) -> tuple[int, dict[str, Any]]:
    found = [
        (i, cell) for i, cell in enumerate(cells)
        if cell.get("metadata", {}).get("nbinlineai", {}).get("isOutputCell")
        and cell.get("metadata", {}).get("nbinlineai", {}).get("promptCellId") == question_id
    ]
    if (len(found) != 1 or not _source(found[0][1]).strip()
            or found[0][1]["metadata"]["nbinlineai"].get("status") != "done"):
        raise ValueError(f"{question_id}: expected one completed, nonempty linked saved answer")
    return found[0]


def _observed(cells: list[dict[str, Any]], question_id: str) -> list[dict[str, Any]]:
    found = [
        cell["metadata"]["nbinlineaiWorkedEvidence"]
        for cell in cells
        if isinstance(cell.get("metadata", {}).get("nbinlineaiWorkedEvidence"), dict)
        and cell["metadata"]["nbinlineaiWorkedEvidence"].get("questionCellId") == question_id
    ]
    if len(found) != 1:
        raise ValueError(f"{question_id}: expected one structured observed-tool trace")
    calls = found[0].get("observedTools")
    if not isinstance(calls, list):
        raise TypeError(f"{question_id}: observedTools must be a list")
    return calls


def _later_effect(
    cells: list[dict[str, Any]], question_index: int, call: dict[str, Any],
) -> bool:
    """A receipt needs a later observed status for its own or controlled operation."""
    operation_id = call.get("operationId")
    target_id = call.get("targetOperationId")
    target_states = CONTROL_TARGET_STATES.get(call.get("name"), frozenset())
    for index, cell in enumerate(cells[question_index + 1:], start=question_index + 1):
        evidence = cell.get("metadata", {}).get("nbinlineaiWorkedEvidence")
        if not isinstance(evidence, dict):
            continue
        later_question_id = evidence.get("questionCellId")
        if not isinstance(later_question_id, str):
            continue
        try:
            later_question_index, later_question = _cell(cells, later_question_id)
            _answer(cells, later_question_id)
        except ValueError:
            continue
        if (later_question_index <= question_index or later_question_index >= index
                or not later_question.get("metadata", {}).get("nbinlineai", {}).get("isPromptCell")):
            continue
        for observed in evidence.get("observedTools", []):
            if observed.get("name") != "operation_status" or observed.get("resultState") != "completed":
                continue
            if (observed.get("targetOperationId") == operation_id
                    and observed.get("operationState") == "completed"):
                return True
            if (target_states and observed.get("targetOperationId") == target_id
                    and observed.get("operationState") in target_states):
                return True
    return False


def validate_examples(
    examples_dir: Path, *, require_executed: bool = False,
    public_tools: set[str] | None = None,
    only_notebook: str | None = None,
) -> list[str]:
    """Check every mapping; optionally scope saved execution checks to one notebook."""
    coverage = json.loads((examples_dir / "tool-coverage.json").read_text(encoding="utf-8"))
    public = set(TOOL_FUNCTIONS) if public_tools is None else public_tools
    errors: list[str] = []
    expected = public | HELPERS
    if set(coverage) != expected:
        errors.append(
            f"coverage names differ: missing={sorted(expected - set(coverage))}, "
            f"unexpected={sorted(set(coverage) - expected)}"
        )
    if only_notebook is not None:
        if Path(only_notebook).name != only_notebook or not only_notebook.endswith(".ipynb"):
            return [f"unsafe notebook name: {only_notebook!r}"]
        mapped = {
            example["notebook"] for entry in coverage.values()
            for example in (entry.get("normal_example"), entry.get("ai_example"))
            if isinstance(example, dict) and isinstance(example.get("notebook"), str)
        }
        if only_notebook not in mapped:
            return [f"no tool demonstrations mapped to {only_notebook!r}"]
    cache: dict[str, list[dict[str, Any]]] = {}

    def cells_for(filename: str) -> list[dict[str, Any]]:
        if filename not in cache:
            cache[filename] = _load_notebook(examples_dir, filename)
        return cache[filename]

    for name in sorted(expected & set(coverage)):
        entry = coverage[name]
        try:
            normal = entry["normal_example"]
            if not isinstance(normal, dict):
                raise TypeError("missing normal_example")
            check_executed = require_executed and (
                only_notebook is None or normal.get("notebook") == only_notebook
                or (isinstance(entry.get("ai_example"), dict)
                    and entry["ai_example"].get("notebook") == only_notebook)
            )
            normal_cells = cells_for(normal["notebook"])
            normal_index, normal_cell = _cell(normal_cells, normal["cell_id"])
            mode = normal["mode"]
            if mode == "python":
                if normal_cell["cell_type"] != "code" or not _calls_name(_source(normal_cell), name):
                    raise ValueError("normal Python example does not call the named tool")
            elif mode == "jupyterlab":
                text = _source(normal_cell)
                if (normal_cell["cell_type"] != "markdown" or len(text.strip()) < 80
                        or (name not in text and "manual comparison" not in text.lower())):
                    raise ValueError("normal JupyterLab comparison lacks an actionable manual step")
                if check_executed:
                    actions = normal_cell.get("metadata", {}).get("nbinlineaiWorkedUIActions", [])
                    if not isinstance(actions, list) or not any(
                        isinstance(action, dict) and action.get("name") == name
                        and action.get("completed") is True
                        and all(isinstance(action.get(key), str)
                                and 0 < len(action[key].strip()) <= 300
                                for key in ("observedBefore", "observedAfter"))
                        and action["observedAfter"] in text
                        for action in actions
                    ):
                        raise ValueError("normal JupyterLab action lacks a visible observed outcome")
            else:
                raise ValueError(f"unknown normal mode {mode!r}")

            ai = entry["ai_example"]
            if name in HELPERS:
                if ai is not None or not entry.get("ai_exception_reason"):
                    raise ValueError("setup helper needs an explicit AI exception")
            else:
                if not isinstance(ai, dict):
                    raise ValueError("public tool has no AI example")
                ai_cells = cells_for(ai["notebook"])
                question_index, question = _cell(ai_cells, ai["cell_id"])
                prompt = question.get("metadata", {}).get("nbinlineai", {})
                if question["cell_type"] != "markdown" or not prompt.get("isPromptCell"):
                    raise ValueError("AI example is not a question cell")
                if prompt.get("promptMode") != "compact":
                    raise ValueError("AI question does not select Concise mode")
                if name not in _source(question) or not _offered_before(ai_cells, question_index, name):
                    raise ValueError("AI question does not name and offer the tool")

                if check_executed:
                    _answer(ai_cells, ai["cell_id"])
                    calls = [call for call in _observed(ai_cells, ai["cell_id"])
                             if call.get("name") == name]
                    if not calls:
                        raise ValueError("no observed live call of named tool")
                    if not any(
                        (call.get("resultState") == "completed"
                         and (name == "operation_status" or call.get("operationState") not in {
                             "requested", "waiting_for_user", "running", "paused", "saving",
                             "cancelled", "failed", "expired",
                         }))
                        or (call.get("resultState") == "receipt accepted"
                            and isinstance(call.get("operationId"), str)
                            and _later_effect(ai_cells, question_index, call))
                        for call in calls
                    ):
                        raise ValueError("no completed result or linked later operation effect")

            if check_executed and mode == "python":
                if normal_cell.get("execution_count") is None:
                    raise ValueError("normal Python call was not executed")
                if any(output.get("output_type") == "error" for output in normal_cell.get("outputs", [])):
                    raise ValueError("normal Python call raised an error")
                if name not in HELPERS:
                    direct = normal_cell.get("metadata", {}).get("nbinlineaiWorkedDirectCalls", [])
                    if not any(
                        item.get("name") == name and item.get("cellId") == normal["cell_id"]
                        and item.get("completed") is True
                        for item in direct
                    ):
                        raise ValueError("normal Python call lacks observed direct execution")
                inspect_id = entry.get("receipt_inspect_cell")
                if inspect_id:
                    inspect_index, inspect = _cell(normal_cells, inspect_id)
                    if inspect_index <= normal_index or inspect.get("execution_count") is None:
                        raise ValueError("later receipt inspection was not executed")
                    if not inspect.get("outputs"):
                        raise ValueError("receipt inspection has no displayed result")
                    if any(output.get("output_type") == "error" for output in inspect["outputs"]):
                        raise ValueError("receipt inspection raised an error")
                    variable = entry.get("receipt_variable")
                    if entry.get("receipt_kind") == "insert_tools":
                        insertion = inspect.get("metadata", {}).get("nbinlineaiWorkedInsertion")
                        if (not isinstance(insertion, dict)
                                or insertion.get("variable") != variable
                                or insertion.get("status") != entry.get("receipt_success_status")
                                or insertion.get("cellPresent") is not True):
                            raise ValueError("insertion receipt has no verified inserted result")
                        inserted_id = insertion.get("insertedCellId")
                        if entry.get("receipt_cell_id_required") and (
                            not isinstance(inserted_id, str) or not inserted_id.strip()
                        ):
                            raise ValueError("insertion receipt has no inserted cell ID")
                        inserted_index, inserted_cell = _cell(normal_cells, inserted_id)
                        declarations = insertion.get("declarations")
                        if (not normal_index < inserted_index < inspect_index
                                or inserted_cell.get("cell_type") != "markdown"
                                or not isinstance(declarations, list) or not declarations
                                or any(not isinstance(declaration, str)
                                       or f"&`{declaration}`" not in _source(inserted_cell)
                                       for declaration in declarations)):
                            raise ValueError("inserted declaration cell does not match receipt")
                    else:
                        receipts = inspect.get("metadata", {}).get("nbinlineaiWorkedReceipts", [])
                        if not any(
                            receipt.get("variable") == variable
                            and isinstance(receipt.get("operationId"), str)
                            and receipt.get("status") in TERMINAL_SUCCESS
                            for receipt in receipts
                        ):
                            raise ValueError("receipt inspection has no verified terminal result")
                elif name in HELPERS and not normal_cell.get("outputs"):
                    raise ValueError("setup helper has no displayed result")
        except (KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
            errors.append(f"{name}: {exc}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--examples-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "examples")
    parser.add_argument("--require-executed", action="store_true")
    parser.add_argument("--only-notebook", metavar="NAME.ipynb",
                        help="Scope saved execution checks, while checking all source mappings")
    args = parser.parse_args()
    errors = validate_examples(args.examples_dir, require_executed=args.require_executed,
                               only_notebook=args.only_notebook)
    if errors:
        for error in errors:
            print(error)
        return 1
    print("Worked demonstration evidence matches the registered tools.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

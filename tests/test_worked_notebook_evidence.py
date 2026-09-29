"""The worked-evidence gate must not mistake prose or an initial receipt for success."""

import json
from pathlib import Path

from scripts.check_worked_evidence import validate_examples


def _code(cell_id: str, source: str, *, executed: bool = True, metadata: dict | None = None) -> dict:
    return {"cell_type": "code", "id": cell_id, "source": source,
            "metadata": metadata or {}, "execution_count": 1 if executed else None,
            "outputs": [{"output_type": "stream", "name": "stdout", "text": "ok\n"}] if executed else []}


def _markdown(cell_id: str, source: str, metadata: dict | None = None) -> dict:
    return {"cell_type": "markdown", "id": cell_id, "source": source,
            "metadata": metadata or {}}


def _fixture(tmp_path: Path, *, state: str = "completed", later: bool = False) -> Path:
    rows = {
        "example_tool": {
            "normal_example": {"notebook": "example.ipynb", "cell_id": "normal", "mode": "python"},
            "ai_example": {"notebook": "example.ipynb", "cell_id": "question"},
        }
    }
    cells = [
        _code("normal", "print(example_tool())", metadata={"nbinlineaiWorkedDirectCalls": [
            {"name": "example_tool", "cellId": "normal", "completed": True},
        ]}),
        _markdown("question", "Use &`example_tool` and report its result.",
                  {"nbinlineai": {"isPromptCell": True, "promptMode": "compact"}}),
        _markdown("answer", "The operation was requested.",
                  {"nbinlineai": {"isOutputCell": True, "promptCellId": "question",
                                  "status": "done"}}),
        _markdown("trace", "Observed call", {"nbinlineaiWorkedEvidence": {
            "questionCellId": "question", "observedTools": [{
                "name": "example_tool", "resultState": state, "frontendAction": True,
                "operationId": "op-1",
            }],
        }}),
    ]
    if later:
        cells.extend([
            _markdown("status-question", "Use &`operation_status` on op-1.",
                      {"nbinlineai": {"isPromptCell": True, "promptMode": "compact"}}),
            _markdown("status-answer", "It completed.",
                      {"nbinlineai": {"isOutputCell": True, "promptCellId": "status-question",
                                      "status": "done"}}),
            _markdown("status-trace", "Observed status", {"nbinlineaiWorkedEvidence": {
                "questionCellId": "status-question", "observedTools": [{
                    "name": "operation_status", "resultState": "completed", "frontendAction": True,
                    "targetOperationId": "op-1", "operationState": "completed",
                }],
            }}),
        ])
    for helper in ("insert_tools", "tool_catalog", "tools_markdown"):
        rows[helper] = {
            "normal_example": {"notebook": "example.ipynb", "cell_id": helper, "mode": "python"},
            "ai_example": None, "ai_exception_reason": "This is a setup helper.",
        }
        cells.append(_code(helper, f"print({helper}())"))
    (tmp_path / "tool-coverage.json").write_text(json.dumps(rows), encoding="utf-8")
    (tmp_path / "example.ipynb").write_text(json.dumps({"cells": cells}), encoding="utf-8")
    return tmp_path


def _check(path: Path, *, strict: bool = True) -> list[str]:
    return validate_examples(path, require_executed=strict, public_tools={"example_tool"})


def test_completed_live_call_and_normal_python_execution_are_required(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    assert _check(path) == []
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][0]["execution_count"] = None
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "normal Python call was not executed" in "\n".join(_check(path))


def test_dead_code_and_unrelated_stdout_are_not_direct_call_evidence(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][0]["source"] = "if False:\n    example_tool()\nprint('unrelated')"
    notebook["cells"][0]["metadata"]["nbinlineaiWorkedDirectCalls"] = []
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert _check(path, strict=False) == []  # Source offers an executable example.
    assert "lacks observed direct execution" in "\n".join(_check(path))


def test_observed_assignment_does_not_need_a_display_output(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][0]["source"] = "saved = example_tool()"
    notebook["cells"][0]["outputs"] = []
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert _check(path) == []


def test_answer_prose_does_not_substitute_for_observed_call(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][3]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"] = []
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "no observed live call" in "\n".join(_check(path))


def test_receipt_requires_matching_later_terminal_observation(tmp_path: Path) -> None:
    path = _fixture(tmp_path, state="receipt accepted")
    assert "no completed result or linked later operation effect" in "\n".join(_check(path))
    path = _fixture(tmp_path, state="receipt accepted", later=True)
    assert _check(path) == []
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][6]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"][0][
        "targetOperationId"] = "different-operation"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "no completed result or linked later operation effect" in "\n".join(_check(path))


def test_failed_result_and_missing_answer_are_not_saved_evidence(tmp_path: Path) -> None:
    path = _fixture(tmp_path, state="failed")
    assert "no completed result or linked later operation effect" in "\n".join(_check(path))
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][2]["metadata"] = {}
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "expected one completed, nonempty linked saved answer" in "\n".join(_check(path))


def test_completed_label_cannot_mask_a_pending_operation_state(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    call = notebook["cells"][3]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"][0]
    call["operationState"] = "running"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "no completed result or linked later operation effect" in "\n".join(_check(path))


def test_failed_answer_does_not_count_as_completed_evidence(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][2]["metadata"]["nbinlineai"]["status"] = "failed"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "expected one completed, nonempty linked saved answer" in "\n".join(_check(path))


def test_receipt_inspection_needs_kernel_recorded_terminal_state(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    rows = json.loads((path / "tool-coverage.json").read_text(encoding="utf-8"))
    rows["example_tool"].update(receipt_inspect_cell="inspect", receipt_variable="received")
    (path / "tool-coverage.json").write_text(json.dumps(rows), encoding="utf-8")
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"].insert(1, _code("inspect", "print(received.status)", metadata={
        "nbinlineaiWorkedReceipts": [{"variable": "received", "operationId": "op-1",
                                        "status": "running"}],
    }))
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "no verified terminal result" in "\n".join(_check(path))
    notebook["cells"][1]["metadata"]["nbinlineaiWorkedReceipts"][0]["status"] = "completed"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert _check(path) == []


def test_manual_comparison_is_structural_not_fake_python_execution(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    rows = json.loads((path / "tool-coverage.json").read_text(encoding="utf-8"))
    rows["example_tool"]["normal_example"] = {
        "notebook": "example.ipynb", "cell_id": "manual", "mode": "jupyterlab",
    }
    (path / "tool-coverage.json").write_text(json.dumps(rows), encoding="utf-8")
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"].insert(0, _markdown("manual", "For a manual comparison, use the "
        "JupyterLab editor to perform the same example_tool action on a disposable copy."))
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert _check(path) == []

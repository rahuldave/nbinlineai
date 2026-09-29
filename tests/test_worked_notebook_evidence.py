"""The worked-evidence gate must not mistake prose or an initial receipt for success."""

import json
from pathlib import Path

import pytest

from scripts.check_worked_evidence import (
    _later_effect,
    execution_deferral_summary,
    validate_examples,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]


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


def _camera_fixture(tmp_path: Path, name: str = "start_camera") -> Path:
    examples = tmp_path / "examples"
    examples.mkdir()
    _fixture(examples)
    coverage_path = examples / "tool-coverage.json"
    rows = json.loads(coverage_path.read_text(encoding="utf-8"))
    rows[name] = rows.pop("example_tool")
    rows[name]["execution_deferral"] = {
        "modes": ["normal"],
        "reason": f"{name} has an observed AI camera run; its separate direct camera call has not run.",
        "authorized_on": "2026-09-29",
        "evidence_ref": "internal_docs/worked_notebooks_run.md#camera",
    }
    coverage_path.write_text(json.dumps(rows), encoding="utf-8")
    notebook_path = examples / "example.ipynb"
    notebook_path.write_text(notebook_path.read_text(encoding="utf-8").replace("example_tool", name),
                             encoding="utf-8")
    run_log = tmp_path / "internal_docs" / "worked_notebooks_run.md"
    run_log.parent.mkdir()
    run_log.write_text("# Worked runs\n\n## Camera\n\nAI acquired a camera; direct call unrun.\n",
                       encoding="utf-8")
    return examples


@pytest.mark.parametrize("name", ["start_camera", "capture_camera", "record_camera"])
def test_camera_deferral_is_normal_only_and_requires_observed_ai(tmp_path: Path, name: str) -> None:
    examples = _camera_fixture(tmp_path, name=name)
    notebook_path = examples / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][0]["execution_count"] = None
    notebook["cells"][0]["metadata"]["nbinlineaiWorkedDirectCalls"] = []
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert validate_examples(examples, require_executed=True, public_tools={name}) == []
    assert execution_deferral_summary(examples) == (
        f"1 camera execution deferrals (normal only): {name}"
    )

    notebook["cells"][2]["metadata"]["nbinlineai"]["status"] = "failed"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "expected one completed" in "\n".join(
        validate_examples(examples, require_executed=True, public_tools={name})
    )
    notebook["cells"][2]["metadata"]["nbinlineai"]["status"] = "done"
    notebook["cells"][3]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"] = []
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "no observed live call" in "\n".join(
        validate_examples(examples, require_executed=True, public_tools={name})
    )
    notebook["cells"][3]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"] = [{
        "name": name, "resultState": "completed", "frontendAction": True,
        "operationId": "op-1",
    }]

    notebook["cells"][0]["source"] = f"print('{name}()')"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "normal Python example does not call" in "\n".join(
        validate_examples(examples, require_executed=True, public_tools={name})
    )
    notebook["cells"][0]["source"] = f"print({name}())"
    notebook["cells"][1]["source"] = f"Use {name} without a declaration."
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "does not name and offer" in "\n".join(
        validate_examples(examples, require_executed=True, public_tools={name})
    )


def test_camera_deferral_rejects_broader_or_unevidenced_waivers(tmp_path: Path) -> None:
    examples = _camera_fixture(tmp_path)
    coverage_path = examples / "tool-coverage.json"
    original = json.loads(coverage_path.read_text(encoding="utf-8"))
    bad_values = [
        ("modes", ["normal", "ai", "notebook"]),
        ("modes", ["normal", "ai"]),
        ("authorized_on", "2026-09-30"),
        ("evidence_ref", "https://example.org/camera"),
        ("reason", "camera unavailable"),
    ]
    for key, value in bad_values:
        rows = json.loads(json.dumps(original))
        rows["start_camera"]["execution_deferral"][key] = value
        coverage_path.write_text(json.dumps(rows), encoding="utf-8")
        assert "start_camera: camera execution deferral" in "\n".join(
            validate_examples(examples, require_executed=True, public_tools={"start_camera"})
        ), (key, value)
    coverage_path.write_text(json.dumps(original), encoding="utf-8")
    run_log = tmp_path / "internal_docs" / "worked_notebooks_run.md"
    run_log.write_text("# Worked runs\n\n## Microphone\n", encoding="utf-8")
    assert "needs the run log's Camera section" in "\n".join(
        validate_examples(examples, require_executed=True, public_tools={"start_camera"})
    )


def test_non_camera_tool_cannot_use_camera_deferral(tmp_path: Path) -> None:
    examples = _camera_fixture(tmp_path, name="example_tool")
    assert "limited to the three camera-only tools" in "\n".join(
        validate_examples(examples, require_executed=True, public_tools={"example_tool"})
    )


def test_camera_deferral_does_not_waive_another_tools_evidence(tmp_path: Path) -> None:
    examples = _camera_fixture(tmp_path)
    coverage_path = examples / "tool-coverage.json"
    rows = json.loads(coverage_path.read_text(encoding="utf-8"))
    rows["example_tool"] = {
        "normal_example": {"notebook": "example.ipynb", "cell_id": "normal", "mode": "python"},
        "ai_example": {"notebook": "example.ipynb", "cell_id": "question"},
    }
    coverage_path.write_text(json.dumps(rows), encoding="utf-8")
    notebook_path = examples / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    notebook["cells"][0]["source"] = "print(start_camera()); print(example_tool())"
    notebook["cells"][0]["metadata"]["nbinlineaiWorkedDirectCalls"] = []
    notebook["cells"][1]["source"] = "Use &`start_camera` and &`example_tool` and report both results."
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    errors = validate_examples(examples, require_executed=True,
                               public_tools={"start_camera", "example_tool"})
    assert not any(error.startswith("start_camera:") for error in errors)
    assert any(error.startswith("example_tool:") and "observed" in error for error in errors)


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


@pytest.mark.parametrize("control, expected", [
    ("pause_recording", "paused"),
    ("resume_recording", "running"),
    ("cancel_operation", "cancelled"),
])
def test_control_effect_needs_a_successful_exact_later_status_lookup(
    control: str, expected: str,
) -> None:
    target = "TargetOperation0123456789abcdef01234"
    control_id = "ControlOperation0123456789abcdef0123"
    call = {"name": control, "operationId": control_id, "targetOperationId": target}
    lookup = {"name": "operation_status", "resultState": "completed",
              "targetOperationId": target, "operationState": expected}
    cells = [
        _markdown("control-question", f"Use &`{control}`.",
                  {"nbinlineai": {"isPromptCell": True}}),
        _markdown("control-answer", "Requested.",
                  {"nbinlineai": {"isOutputCell": True, "promptCellId": "control-question",
                                  "status": "done"}}),
        _markdown("status-question", "Check the same operation.",
                  {"nbinlineai": {"isPromptCell": True}}),
        _markdown("status-answer", "Checked.",
                  {"nbinlineai": {"isOutputCell": True, "promptCellId": "status-question",
                                  "status": "done"}}),
        _markdown("status-trace", "Observed lookup", {"nbinlineaiWorkedEvidence": {
            "questionCellId": "status-question", "observedTools": [lookup],
        }}),
    ]
    assert _later_effect(cells, 0, call)
    for change in (
        {"resultState": "failed"}, {"resultState": "receipt accepted"},
        {"targetOperationId": "DifferentOperation0123456789abcdef01"},
        {"operationState": "completed" if expected != "completed" else "running"},
    ):
        cells[-1]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"] = [lookup | change]
        assert not _later_effect(cells, 0, call), change
    cells[-1]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"] = [lookup]
    cells[3]["metadata"]["nbinlineai"]["status"] = "failed"
    assert not _later_effect(cells, 0, call)


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
    assert _check(path, strict=False) == []
    assert "lacks a visible observed outcome" in "\n".join(_check(path))
    notebook["cells"][0]["source"] += "\nObserved in JupyterLab: found the selected cell."
    notebook["cells"][0]["metadata"]["nbinlineaiWorkedUIActions"] = [{
        "name": "example_tool", "completed": True,
        "observedBefore": "Selected cell was available.",
        "observedAfter": "found the selected cell.",
    }]
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert _check(path) == []


def test_insert_tools_requires_later_receipt_and_actual_declaration(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    coverage_path = path / "tool-coverage.json"
    rows = json.loads(coverage_path.read_text(encoding="utf-8"))
    rows["insert_tools"].update({
        "receipt_variable": "receipt",
        "receipt_inspect_cell": "insert-inspect",
        "receipt_kind": "insert_tools",
        "receipt_success_status": "inserted",
        "receipt_cell_id_required": True,
    })
    coverage_path.write_text(json.dumps(rows), encoding="utf-8")
    notebook_path = path / "example.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    helper_index = next(i for i, cell in enumerate(notebook["cells"])
                        if cell["id"] == "insert_tools")
    notebook["cells"][helper_index]["source"] = "receipt = insert_tools(['example_tool'])\nprint(receipt)"
    notebook["cells"].insert(helper_index + 1, _markdown("declaration", "&`example_tool`"))
    notebook["cells"].extend([
        _code("insert-inspect", "print(receipt.status, receipt.cell_id)", metadata={
            "nbinlineaiWorkedInsertion": {
                "variable": "receipt", "status": "requested", "insertedCellId": "declaration",
                "declarations": ["example_tool"], "cellPresent": True,
            },
        }),
    ])
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "no verified inserted result" in "\n".join(_check(path))

    notebook["cells"][-1]["metadata"]["nbinlineaiWorkedInsertion"]["status"] = "inserted"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert _check(path) == []

    notebook["cells"][helper_index + 1]["source"] = "A different declaration"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "inserted declaration cell does not match receipt" in "\n".join(_check(path))

    notebook["cells"][helper_index + 1]["source"] = "&`other_tool`"
    insertion = notebook["cells"][-1]["metadata"]["nbinlineaiWorkedInsertion"]
    insertion["declarations"] = ["other_tool"]
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "inserted declaration cell does not match receipt" in "\n".join(_check(path))

    insertion["declarations"] = ["example_tool"]
    notebook["cells"][helper_index + 1]["source"] = "&`example_tool` and &`other_tool`"
    notebook_path.write_text(json.dumps(notebook), encoding="utf-8")
    assert "inserted declaration cell does not match receipt" in "\n".join(_check(path))


def test_scoped_execution_still_checks_all_source_mappings(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    rows = json.loads((path / "tool-coverage.json").read_text(encoding="utf-8"))
    rows["insert_tools"]["normal_example"]["notebook"] = "other.ipynb"
    (path / "tool-coverage.json").write_text(json.dumps(rows), encoding="utf-8")
    (path / "other.ipynb").write_text(json.dumps({"cells": [
        _code("insert_tools", "print(insert_tools())", executed=False),
    ]}), encoding="utf-8")

    assert validate_examples(path, require_executed=True,
                             public_tools={"example_tool"},
                             only_notebook="example.ipynb") == []
    assert "normal Python call was not executed" in "\n".join(
        validate_examples(path, require_executed=True,
                          public_tools={"example_tool"})
    )
    assert "normal Python call was not executed" in "\n".join(
        validate_examples(path, require_executed=True,
                          public_tools={"example_tool"},
                          only_notebook="other.ipynb")
    )

    (path / "other.ipynb").write_text(json.dumps({"cells": [
        _code("wrong-cell", "print(insert_tools())", executed=False),
    ]}), encoding="utf-8")
    assert "insert_tools: expected exactly one cell" in "\n".join(
        validate_examples(path, require_executed=True,
                          public_tools={"example_tool"},
                          only_notebook="example.ipynb")
    )


def test_scoped_execution_rejects_unknown_or_unsafe_notebook(tmp_path: Path) -> None:
    path = _fixture(tmp_path)
    for notebook in ("missing.ipynb", "../example.ipynb"):
        assert validate_examples(path, require_executed=True,
                                 public_tools={"example_tool"},
                                 only_notebook=notebook)


def test_published_examples_have_saved_real_execution_evidence() -> None:
    """The published catalog needs observed evidence for every nondeferred mode."""
    errors = validate_examples(PROJECT_ROOT / "examples", require_executed=True)
    summary = execution_deferral_summary(PROJECT_ROOT / "examples")
    assert not errors, summary + "\n" + "\n".join(errors)

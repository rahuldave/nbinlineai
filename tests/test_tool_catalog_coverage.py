"""Keep every registered tool linked to a concrete, discoverable notebook demo."""

import ast
import inspect
import json
import re
from pathlib import Path

import nbformat
import pytest
import tomllib

from nbinlineai.tools import TOOL_FUNCTIONS, insert_tools, tool_catalog, tools_markdown

ROOT = Path(__file__).resolve().parents[1]
COVERAGE = json.loads((ROOT / "examples/tool-coverage.json").read_text(encoding="utf-8"))
DOC = (ROOT / "docs/tools.md").read_text(encoding="utf-8")
FUNCTION_ROW = re.compile(r"^\| `(?P<signature>[a-z_]+\([^`]*\))` \| (?P<body>.*) \|$",
                          re.MULTILINE)
REFERENCE = re.compile(r"&`([A-Za-z_][A-Za-z_0-9]*)`")
HELPERS = {"tool_catalog": tool_catalog, "tools_markdown": tools_markdown,
           "insert_tools": insert_tools}


def test_registry_page_and_notebook_mapping_are_exact() -> None:
    expected = set(TOOL_FUNCTIONS) | set(HELPERS)
    assert set(COVERAGE) == expected
    rows = {signature.split("(", 1)[0]: signature for signature, _ in FUNCTION_ROW.findall(DOC)}
    assert set(rows) == set(TOOL_FUNCTIONS)
    for name, function in TOOL_FUNCTIONS.items():
        assert rows[name] == name + str(inspect.signature(function)).split(" ->", 1)[0]


def test_each_demo_has_matching_section_cell_call_and_page_link() -> None:
    rows = {signature.split("(", 1)[0]: body for signature, body in FUNCTION_ROW.findall(DOC)}
    for name, entry in COVERAGE.items():
        path = ROOT / "examples" / entry["notebook"]
        notebook = json.loads(path.read_text(encoding="utf-8"))
        nbformat.validate(notebook)
        cells = notebook["cells"]
        matches = [index for index, cell in enumerate(cells) if cell["id"] == entry["cell_id"]]
        assert len(matches) == 1, name
        index = matches[0]
        headings = ["".join(cell["source"]).splitlines()[0].lstrip("# ")
                    for cell in cells[:index] if cell["cell_type"] == "markdown"
                    and "".join(cell["source"]).startswith("#")]
        assert entry["section"] in headings, name
        assert demo_is_actionable(cells, index, name), name
        assert entry["execution"] in {
            "kernel", "model-frontend", "model-network", "model-optional-environment",
            "setup-kernel", "setup-ui-receipt",
        }, name
        assert entry["verification"], name
        assert entry["checkpoint_evidence"], name
        assert all((ROOT / test_path.split("::", 1)[0]).is_file()
                   for test_path in entry["verification"].values()), name
        if entry["execution"] in ("model-frontend", "setup-ui-receipt"):
            assert "browser" in entry["verification"], name
        if entry.get("setup_helper"):
            assert name in DOC
        else:
            assert row_has_exact_link(rows[name], entry), name


def test_offered_references_stay_under_limit_and_model_demos_are_actionable() -> None:
    for filename in {entry["notebook"] for entry in COVERAGE.values()}:
        cells = json.loads((ROOT / "examples" / filename).read_text(encoding="utf-8"))["cells"]
        assert_reference_limit(cells)


def active_tool_offers(cells: list[dict], index: int) -> set[str]:
    """Mirror tool discovery through one question, excluding answers and disabled cells."""
    offered: set[str] = set()
    for cell in cells[:index + 1]:
        if cell["cell_type"] != "markdown":
            continue
        ai = cell.get("metadata", {}).get("nbinlineai", {})
        if ai.get("isOutputCell") or ai.get("promptCellId") or ai.get("toolsInclude") is False:
            continue
        offered.update(REFERENCE.findall("".join(cell["source"])))
    return offered


def assert_reference_limit(cells: list[dict]) -> None:
    """Earlier AI-question references remain offered to lower questions."""
    for index, cell in enumerate(cells):
        if cell["cell_type"] != "markdown":
            continue
        ai = cell.get("metadata", {}).get("nbinlineai", {})
        if ai.get("isPromptCell"):
            assert len(active_tool_offers(cells, index)) <= 20, cell["id"]
    assert len(active_tool_offers(cells, len(cells) - 1)) <= 20


def demo_is_actionable(cells: list[dict], index: int, name: str) -> bool:
    """Require an executable call or an offered tool in an explicit AI action."""
    cell = cells[index]
    source = "".join(cell["source"])
    if cell["cell_type"] == "code":
        tree = ast.parse(source)
        return any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                   and node.func.id == name for node in ast.walk(tree))
    ai = cell.get("metadata", {}).get("nbinlineai", {})
    if not ai.get("isPromptCell") or ai.get("isOutputCell"):
        return False
    action = re.search(r"\b(?:use|call|run)\s+&?`?" + re.escape(name) + r"(?:`|\s*\()",
                       source, re.IGNORECASE)
    return action is not None and name in active_tool_offers(cells, index)


def row_has_exact_link(row: str, entry: dict) -> bool:
    """Keep the rendered notebook cell attached to the correct tool row."""
    url = ("https://rahuldave.com/nbinlineai/notebooks/"
           + entry["notebook"].removesuffix(".ipynb") + ".html#" + entry["cell_id"])
    expected = f"[Notebook example: § `{entry['section']}`, cell `{entry['cell_id']}`]({url})"
    return row.count("[Notebook example:") == 1 and expected in row


def _markdown(cell_id: str, source: str, ai: dict | None = None) -> dict:
    return {"cell_type": "markdown", "id": cell_id, "metadata": {"nbinlineai": ai or {}},
            "source": [source]}


@pytest.mark.parametrize("question", ["I know about read_cell.", "What is the next cell?"])
def test_rejects_missing_or_mention_only_demo(question: str) -> None:
    cells = [_markdown("declared", "&`read_cell`"),
             _markdown("question", question, {"isPromptCell": True})]
    assert not demo_is_actionable(cells, 1, "read_cell")


def test_code_string_is_not_a_tool_call() -> None:
    cells = [{"cell_type": "code", "id": "code", "metadata": {},
              "source": ['print("read_cell()")']}]
    assert not demo_is_actionable(cells, 0, "read_cell")


@pytest.mark.parametrize("metadata", [{"toolsInclude": False}, {"isOutputCell": True},
                                      {"promptCellId": "older-question"}])
def test_rejects_disabled_and_answer_declarations(metadata: dict) -> None:
    cells = [_markdown("not-offered", "&`read_cell`", metadata),
             _markdown("question", "Use `read_cell` now.", {"isPromptCell": True})]
    assert not demo_is_actionable(cells, 1, "read_cell")


def test_prior_question_references_count_toward_limit() -> None:
    cells = [_markdown(f"question-{n}", f"Use &`tool_{n}` now.", {"isPromptCell": True})
             for n in range(21)]
    with pytest.raises(AssertionError):
        assert_reference_limit(cells)


def test_swapped_notebook_links_are_rejected_per_row() -> None:
    rows = {signature.split("(", 1)[0]: body for signature, body in FUNCTION_ROW.findall(DOC)}
    first, second = COVERAGE["path_info"], COVERAGE["view_file"]
    assert row_has_exact_link(rows["path_info"], first)
    assert not row_has_exact_link(rows["view_file"], first)
    assert not row_has_exact_link(rows["path_info"], second)


def test_new_notebooks_are_in_source_and_installed_example_layout() -> None:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert "examples" in config["tool"]["hatch"]["build"]["targets"]["sdist"]["only-include"]
    shared = config["tool"]["hatch"]["build"]["targets"]["wheel"]["shared-data"]
    assert shared["examples"] == "share/doc/nbinlineai/examples"
    assert (ROOT / "examples/README.md").is_file()

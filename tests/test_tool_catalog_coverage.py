"""Keep every registered tool linked to a concrete, discoverable notebook demo."""

import inspect
import json
import re
from pathlib import Path

import nbformat
import tomllib

from nbinlineai.tools import TOOL_FUNCTIONS, insert_tools, tool_catalog, tools_markdown

ROOT = Path(__file__).resolve().parents[1]
COVERAGE = json.loads((ROOT / "examples/tool-coverage.json").read_text(encoding="utf-8"))
DOC = (ROOT / "docs/tools.md").read_text(encoding="utf-8")
FUNCTION_ROW = re.compile(r"^\| `([a-z_]+\([^`]*\))` \|", re.MULTILINE)
REFERENCE = re.compile(r"&`([A-Za-z_][A-Za-z_0-9]*)`")
HELPERS = {"tool_catalog": tool_catalog, "tools_markdown": tools_markdown,
           "insert_tools": insert_tools}


def test_registry_page_and_notebook_mapping_are_exact() -> None:
    expected = set(TOOL_FUNCTIONS) | set(HELPERS)
    assert set(COVERAGE) == expected
    rows = {row.split("(", 1)[0]: row for row in FUNCTION_ROW.findall(DOC)}
    assert set(rows) == set(TOOL_FUNCTIONS)
    for name, function in TOOL_FUNCTIONS.items():
        assert rows[name] == name + str(inspect.signature(function)).split(" ->", 1)[0]


def test_each_demo_has_matching_section_cell_call_and_page_link() -> None:
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
        source = "".join(cells[index]["source"])
        call = re.search(r"\b" + re.escape(name) + r"\s*\(", source)
        if cells[index]["cell_type"] == "code":
            assert call, name
        else:
            assert call or f"`{name}`" in source, name
            assert cell_has_tool_offer(cells, index, name), name
        assert entry["execution"] in {
            "kernel", "model-frontend", "model-network", "model-optional-environment",
            "setup-kernel", "setup-ui-receipt",
        }, name
        if entry.get("setup_helper"):
            assert name in DOC
        else:
            link = ("https://github.com/rahuldave/nbinlineai/blob/main/examples/"
                    + entry["notebook"])
            assert link in DOC
            assert f"cell `{entry['cell_id']}`" in DOC


def test_offered_references_stay_under_limit_and_model_demos_are_actionable() -> None:
    for filename in {entry["notebook"] for entry in COVERAGE.values()}:
        cells = json.loads((ROOT / "examples" / filename).read_text(encoding="utf-8"))["cells"]
        offered: set[str] = set()
        for cell in cells:
            if cell["cell_type"] != "markdown":
                continue
            source = "".join(cell["source"])
            names = set(REFERENCE.findall(source))
            if cell.get("metadata", {}).get("nbinlineai", {}).get("isPromptCell"):
                assert len(offered | names) <= 20, (filename, cell["id"])
            else:
                offered |= names
        assert len(offered) <= 20, filename


def cell_has_tool_offer(cells: list[dict], index: int, name: str) -> bool:
    """Recognize a current-question or earlier ordinary Markdown declaration."""
    for cell in cells[:index + 1]:
        if cell["cell_type"] == "markdown" and name in REFERENCE.findall("".join(cell["source"])):
            return True
    return False


def test_new_notebooks_are_in_source_and_installed_example_layout() -> None:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert "examples" in config["tool"]["hatch"]["build"]["targets"]["sdist"]["only-include"]
    shared = config["tool"]["hatch"]["build"]["targets"]["wheel"]["shared-data"]
    assert shared["examples"] == "share/doc/nbinlineai/examples"
    assert (ROOT / "examples/README.md").is_file()

"""Focused tests for the opt-in built-in tools."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from nbinlineai import tools


def _notebook(
    path: Path,  # Fixture file path.
    cells: list[dict],  # Saved notebook cells.
) -> Path:  # Written fixture path.
    """Write a minimal saved notebook for disk-only tool tests."""
    path.write_text(json.dumps({"cells": cells}), encoding="utf-8")
    return path


def test_registry_and_markdown_are_explicit() -> None:  # No accidental model tools.
    """Expose the curated registry while keeping default declarations within budget."""
    assert len(tools.TOOL_FUNCTIONS) == 51
    assert list(tools.TOOL_GROUPS["starter"]) == [
        "search_kernel_names", "list_notebooks", "find_notebook_cells", "read_notebook_cell",
        "inspect_python", "read_url", "path_info", "list_files", "view_file", "create_file",
        "file_str_replace", "file_insert_line", "file_replace_lines", "show_doc",
        "list_cells", "read_cell", "insert_markdown",
        "insert_code", "url_to_note",
    ]
    assert all(tools.TOOL_FUNCTIONS[name] is getattr(tools, name) for name in tools.TOOL_FUNCTIONS)
    assert set(tools.SPECIAL_TOOL_FUNCTIONS) == {
        "list_cells", "read_cell", "insert_markdown", "insert_code", "url_to_note",
        "find_cells", "replace_cell", "cell_str_replace", "cell_insert_line", "cell_replace_lines",
        "delete_cell", "move_cell", "copy_cell", "split_cell", "merge_cells"}
    markdown = tools.tools_markdown()
    assert markdown.count("&`") == 19
    assert "&`insert_code` — Insert an unexecuted code cell below the AI answer" in markdown
    assert "tools_markdown" not in markdown
    assert tools.tools_markdown(["read_notebook_cell"]).count("&`") == 1
    assert tools.tools_markdown([]) == "No built-in tools selected."
    with pytest.raises(ValueError, match="Unknown built-in tool"):
        tools.tools_markdown(["tools_markdown"])
    with pytest.raises(ValueError, match="must not be repeated"):
        tools.tools_markdown(["list_notebooks", "list_notebooks"])
    with pytest.raises(ValueError, match="at most 20"):
        tools.tools_markdown(list(tools.TOOL_FUNCTIONS))
    for group, names in tools.TOOL_GROUPS.items():
        assert len(names) <= 20
        assert set(names) <= tools.TOOL_FUNCTIONS.keys()
        assert tools.tools_markdown(group=group).count("&`") == len(names)
    assert "&`" not in tools.tool_catalog()
    assert "source_doc" in tools.tool_catalog("code")
    assert {"ast_search", "ast_rewrite", "file_ast_replace", "python_symbols"}.isdisjoint(tools.TOOL_FUNCTIONS)
    assert len(tools.TOOL_GROUPS["code"]) == 9
    with pytest.raises(ValueError, match="Unknown tool group"):
        tools.tools_markdown(group="missing")


def test_custom_reference_aliases_are_explicit_and_do_not_register() -> None:
    """List selected custom functions without adding them to the built-in registry."""
    def bonus(points: int) -> int:  # points: amount to add
        """Return an example bonus."""
        return points + 1

    markdown = tools.tools_markdown(
        ["search_kernel_names", "bonus_alias"], custom={"bonus_alias": bonus}
    )
    assert "&`search_kernel_names`" in markdown
    assert "&`bonus_alias` — Return an example bonus." in markdown
    assert "bonus_alias" not in tools.TOOL_FUNCTIONS
    with pytest.raises(ValueError, match="distinct public names"):
        tools.tools_markdown(custom={"read_url": bonus})
    with pytest.raises(ValueError, match="distinct public names"):
        tools.tools_markdown(custom={"__private": bonus})
    with pytest.raises(ValueError, match="Unknown built-in tool"):
        tools.tools_markdown(["missing"], custom={"bonus_alias": bonus})


def test_special_tool_stubs_require_an_ai_prompt() -> None:
    """Imported notebook mutators and live readers fail clearly when called directly."""
    for name, args in (
        ("list_cells", ()),
        ("read_cell", ("cell-1",)),
        ("insert_markdown", ("A note",)),
        ("insert_code", ("result = 1",)),
        ("url_to_note", ("https://docs.python.org/3/",)),
    ):
        with pytest.raises(RuntimeError, match="AI Prompt cell"):
            getattr(tools, name)(*args)
        assert tools.SPECIAL_TOOL_FUNCTIONS[name] is getattr(tools, name)


def test_inspect_python_resolves_explicit_names_without_evaluation(
    monkeypatch: pytest.MonkeyPatch,  # Fake kernel namespace.
) -> None:
    """Inspect docs and signatures without executing source-like input."""
    import IPython

    class Probe:
        """An object whose property must not be evaluated by inspection."""

        @property
        def danger(self) -> str:
            """Fail if dynamic attribute access occurs."""
            raise AssertionError("property was evaluated")

    def square(value: int) -> int:  # value: input integer
        """Return its square."""
        return value * value

    monkeypatch.setattr(IPython, "get_ipython", lambda: SimpleNamespace(user_ns={
        "square": square, "probe": Probe()
    }))
    assert "Return its square." in tools.inspect_python("square")
    assert "value: int" in tools.inspect_python("square", "signature")
    assert "def square" in tools.inspect_python("square", "source")
    assert "Fail if dynamic attribute access occurs." in tools.inspect_python("probe.danger")
    with pytest.raises(ValueError, match="public Python identifier"):
        tools.inspect_python("square(); import os")
    with pytest.raises(ValueError, match="public Python identifier"):
        tools.inspect_python("square.__globals__")
    with pytest.raises(ValueError, match="section"):
        tools.inspect_python("square", "invented")


def test_read_url_is_an_ordinary_bounded_python_tool(
    monkeypatch: pytest.MonkeyPatch,  # Fake public fetch without network access.
) -> None:
    """The direct Python tool shares source-attributed fetch and bridge limits."""
    expected_url = "https://docs.python.org/3/library/statistics.html"

    def fake_fetch(url: str) -> str:  # url: requested public page
        """Provide an oversized harmless page excerpt."""
        assert url == expected_url
        return f"Source: {url}\n\n" + ("sample detail\n" * 1000)

    monkeypatch.setattr(tools, "fetch_url_markdown", fake_fetch)
    result = tools.read_url(expected_url)
    assert result.startswith(f"Source: {expected_url}")
    assert len(result) <= tools.MAX_RESULT_CHARS
    assert "truncated; use url_to_note" in result


def test_search_kernel_names_uses_names_and_types_only(
    monkeypatch: pytest.MonkeyPatch,  # Fake active IPython shell.
) -> None:  # No private value should appear.
    """Search case-insensitively without calling repr on values."""
    import IPython

    class Secret:
        def __repr__(self) -> str:  # Redacted value representation.
            """Fail if a value representation is requested."""
            raise AssertionError("value repr must not be called")

    monkeypatch.setattr(IPython, "get_ipython", lambda: SimpleNamespace(
        user_ns={"MyScore": Secret(), "other": 2, "_hiddenScore": 3, "score2": 4}
    ))
    result = tools.search_kernel_names("SCORE", limit=1)
    assert "MyScore (Secret)" in result
    assert "more names" in result
    assert "_hiddenScore" not in result
    with pytest.raises(ValueError, match="limit"):
        tools.search_kernel_names("score", limit=0)
    monkeypatch.setattr(IPython, "get_ipython", lambda: None)
    with pytest.raises(RuntimeError, match="active IPython kernel"):
        tools.search_kernel_names("score")


def test_list_notebooks_is_bounded_and_skips_hidden_paths(
    tmp_path: Path,  # Root of an isolated notebook tree.
) -> None:  # Only intended saved paths appear.
    """Traverse a chosen directory without following hidden or symlinked trees."""
    _notebook(tmp_path / "a.ipynb", [])
    child = tmp_path / "lesson"
    child.mkdir()
    _notebook(child / "b.ipynb", [])
    hidden = tmp_path / ".venv"
    hidden.mkdir()
    _notebook(hidden / "secret.ipynb", [])
    (tmp_path / "linked").symlink_to(child, target_is_directory=True)
    result = tools.list_notebooks(str(tmp_path))
    assert "a.ipynb" in result and "lesson/b.ipynb" in result
    assert "secret.ipynb" not in result and "linked" not in result
    assert "more notebooks" in tools.list_notebooks(str(tmp_path), limit=1)
    with pytest.raises(ValueError, match="existing directory"):
        tools.list_notebooks(str(tmp_path / "missing"))


def test_find_and_read_saved_source_with_index_fallback(
    tmp_path: Path,  # Isolated saved notebook directory.
) -> None:  # Source results distinguish saved content.
    """Find literal source and read numbered lines without including outputs."""
    path = _notebook(tmp_path / "lesson.ipynb", [
        {"cell_type": "code", "id": "same", "source": ["score = 2\n", "print(score)\n"],
         "outputs": [{"data": {"text/plain": ["PRIVATE OUTPUT"]}}]},
        {"cell_type": "markdown", "id": "same", "source": "SCORE explanation"},
        {"cell_type": "code", "source": "score = 3"},
    ])
    found = tools.find_notebook_cells(str(path), "ScOrE", limit=2)
    assert "index:0 id:same" in found and "index:1 id:same" in found
    assert "more matching cells" in found
    assert "PRIVATE OUTPUT" not in found
    with pytest.raises(ValueError, match="duplicated"):
        tools.read_notebook_cell(str(path), "same")
    read = tools.read_notebook_cell(str(path), "index:0", 1, 1)
    assert "Saved source" in read and "1: score = 2" in read
    assert "PRIVATE OUTPUT" not in read and "later lines" in read
    assert "index:2" in tools.read_notebook_cell(str(path), "index:2")
    with pytest.raises(ValueError, match="absent"):
        tools.read_notebook_cell(str(path), "missing")
    with pytest.raises(ValueError, match="Line range"):
        tools.read_notebook_cell(str(path), "index:0", 0, 40)


def test_malformed_and_large_files_fail_clearly(
    tmp_path: Path,  # Isolated file directory.
) -> None:  # Bad input has clear bounded errors.
    """Reject malformed JSON and large saved files before parsing."""
    broken = tmp_path / "broken.ipynb"
    broken.write_text("{", encoding="utf-8")
    with pytest.raises(ValueError, match="Could not read"):
        tools.find_notebook_cells(str(broken), "score")
    wrong = tmp_path / "wrong.ipynb"
    wrong.write_text('{"cells": {}}', encoding="utf-8")
    with pytest.raises(TypeError, match="valid cells list"):
        tools.find_notebook_cells(str(wrong), "score")
    large = tmp_path / "large.ipynb"
    with large.open("wb") as stream:
        stream.truncate(tools.MAX_NOTEBOOK_BYTES + 1)
    with pytest.raises(ValueError, match="too large"):
        tools.read_notebook_cell(str(large), "index:0")


def test_read_result_has_visible_truncation(
    tmp_path: Path,  # Isolated notebook directory.
) -> None:  # Long source is never silently cut.
    """Keep a long line below the tool bridge cap and explain truncation."""
    path = _notebook(tmp_path / "long.ipynb", [
        {"cell_type": "code", "id": "long", "source": "x" * 5_000}
    ])
    result = tools.read_notebook_cell(str(path), "long")
    assert len(result) <= tools.MAX_RESULT_CHARS
    assert "truncated; request a narrower line range" in result


def test_repr_budget_and_empty_saved_cell(
    tmp_path: Path,  # Isolated notebook directory.
) -> None:  # Both results fit the bridge and remain explanatory.
    """Account for repr escaping and allow legitimate empty saved cells."""
    path = _notebook(tmp_path / "special.ipynb", [
        {"cell_type": "code", "id": "escaped", "source": ("\\\x00" * 2_000)},
        {"cell_type": "markdown", "id": "empty", "source": ""},
    ])
    result = tools.read_notebook_cell(str(path), "escaped")
    assert len(repr(result)) <= 4_000
    assert "truncated; request a narrower line range" in result
    assert "empty saved cell source" in tools.read_notebook_cell(str(path), "empty")

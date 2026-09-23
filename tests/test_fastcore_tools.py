"""Focused contracts for bounded, opt-in fastcore notebook tools."""

import stat
from pathlib import Path

import pytest

from nbinlineai.fastcore_tools import (
    FASTCORE_TOOL_FUNCTIONS,
    create_file,
    file_insert_line,
    file_replace_lines,
    file_str_replace,
    list_files,
    path_info,
    show_doc,
    view_file,
)


def test_registry_and_relative_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert list(FASTCORE_TOOL_FUNCTIONS) == [
        "path_info", "list_files", "view_file", "create_file", "file_str_replace",
        "file_insert_line", "file_replace_lines", "show_doc",
    ]
    assert f"Kernel cwd: {tmp_path}" in path_info()
    assert f"Resolved path: {tmp_path / 'missing'}" in path_info("missing")
    assert "Type: missing" in path_info("missing")
    created = create_file("sub/hello.txt", "café\nsecond\n")
    assert str(tmp_path / "sub/hello.txt") in created
    assert "Type: file" in path_info("sub/hello.txt")
    assert "13 bytes" in path_info("sub/hello.txt")
    assert "1: café" in view_file("sub/hello.txt")


def test_list_files_filters_and_bounds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "sub").mkdir()
    (tmp_path / ".venv").mkdir()
    (tmp_path / "sub" / "keep.py").write_text("pass\n")
    (tmp_path / "sub" / "other.txt").write_text("x")
    (tmp_path / ".venv" / "hidden.py").write_text("x")
    (tmp_path / ".hidden.py").write_text("x")
    (tmp_path / "linked").symlink_to(tmp_path / "sub", target_is_directory=True)
    assert "sub/" in list_files()
    result = list_files(pattern="*.py", recursive=True)
    assert "sub/keep.py" in result
    assert "hidden.py" not in result
    assert "linked/keep.py" not in result
    for number in range(4):
        (tmp_path / f"visible{number}.txt").write_text("x")
    assert "[partial results" in list_files(pattern="*.txt", limit=2)
    with pytest.raises(TypeError, match="recursive must"):
        list_files(recursive=1)


def test_list_files_depth_and_traversal_notice(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import nbinlineai.fastcore_tools as tools

    deep = tmp_path
    for _ in range(6):
        deep /= "child"
        deep.mkdir()
    assert "[partial results" in list_files(str(tmp_path), recursive=True)
    for number in range(8):
        (tmp_path / f"item{number}.txt").write_text("x")
    monkeypatch.setattr(tools, "MAX_VISITED", 3)
    assert "[partial results" in list_files(str(tmp_path), recursive=True)


def test_view_file_utf8_and_line_limits(tmp_path: Path) -> None:
    target = tmp_path / "note.txt"
    target.write_text("one\ntwo\nthree\n", encoding="utf-8")
    assert "2: two" in view_file(str(target), 2, 2)
    assert "later lines" in view_file(str(target), 2, 2)
    with pytest.raises(ValueError, match="80 lines"):
        view_file(str(target), 1, 81)
    target.write_bytes(b"\xff")
    with pytest.raises(ValueError, match="UTF-8"):
        view_file(str(target))
    target.write_bytes(b"abc\x00def")
    with pytest.raises(ValueError, match="NUL"):
        view_file(str(target))
    target.write_bytes(b"x" * 1_000_001)
    with pytest.raises(ValueError, match="1 MB"):
        view_file(str(target))


def test_create_no_clobber_and_notebook_targets(tmp_path: Path) -> None:
    target = tmp_path / "thing.txt"
    create_file(str(target), "first")
    with pytest.raises(ValueError, match="already exists"):
        create_file(str(target), "second")
    assert target.read_text() == "first"
    with pytest.raises(ValueError, match="8000"):
        create_file(str(tmp_path / "large.txt"), "x" * 8_001)
    for bad in ("bad\x00text", "bad\ud800text"):
        invalid = tmp_path / "invalid.txt"
        with pytest.raises(ValueError, match="NUL|UTF-8"):
            create_file(str(invalid), bad)
        assert not invalid.exists()
    notebook = tmp_path / "live.ipynb"
    notebook.write_text("{}")
    alias = tmp_path / "alias.txt"
    alias.symlink_to(notebook)
    disguised = tmp_path / "disguised.ipynb"
    disguised.symlink_to(target)
    dangling = tmp_path / "dangling.txt"
    dangling.symlink_to(tmp_path / "not-yet-created.txt")
    with pytest.raises(ValueError, match="already exists"):
        create_file(str(dangling), "unexpected")
    assert not (tmp_path / "not-yet-created.txt").exists()
    for operation in (
        lambda: create_file(str(tmp_path / "new.ipynb"), "{}"),
        lambda: file_str_replace(str(alias), "{", "["),
        lambda: file_insert_line(str(notebook), 0, "x"),
        lambda: file_replace_lines(str(notebook), 1, 1, "x"),
        lambda: file_str_replace(str(disguised), "first", "last"),
    ):
        with pytest.raises(ValueError, match="JupyterLab"):
            operation()
    assert notebook.read_text() == "{}"


def test_exact_replace_and_atomic_permissions(tmp_path: Path) -> None:
    target = tmp_path / "edit.txt"
    target.write_text("old\nold\n", encoding="utf-8")
    target.chmod(0o640)
    with pytest.raises(ValueError, match="found 2"):
        file_str_replace(str(target), "old", "new")
    assert target.read_text() == "old\nold\n"
    result = file_str_replace(str(target), "old", "new", expected_matches=2)
    assert "Updated:" in result and "new" in result
    assert target.read_text() == "new\nnew\n"
    assert stat.S_IMODE(target.stat().st_mode) == 0o640
    with pytest.raises(ValueError, match="old_str must not be empty"):
        file_str_replace(str(target), "", "x")
    with pytest.raises(ValueError, match="found 0"):
        file_str_replace(str(target), "absent", "x")


def test_stale_change_aborts_before_atomic_write(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import nbinlineai.fastcore_tools as tools

    target = tmp_path / "stale.txt"
    target.write_text("original")
    original_replace = tools.str_replace

    def concurrent_change(text: str, old: str, new: str) -> str:
        target.write_text("someone else's change")
        return original_replace(text, old, new)

    monkeypatch.setattr(tools, "str_replace", concurrent_change)
    with pytest.raises(ValueError, match="changed since it was read"):
        file_str_replace(str(target), "original", "edited")
    assert target.read_text() == "someone else's change"


def test_failed_replace_keeps_old_file_and_cleans_stage(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import nbinlineai.fastcore_tools as tools

    target = tmp_path / "replace.txt"
    target.write_text("before")

    def fail_replace(_source: Path, _destination: Path) -> None:
        raise OSError("simulated replace failure")

    monkeypatch.setattr(tools.os, "replace", fail_replace)
    with pytest.raises(OSError, match="simulated"):
        file_str_replace(str(target), "before", "after")
    assert target.read_text() == "before"
    assert list(tmp_path.iterdir()) == [target]


def test_line_edits_validate_before_write(tmp_path: Path) -> None:
    target = tmp_path / "lines.txt"
    target.write_text("one\ntwo\nthree\n")
    with pytest.raises(ValueError, match="line must"):
        file_insert_line(str(target), 4, "x")
    with pytest.raises(ValueError, match="Line range"):
        file_replace_lines(str(target), 2, 4, "x")
    assert target.read_text() == "one\ntwo\nthree\n"
    file_insert_line(str(target), 0, "zero")
    assert target.read_text().startswith("zero\none\n")
    file_replace_lines(str(target), 2, 3, "replacement")
    assert target.read_text() == "zero\nreplacement\nthree\n"
    crlf = tmp_path / "windows.txt"
    crlf.write_bytes(b"one\r\ntwo\r\n")
    file_insert_line(str(crlf), 1, "middle")
    assert crlf.read_bytes() == b"one\r\nmiddle\r\ntwo\r\n"
    file_replace_lines(str(crlf), 2, 2, "replacement")
    assert crlf.read_bytes() == b"one\r\nreplacement\r\ntwo\r\n"
    bare_cr = tmp_path / "classic-mac.txt"
    bare_cr.write_bytes(b"one\rtwo\r")
    file_replace_lines(str(bare_cr), 2, 2, "replacement")
    assert bare_cr.read_bytes() == b"one\rreplacement\r"


def test_show_doc_live_names_and_no_property_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    import IPython

    calls = []

    def square(value: int) -> int:  # value: number to square
        """Return a square.

        Parameters
        ----------
        value : int
            The input value.
        """
        calls.append(value)
        return value * value

    class Unsafe:
        @property
        def value(self):
            calls.append("property")
            return 1

    class Shell:
        def __init__(self) -> None:
            self.user_ns = {"square": square, "unsafe": Unsafe()}

    monkeypatch.setattr(IPython, "get_ipython", lambda: Shell())
    result = show_doc("square")
    assert "Return a square" in result
    assert "value" in result
    assert "The input value" in result
    assert "```python" in result._repr_markdown_()
    assert "Return the number of items" in show_doc("len")
    assert calls == []
    assert "property" not in show_doc("unsafe.value")
    assert calls == []


def test_show_doc_imported_module_and_limits() -> None:
    module_doc = show_doc("", module="json")
    assert "JSON" in module_doc
    assert "Public names:" in module_doc
    symbol_doc = show_doc("dumps", module="json")
    assert "Serialize" in symbol_doc
    assert "```python" in symbol_doc._repr_markdown_()
    with pytest.raises(ValueError, match="not installed"):
        show_doc("", module="module_that_does_not_exist_for_nbinlineai")
    with pytest.raises(ValueError, match="public dotted"):
        show_doc("", module="os.system('x')")
    assert len(show_doc("dumps", module="json")) <= 3_200
    assert len(repr(show_doc("dumps", module="json"))) <= 3_900


def test_show_doc_checks_name_before_import(monkeypatch: pytest.MonkeyPatch) -> None:
    import nbinlineai.fastcore_tools as tools

    imported = []
    monkeypatch.setattr(tools.importlib, "import_module", lambda name: imported.append(name))
    for invalid in (None, 1, "_private", "a()", "a" * 201):
        with pytest.raises(ValueError, match="name must"):
            show_doc(invalid, module="json")
    assert imported == []


def test_show_doc_unresolved_forward_annotation(monkeypatch: pytest.MonkeyPatch) -> None:
    import IPython

    def forward(value):
        """Works despite an unresolved annotation and unavailable source at runtime."""

    forward.__annotations__ = {"value": "AbsentType", "return": "AbsentType"}

    class Shell:
        def __init__(self) -> None:
            self.user_ns = {"forward": forward}

    monkeypatch.setattr(IPython, "get_ipython", lambda: Shell())
    result = show_doc("forward")
    assert "AbsentType" in result
    assert "unresolved annotation" in result
    assert result == result._repr_markdown_()


def test_docments_supports_parameter_comments_and_long_output(monkeypatch: pytest.MonkeyPatch) -> None:
    import IPython

    def explained(value: int = 2):  # value: a labeled parameter
        """A long description."""

    explained.__doc__ = "A long description. " + "x" * 10_000

    class Shell:
        def __init__(self) -> None:
            self.user_ns = {"explained": explained}

    monkeypatch.setattr(IPython, "get_ipython", lambda: Shell())
    result = show_doc("explained")
    assert "a labeled parameter" in result
    assert "truncated" in result
    assert len(result) <= 3_200
    assert len(repr(result)) <= 3_900
    assert result == result._repr_markdown_()
    assert result.count("```") % 2 == 0

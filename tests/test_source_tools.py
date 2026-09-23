"""Focused boundaries for source and saved-document tools."""

import hashlib
import json
from pathlib import Path

import pytest
import rgapi

from nbinlineai import source_tools
from nbinlineai.source_tools import (
    ast_rewrite,
    ast_search,
    document_outline,
    file_ast_replace,
    file_replace_checked,
    file_strs_replace,
    notebook_outline,
    python_symbols,
    read_document_section,
    search_files,
    search_notebooks,
    source_doc,
    view_file_hashes,
)


def test_saved_search_and_notebook_ids(tmp_path: Path):
    (tmp_path / 'module.py').write_text('needle = "a.b"\n', encoding='utf-8')
    notebook = {'cells': [{'cell_type': 'markdown', 'id': 'stable-id', 'source': ['find me']},
                          {'cell_type': 'code', 'id': 'other-id', 'source': ['print(1)']}],
                'metadata': {}, 'nbformat': 4, 'nbformat_minor': 5}
    (tmp_path / 'book.ipynb').write_text(json.dumps(notebook), encoding='utf-8')
    assert 'module.py:1:' in search_files('a.b', str(tmp_path))
    assert 'module.py:1:' in search_files(r'a\.b', str(tmp_path), pattern='*.py', regex=True)
    assert 'stable-id' in search_notebooks('find me', str(tmp_path))
    assert 'stable-id' in notebook_outline(str(tmp_path / 'book.ipynb'))
    assert 'other-id' in notebook_outline(str(tmp_path / 'book.ipynb'), start=1, limit=1)
    assert 'stable-id' not in notebook_outline(str(tmp_path / 'book.ipynb'), start=1, limit=1)


def test_ast_search_preview_and_checked_rewrite(tmp_path: Path):
    file = tmp_path / 'example.py'
    file.write_text('def f(x):\n    return foo(x)\n', encoding='utf-8')
    assert f'{file}:2: foo(x)' in ast_search('foo($X)', str(tmp_path))
    assert '+bar(x)' in ast_rewrite('foo(x)\n', 'foo($X)', 'bar($X)')
    original = file.read_text()
    with pytest.raises(ValueError, match='Expected 2'):
        file_ast_replace(str(file), 'foo($X)', 'bar($X)', expected_matches=2)
    assert file.read_text() == original
    assert 'Updated:' in file_ast_replace(str(file), 'foo($X)', 'bar($X)')
    assert 'bar(x)' in file.read_text()
    with pytest.raises(ValueError, match='not its .ipynb file'):
        file_ast_replace(str(tmp_path / 'book.ipynb'), 'foo($X)', 'bar($X)')


def test_static_source_and_document_sections(tmp_path: Path):
    code = tmp_path / 'source.py'
    code.write_text('"""Module docs."""\n\ndef f(x):\n    """Function docs."""\n    return x\n', encoding='utf-8')
    assert 'Function docs.' in source_doc(str(code), 'f')
    assert 'f' in python_symbols(str(code))
    assert 'x' in python_symbols(str(code), kind='references')
    md = tmp_path / 'notes.md'
    md.write_text('# Title\nIntro\n## Details\nBody [link](https://example.org)\n', encoding='utf-8')
    outline = document_outline(str(md))
    assert 'Details' in outline
    assert 'Details' in document_outline(str(md), start=2, limit=1)
    address = next(line.split()[0] for line in outline.splitlines() if 'Details' in line)
    assert 'Body' in read_document_section(str(md), address)
    assert 'Intro' in read_document_section(str(md))
    md.write_text('# Changed\n', encoding='utf-8')
    with pytest.raises(ValueError, match='missing or stale'):
        read_document_section(str(md), address)


def test_batch_and_digest_edits_are_checked(tmp_path: Path):
    file = tmp_path / 'text.txt'
    file.write_text('alpha beta\n', encoding='utf-8')
    with pytest.raises(ValueError, match='Expected one match'):
        file_strs_replace(str(file), ['alpha', 'missing'], ['A', 'M'])
    assert file.read_text() == 'alpha beta\n'
    assert 'Updated:' in file_strs_replace(str(file), ['alpha', 'beta'], ['A', 'B'])
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    assert digest in view_file_hashes(str(file))
    assert '1: A B' in view_file_hashes(str(file), start_line=1, end_line=1)
    with pytest.raises(ValueError, match='SHA-256 changed'):
        file_replace_checked(str(file), 'A', 'C', '0' * 64)
    assert file.read_text() == 'A B\n'
    assert 'Updated:' in file_replace_checked(str(file), 'A', 'C', digest)
    assert file.read_text() == 'C B\n'
    file.write_text('one two\n', encoding='utf-8')
    file_strs_replace(str(file), ['one', 'two'], ['two', 'three'])
    assert file.read_text() == 'two three\n'


def test_search_reports_upstream_partial_results(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    class Partial(list):
        stop_reason = 'timeout'
        complete = False

    monkeypatch.setattr(rgapi, 'rg', lambda *args, **kwargs: Partial())
    assert 'partial results: timeout' in search_files('anything', str(tmp_path))
    monkeypatch.setattr(rgapi, 'nbrg', lambda *args, **kwargs: Partial())
    assert 'partial results: timeout' in search_notebooks('anything', str(tmp_path))


def test_ast_traversal_cap_reports_partial(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / 'a.py').write_text('x = 1\n', encoding='utf-8')
    (tmp_path / 'b.py').write_text('x = 2\n', encoding='utf-8')
    monkeypatch.setattr(source_tools, 'MAX_VISITED', 1)
    assert 'partial results' in ast_search('other($X)', str(tmp_path))


def test_source_docs_preserve_source_signature_without_import(tmp_path: Path):
    marker = tmp_path / 'imported.txt'
    file = tmp_path / 'module.py'
    file.write_text(
        f'from pathlib import Path\nPath({str(marker)!r}).write_text("side effect")\n'
        'class Public:\n'
        '    """Class docs."""\n'
        '    def method(self, x: int = 3) -> str:\n'
        '        """Method docs."""\n'
        '        return str(x)\n'
        'def helper(\n'
        '    size: int = 4,  # size in units\n'
        ') -> int:\n'
        '    """Help."""\n'
        '    return size\n', encoding='utf-8')
    text = source_doc(str(file), 'helper')
    assert 'size: int = 4' in text and '# size in units' in text and ') -> int:' in text
    assert 'method (line' in source_doc(str(file), 'Public')
    assert 'Public (line' in source_doc(str(file))
    assert not marker.exists()


def test_malformed_notebook_and_overlap_leave_files_unchanged(tmp_path: Path):
    notebook = tmp_path / 'bad.ipynb'
    notebook.write_text('{"cells": [{"cell_type": "code", "source": [9]}]}', encoding='utf-8')
    with pytest.raises(ValueError, match='malformed'):
        notebook_outline(str(notebook))
    file = tmp_path / 'text.txt'
    file.write_text('abc\r\n', encoding='utf-8', newline='')
    with pytest.raises(ValueError, match='overlap'):
        file_strs_replace(str(file), ['ab', 'abc'], ['X', 'Y'])
    assert file.read_bytes() == b'abc\r\n'
    assert 'Updated:' in file_replace_checked(str(file), 'ab', 'xy', hashlib.sha256(file.read_bytes()).hexdigest())
    assert file.read_bytes() == b'xyc\r\n'


def test_deep_ast_tree_reports_partial(tmp_path: Path):
    directory = tmp_path
    for index in range(source_tools.MAX_DEPTH + 1):
        directory = directory / f'd{index}'
        directory.mkdir()
    (directory / 'hidden.py').write_text('foo(1)\n', encoding='utf-8')
    result = ast_search('foo($X)', str(tmp_path))
    assert 'partial results' in result
    assert 'hidden.py' not in result


def test_large_ast_file_is_bounded_before_parse(tmp_path: Path):
    file = tmp_path / 'large.py'
    file.write_text('x = 1\n' * 25_000, encoding='utf-8')
    assert 'partial results' in ast_search('x = 1', str(tmp_path))
    original = file.read_bytes()
    with pytest.raises(ValueError, match='128 KB'):
        file_ast_replace(str(file), 'x = 1', 'x = 2')
    assert file.read_bytes() == original

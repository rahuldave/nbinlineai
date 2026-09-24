"""Focused boundaries for source and saved-document tools."""

import hashlib
import json
from pathlib import Path

import pytest

from nbinlineai.source_tools import (
    document_outline,
    file_replace_checked,
    file_strs_replace,
    notebook_outline,
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


def test_static_source_and_document_sections(tmp_path: Path):
    code = tmp_path / 'source.py'
    code.write_text('"""Module docs."""\n\ndef f(x):\n    """Function docs."""\n    return x\n', encoding='utf-8')
    assert 'Function docs.' in source_doc(str(code), 'f')
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

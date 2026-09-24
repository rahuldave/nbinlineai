"""The document outline reads source text without evaluating it."""

from pathlib import Path

import pytest

from nbinlineai._documents import build_document


def _address(row: str) -> str:
    return row.split()[0]


def test_markdown_headings_fences_setext_and_descendants():
    source = (
        'Preface\n# Main\nintro\n```md\n# Not a heading\n```\n'
        'Subsection\n----------\ninside\n### Detail\nleaf\n# Later\nlast\n'
    )
    document = build_document(source, Path('notes.md'))
    rows = document.outline_rows
    assert len(rows) == 5  # Root plus four genuine headings.
    assert 'Main' in rows[1]
    assert 'Subsection' in rows[2]
    assert 'Detail' in rows[3]
    assert 'Later' in rows[4]
    assert document.read(_address(rows[1])).startswith('# Main\n')
    assert '### Detail\nleaf\n' in document.read(_address(rows[1]))
    assert '# Later' not in document.read(_address(rows[1]))
    assert document.read(_address(rows[2])).startswith('Subsection\n----------\n')
    assert document.read('') == source
    assert document.read(document.root_token) == source


def test_duplicate_headings_have_distinct_addresses_and_stale_tokens_fail():
    source = '# Repeat\none\n# Repeat\ntwo\n'
    first = build_document(source, Path('notes.markdown'))
    first_token, second_token = (_address(row) for row in first.outline_rows[1:])
    assert first_token != second_token
    assert first.read(first_token) == '# Repeat\none\n'
    assert first.read(second_token) == '# Repeat\ntwo\n'
    changed = build_document(source + 'new\n', Path('notes.markdown'))
    with pytest.raises(ValueError, match='missing or stale'):
        changed.read(first_token)
    for invalid in ('s:bad:1', 's:' + '0' * 64 + ':1', first.root_token + ':1',
                    _address(first.outline_rows[2])[:-1] + '99'):
        with pytest.raises(ValueError, match='missing or stale'):
            first.read(invalid)


def test_many_markdown_headings_keep_exact_boundaries():
    source = '# Root\n' + ''.join(f'## Item {index}\nbody {index}\n' for index in range(20_000))
    assert len(source.encode('utf-8')) < 1_000_000
    document = build_document(source, Path('large.md'))
    assert len(document.outline_rows) == 20_002
    assert document.read(_address(document.outline_rows[1])) == source
    assert document.read(_address(document.outline_rows[-1])) == '## Item 19999\nbody 19999\n'
    assert document.read(_address(document.outline_rows[-2])) == '## Item 19998\nbody 19998\n'


def test_python_decorators_async_nesting_and_no_execution(tmp_path: Path):
    marker = tmp_path / 'executed'
    source = (
        f"open({str(marker)!r}, 'w').write('oops')\n"
        '@decorator\nasync def outer():\n'
        '    class Inner:\n'
        '        @property\n'
        '        def value(self):\n'
        '            return 7\n'
        '    return Inner\n'
        '\nclass Next:\n    pass\n'
    )
    document = build_document(source, tmp_path / 'module.py')
    assert not marker.exists()
    rows = document.outline_rows
    assert [row.split(' (lines')[0].split()[-2:] for row in rows[1:]] == [
        ['def', 'outer'], ['class', 'Inner'], ['def', 'value'], ['class', 'Next']
    ]
    outer = document.read(_address(rows[1]))
    assert outer.startswith('@decorator\nasync def outer():')
    assert 'return 7' in outer
    assert 'class Next' not in outer
    assert document.read(_address(rows[3])).startswith('        @property\n')


def test_deep_valid_python_expression_does_not_overflow_outline_walk():
    source = 'result = ' + '+'.join(['x'] * 1_200) + '\n'
    document = build_document(source, Path('deep.py'))
    assert document.read('') == source
    assert len(document.outline_rows) == 1


@pytest.mark.parametrize('source,suffix', [('', '.md'), ('plain text\n', '.md'), ('', '.py'), ('x = 1\n', '.py')])
def test_empty_and_unsectioned_documents_have_root(source: str, suffix: str):
    document = build_document(source, Path('file' + suffix))
    assert len(document.outline_rows) == 1
    assert document.read('') == source
    assert document.read(document.root_token) == source


def test_unsupported_documents_and_syntax_error():
    with pytest.raises(ValueError, match='notebook_outline'):
        build_document('{}', Path('book.ipynb'))
    with pytest.raises(ValueError, match='only Markdown'):
        build_document('text', Path('file.txt'))
    with pytest.raises(ValueError, match='syntax error'):
        build_document('def broken(:\n', Path('broken.py'))

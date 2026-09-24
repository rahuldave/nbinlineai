"""Bounded, opt-in search, source analysis, and checked file tools."""

import ast
import hashlib
import io
import json
import re
import tokenize
from types import MappingProxyType
from typing import Any

from ._tool_helpers import _bounded, _text
from .fastcore_tools import (
    _editable_path,
    _new_content,
    _path,
    _read_file,
    _write_changed,
)

MAX_SEARCH_RESULTS = 50


def _positive(value: int, name: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f"{name} must be an integer from 1 to {maximum}")
    return value


def _nonnegative(value: int, name: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
        raise ValueError(f"{name} must be an integer from 0 to {maximum}")
    return value


def search_files(
    query: str,  # Text or regular expression to find.
    path: str = ".",  # Saved file or directory on the kernel machine.
    pattern: str = "*",  # File name glob.
    regex: bool = False,  # Interpret query as a regular expression.
    limit: int = 20,  # Maximum matches.
) -> str:
    """Search saved project text with bounded results and file filters."""
    from ._search import search

    query = _text(query, 'query', 500)
    pattern = _text(pattern, 'pattern', 200)
    limit = _positive(limit, 'limit', MAX_SEARCH_RESULTS)
    if not isinstance(regex, bool):
        raise TypeError('regex must be true or false')
    root = _path(path)
    if not root.exists():
        raise ValueError(f'Path does not exist: {root}')
    rows, tail = search(root, query, pattern, regex, limit, notebooks=False)
    return _bounded(f'Saved-file matches under {root}:\n' + ('\n'.join(rows) or '[none]') + tail)


def search_notebooks(
    query: str,  # Literal cell-source text.
    path: str = ".",  # Saved notebook or directory.
    limit: int = 20,  # Maximum matching cells.
) -> str:
    """Search saved notebook cell source; include stable saved cell IDs."""
    from ._search import search

    query = _text(query, 'query', 500)
    limit = _positive(limit, 'limit', MAX_SEARCH_RESULTS)
    root = _path(path)
    if not root.exists():
        raise ValueError(f'Path does not exist: {root}')
    rows, tail = search(root, query, "*.ipynb", False, limit, notebooks=True)
    return _bounded(f'Saved notebook matches under {root}:\n' + ('\n'.join(rows) or '[none]') + tail)


def _declaration_header(source: str, node: ast.AST) -> str:
    """Copy the actual header, including annotations, defaults and comments."""
    lines = source.splitlines(keepends=True)
    start = node.lineno - 1
    segment = ''.join(lines[start:min(start + 80, len(lines))])
    depth = 0
    try:
        tokens = tokenize.generate_tokens(io.StringIO(segment).readline)
        for token in tokens:
            if token.type == tokenize.OP:
                if token.string in '([{':
                    depth += 1
                elif token.string in ')]}':
                    depth -= 1
                elif token.string == ':' and depth == 0:
                    offset = sum(len(line) for line in segment.splitlines(keepends=True)[:token.end[0] - 1]) + token.end[1]
                    return segment[:offset].strip()[:1_500]
    except tokenize.TokenError:
        pass
    return lines[start].strip()[:1_500]


def _public_declarations(node: ast.AST) -> list[str]:
    result: list[str] = []
    for child in getattr(node, 'body', []):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not child.name.startswith('_'):
            result.append(f'{child.name} (line {child.lineno})')
        elif isinstance(child, (ast.Assign, ast.AnnAssign)):
            targets = child.targets if isinstance(child, ast.Assign) else [child.target]
            for target in targets:
                if isinstance(target, ast.Name) and not target.id.startswith('_'):
                    result.append(f'{target.id} (line {child.lineno})')
        if len(result) >= 100:
            break
    return result


def source_doc(
    path: str,  # Saved Python source file.
    symbol: str = '',  # Dotted definition name, or empty for module.
) -> str:
    """Read Python source documentation statically, without importing the file."""
    target = _path(path)
    if target.suffix.lower() != '.py':
        raise ValueError('path must be a Python file')
    source, _ = _read_file(target)
    tree = ast.parse(source)
    if not isinstance(symbol, str) or len(symbol) > 200:
        raise ValueError('symbol must be a short dotted name')
    node: Any = tree
    for part in symbol.split('.') if symbol else []:
        if not part.isidentifier():
            raise ValueError('symbol must be a dotted Python identifier')
        node = next((child for child in getattr(node, 'body', [])
                     if isinstance(child, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and child.name == part), None)
        if node is None:
            raise ValueError(f'Symbol not found: {symbol}')
    doc = ast.get_docstring(node) or '[no docstring]'
    parts = [f'{target}: {symbol or "module"}']
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        parts.append(_declaration_header(source, node))
    parts.append(doc)
    if isinstance(node, (ast.Module, ast.ClassDef)):
        declarations = _public_declarations(node)
        parts.append('Public declarations: ' + (', '.join(declarations) if declarations else '[none]'))
    return _bounded('\n'.join(parts))


def notebook_outline(
    path: str,  # Saved notebook file.
    start: int = 0,  # First zero-based cell index.
    limit: int = 20,  # Maximum cells to list.
) -> str:
    """Summarize a saved notebook's cells and stable IDs by index."""
    target = _path(path)
    if target.suffix.lower() != '.ipynb':
        raise ValueError('path must be a saved .ipynb file')
    start = _nonnegative(start, 'start', 100_000)
    limit = _positive(limit, 'limit', 50)
    source, _ = _read_file(target)
    try:
        notebook = json.loads(source)
    except json.JSONDecodeError as exc:
        raise ValueError('Notebook is not valid JSON') from exc
    if type(notebook) is not dict or type(notebook.get('cells')) is not list:
        raise ValueError('Notebook must contain a cells list')
    cells = notebook['cells']
    if any(not isinstance(cell, dict) or cell.get('cell_type') not in ('code', 'markdown', 'raw')
           or not isinstance(cell.get('source'), (str, list))
           or (isinstance(cell.get('source'), list) and not all(isinstance(part, str) for part in cell['source']))
           for cell in cells):
        raise ValueError('Notebook contains a malformed cell or source')
    rows = []
    for index in range(start, min(start + limit, len(cells))):
        cell = cells[index]
        content = cell.get('source', '')
        content = ''.join(content) if isinstance(content, list) else str(content)
        preview = ' '.join(content.split())[:120]
        rows.append(f'{index}: {cell.get("cell_type", "?")} id={cell.get("id", "[missing]")} {preview}')
    tail = f'\n[{len(cells) - start - limit} more cells]' if len(cells) > start + limit else ''
    return _bounded(f'{target}: {len(cells)} cells\n' + ('\n'.join(rows) or '[none]') + tail)


def _document(path: str):
    from ._documents import build_document

    target = _path(path)
    if target.suffix.lower() == '.ipynb':
        raise ValueError('Use notebook_outline for saved notebooks')
    source, _ = _read_file(target)
    return target, build_document(source, target)


def document_outline(
    path: str,  # Saved Markdown or Python document.
    start: int = 0,  # First outline row.
    limit: int = 20,  # Maximum rows to list.
) -> str:
    """List a saved document's heading or code sections with addresses."""
    start = _nonnegative(start, 'start', 100_000)
    limit = _positive(limit, 'limit', 50)
    target, document = _document(path)
    rows = document.outline_rows
    body = '\n'.join(rows[start:start + limit]) or '[none]'
    tail = '\n[more sections]' if len(rows) > start + limit else ''
    return _bounded(f'Outline: {target}\n{body}{tail}')


def read_document_section(
    path: str,  # Saved document path.
    section: str = '',  # Verified outline address, or empty for all.
) -> str:
    """Read a saved document section by an address from document_outline."""
    if not isinstance(section, str) or len(section) > 200:
        raise ValueError('section must be a short outline address')
    target, document = _document(path)
    section = section or document.root_token
    try:
        selected = document.read(section)
    except (KeyError, ValueError) as exc:
        raise ValueError('Section address is missing or stale; refresh the outline') from exc
    return _bounded(f'{target} {section}\n{selected}')


def file_strs_replace(
    path: str,  # Saved text file.
    old_strings: list[str],  # Distinct literals, each occurring once.
    new_strings: list[str],  # Same-length list of replacement literals.
) -> str:
    """Replace several exact literals atomically when each old string occurs once."""
    target = _editable_path(path)
    if not isinstance(old_strings, list) or not isinstance(new_strings, list) or not 1 <= len(old_strings) <= 20 or len(old_strings) != len(new_strings):
        raise ValueError('Provide equal nonempty old_strings and new_strings lists of at most 20')
    old_strings = [_new_content(value, 'old string') for value in old_strings]
    new_strings = [_new_content(value, 'new string') for value in new_strings]
    if any(not value for value in old_strings) or len(set(old_strings)) != len(old_strings):
        raise ValueError('Old strings must be nonempty and distinct')
    original, before = _read_file(target)
    for old in old_strings:
        count = original.count(old)
        if count != 1:
            raise ValueError(f'Expected one match for {old[:40]!r}; found {count}. No change made')
    replacements = dict(zip(old_strings, new_strings))
    alternatives = '|'.join(re.escape(value) for value in sorted(old_strings, key=len, reverse=True))
    hits: list[str] = []

    def replace(match: re.Match[str]) -> str:
        hits.append(match.group())
        return replacements[match.group()]

    changed = re.sub(alternatives, replace, original)
    if len(hits) != len(old_strings) or set(hits) != set(old_strings):
        raise ValueError('Old strings overlap; choose nonoverlapping literals. No change made')
    return _write_changed(target, original, before, changed)


def view_file_hashes(
    path: str,  # Saved text file.
    start_line: int = 1,  # First one-based line.
    end_line: int = 40,  # Last one-based line, inclusive.
) -> str:
    """Show numbered lines and the SHA-256 digest for a saved text file."""
    target = _path(path)
    start_line = _positive(start_line, 'start_line', 1_000_000)
    end_line = _positive(end_line, 'end_line', 1_000_000)
    if end_line < start_line or end_line - start_line >= 80:
        raise ValueError('Select an ascending range of at most 80 lines')
    source, _ = _read_file(target)
    digest = hashlib.sha256(source.encode('utf-8')).hexdigest()
    lines = source.splitlines()
    rows = [f'{i}: {lines[i - 1]}' for i in range(start_line, min(end_line, len(lines)) + 1)]
    return _bounded(f'{target}\nsha256: {digest}\n' + ('\n'.join(rows) or '[no lines in range]'))


def file_replace_checked(
    path: str,  # Saved text file.
    old_str: str,  # Literal to replace exactly once.
    new_str: str,  # Replacement text.
    expected_sha256: str,  # Whole-file digest from view_file_hashes.
) -> str:
    """Replace one literal only when the whole file has the expected SHA-256."""
    target = _editable_path(path)
    old_str = _new_content(old_str, 'old_str')
    new_str = _new_content(new_str, 'new_str')
    if not old_str:
        raise ValueError('old_str must not be empty')
    if not isinstance(expected_sha256, str) or re.fullmatch(r'[0-9a-fA-F]{64}', expected_sha256) is None:
        raise ValueError('expected_sha256 must be a 64-character hexadecimal digest')
    original, before = _read_file(target)
    digest = hashlib.sha256(original.encode('utf-8')).hexdigest()
    if digest != expected_sha256.lower():
        raise ValueError('File SHA-256 changed; inspect the file and retry')
    if original.count(old_str) != 1:
        raise ValueError(f'Expected one literal match; found {original.count(old_str)}. No change made')
    return _write_changed(target, original, before, original.replace(old_str, new_str, 1))


__all__ = (
    'document_outline',
    'file_replace_checked',
    'file_strs_replace',
    'notebook_outline',
    'read_document_section',
    'search_files',
    'search_notebooks',
    'source_doc',
    'view_file_hashes',
)

SOURCE_TOOL_FUNCTIONS = MappingProxyType({name: globals()[name] for name in __all__})

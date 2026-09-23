"""Bounded, opt-in search, source analysis, and checked file tools."""

import ast
import hashlib
import io
import json
import os
import re
import time
import tokenize
from itertools import islice
from pathlib import Path
from types import MappingProxyType
from typing import Any

from ._tool_helpers import _bounded, _text
from .fastcore_tools import (
    MAX_FILE_BYTES,
    _editable_path,
    _new_content,
    _path,
    _read_file,
    _write_changed,
)

MAX_VISITED = 2_000
MAX_DEPTH = 6
MAX_SEARCH_RESULTS = 50
MAX_AST_BYTES = 128_000


def _positive(value: int, name: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f"{name} must be an integer from 1 to {maximum}")
    return value


def _nonnegative(value: int, name: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
        raise ValueError(f"{name} must be an integer from 0 to {maximum}")
    return value


def _files(root: Path, suffix: str = "", status: dict[str, bool] | None = None):
    """Yield at most 2,000 visible regular files, without following links."""
    if root.is_file():
        if not suffix or root.suffix.lower() == suffix:
            yield root
        return
    if not root.is_dir():
        raise ValueError(f"Path is not a file or directory: {root}")
    seen = 0
    stack = [(root, 0)]
    while stack and seen < MAX_VISITED:
        directory, depth = stack.pop()
        remaining = MAX_VISITED - seen
        with os.scandir(directory) as scan:
            entries = sorted(islice(scan, remaining + 1), key=lambda item: item.name)
        if len(entries) > remaining:
            entries.pop()
            if status is not None:
                status['partial'] = True
        for entry in entries:
            seen += 1
            if seen > MAX_VISITED:
                return
            if entry.name.startswith('.') or entry.name in {'node_modules', '__pycache__', 'venv', 'env'} or entry.is_symlink():
                continue
            if entry.is_file(follow_symlinks=False):
                p = Path(entry.path)
                if not suffix or p.suffix.lower() == suffix:
                    yield p
            elif entry.is_dir(follow_symlinks=False):
                if depth < MAX_DEPTH:
                    stack.append((Path(entry.path), depth + 1))
                elif status is not None:
                    status['partial'] = True
    if stack and status is not None:
        status['partial'] = True


def _search_notice(result: Any, limit: int) -> str:
    reason = getattr(result, 'stop_reason', None)
    if len(result) > limit:
        return '\n[more matches; narrow the search]'
    if reason or not getattr(result, 'complete', True):
        return f'\n[partial results: {reason or "search stopped"}; narrow the search]'
    return ''


def search_files(
    query: str,  # Text or regular expression to find.
    path: str = ".",  # Saved file or directory on the kernel machine.
    pattern: str = "*",  # File name glob.
    regex: bool = False,  # Interpret query as a regular expression.
    limit: int = 20,  # Maximum matches.
) -> str:
    """Search saved project text with bounded ripgrep results and file filters."""
    import rgapi

    query = _text(query, 'query', 500)
    pattern = _text(pattern, 'pattern', 200)
    limit = _positive(limit, 'limit', MAX_SEARCH_RESULTS)
    if not isinstance(regex, bool):
        raise TypeError('regex must be true or false')
    root = _path(path)
    if not root.exists():
        raise ValueError(f'Path does not exist: {root}')
    expression = query if regex else re.escape(query)
    try:
        result = rgapi.rg(expression, root, glob=pattern, max_results=limit + 1,
                          timeout_ms=1_500, max_filesize=MAX_FILE_BYTES,
                          max_depth=MAX_DEPTH, maxlen=180)
    except Exception as exc:
        raise ValueError(f'Search failed: {exc}') from exc
    rows = [str(item) for item in result[:limit]]
    tail = _search_notice(result, limit)
    return _bounded(f'Saved-file matches under {root}:\n' + ('\n'.join(rows) or '[none]') + tail)


def search_notebooks(
    query: str,  # Literal cell-source text.
    path: str = ".",  # Saved notebook or directory.
    limit: int = 20,  # Maximum matching cells.
) -> str:
    """Search saved notebook cell source; include stable saved cell IDs."""
    import rgapi

    query = _text(query, 'query', 500)
    limit = _positive(limit, 'limit', MAX_SEARCH_RESULTS)
    root = _path(path)
    if not root.exists():
        raise ValueError(f'Path does not exist: {root}')
    try:
        result = rgapi.nbrg(re.escape(query), root, max_results=limit + 1,
                            timeout_ms=1_500, max_filesize=MAX_FILE_BYTES,
                            max_depth=MAX_DEPTH, maxlen=140)
    except Exception as exc:
        raise ValueError(f'Notebook search failed: {exc}') from exc
    rows = [str(cell) for cell in result[:limit]]
    tail = _search_notice(result, limit)
    return _bounded(f'Saved notebook matches under {root}:\n' + ('\n'.join(rows) or '[none]') + tail)


def ast_search(
    pattern: str,  # ast-grep Python syntax pattern.
    path: str = ".",  # Saved Python file or directory.
    limit: int = 20,  # Maximum matches.
) -> str:
    """Find Python syntax patterns in bounded saved files."""
    import remold

    pattern = _text(pattern, 'pattern', 500)
    limit = _positive(limit, 'limit', MAX_SEARCH_RESULTS)
    root = _path(path)
    rows: list[str] = []
    visited = 0
    status = {'partial': False}
    deadline = time.monotonic() + 1.5
    for file in _files(root, '.py', status):
        if time.monotonic() >= deadline:
            status['partial'] = True
            break
        visited += 1
        try:
            if file.stat().st_size > MAX_AST_BYTES:
                status['partial'] = True
                continue
            source, _ = _read_file(file)
        except (OSError, ValueError):
            status['partial'] = True
            continue
        try:
            matches = remold.astfind(source, pattern)
        except Exception as exc:
            raise ValueError(f'Invalid AST pattern: {exc}') from exc
        cursor = 0
        for match in matches:
            match_text = str(match)
            position = source.find(match_text, cursor)
            if position < 0:
                position = source.find(match_text)
            line = source.count('\n', 0, max(position, 0)) + 1
            cursor = max(position, 0) + len(match_text)
            rows.append(f'{file}:{line}: {match_text[:180]}')
            if len(rows) >= limit:
                return _bounded('\n'.join(rows) + '\n[match limit reached]')
    body = '\n'.join(rows) or f'[no AST matches in {visited} Python files]'
    if status['partial']:
        body += '\n[partial results: time, depth, or traversal limit reached]'
    return _bounded(body)


def _ast_changed(source: str, pattern: str, replacement: str) -> tuple[str, int]:
    import remold

    if not isinstance(source, str) or len(source.encode('utf-8')) > MAX_AST_BYTES:
        raise ValueError('source must be UTF-8 text of at most 128 KB for syntax rewriting')
    pattern = _text(pattern, 'pattern', 500)
    replacement = _new_content(replacement, 'replacement')
    try:
        matches = remold.astfind(source, pattern)
        changed = remold.astmap((pattern, replacement))(source)
    except Exception as exc:
        raise ValueError(f'AST rewrite failed: {exc}') from exc
    if len(changed) > MAX_FILE_BYTES:
        raise ValueError('Rewritten source exceeds the 1 MB limit')
    return changed, len(matches)


def ast_rewrite(
    source: str,  # Python source text to preview.
    pattern: str,  # ast-grep syntax pattern.
    replacement: str,  # Declarative replacement pattern.
) -> str:
    """Preview a declarative Python syntax rewrite without writing a file."""
    from fastcore.xtras import str_diff

    source = _new_content(source, 'source')
    changed, count = _ast_changed(source, pattern, replacement)
    return _bounded(f'{count} syntax matches\n' + (str_diff(source, changed, n=2) if changed != source else '[no change]'))


def file_ast_replace(
    path: str,  # Saved Python source file.
    pattern: str,  # ast-grep syntax pattern.
    replacement: str,  # Declarative replacement pattern.
    expected_matches: int = 1,  # Required match count before writing.
) -> str:
    """Apply a syntax rewrite only when the match count is expected."""
    target = _editable_path(path)
    expected_matches = _positive(expected_matches, 'expected_matches', 100)
    original, before = _read_file(target)
    changed, count = _ast_changed(original, pattern, replacement)
    if count != expected_matches:
        raise ValueError(f'Expected {expected_matches} AST matches; found {count}. No change made')
    return _write_changed(target, original, before, changed)


def python_symbols(
    path: str,  # Saved Python source file.
    kind: str = 'definitions',  # definitions or references.
) -> str:
    """List syntactic names bound or referenced in one saved Python file."""
    import remold

    target = _path(path)
    if target.suffix.lower() != '.py':
        raise ValueError('path must be a Python file')
    source, _ = _read_file(target)
    if kind not in ('definitions', 'references'):
        raise ValueError("kind must be 'definitions' or 'references'")
    try:
        ast.parse(source)
    except SyntaxError as exc:
        raise ValueError(f'Invalid Python syntax at line {exc.lineno}') from exc
    names = remold.symdefs(source) if kind == 'definitions' else remold.symrefs(source)
    return _bounded(f'{kind} in {target}: ' + (', '.join(sorted(names)[:200]) or '[none]'))


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
    import exhash

    target = _path(path)
    if target.suffix.lower() == '.ipynb':
        raise ValueError('Use notebook_outline for saved notebooks')
    source, _ = _read_file(target)
    return target, exhash.open_doc(source, fname=str(target))


def document_outline(
    path: str,  # Saved Markdown or code document.
    start: int = 0,  # First outline row.
    limit: int = 20,  # Maximum rows to list.
) -> str:
    """List a saved document's heading or code sections with addresses."""
    start = _nonnegative(start, 'start', 100_000)
    limit = _positive(limit, 'limit', 50)
    target, document = _document(path)
    rows = str(document).splitlines()
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
    section = section or str(document).splitlines()[0].split()[0]
    try:
        selected = document.at(section)
    except (KeyError, ValueError) as exc:
        raise ValueError('Section address is missing or stale; refresh the outline') from exc
    return _bounded(f'{target} {section}\n{selected.view()}')


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
    'ast_rewrite',
    'ast_search',
    'document_outline',
    'file_ast_replace',
    'file_replace_checked',
    'file_strs_replace',
    'notebook_outline',
    'python_symbols',
    'read_document_section',
    'search_files',
    'search_notebooks',
    'source_doc',
    'view_file_hashes',
)

SOURCE_TOOL_FUNCTIONS = MappingProxyType({name: globals()[name] for name in __all__})

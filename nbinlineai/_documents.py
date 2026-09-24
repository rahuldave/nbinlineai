"""Static outlines of saved Markdown and Python documents.

Addresses are tied to every byte of the decoded source. Parsing never imports or
executes the inspected document.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

_ADDRESS = re.compile(r'^s:([0-9a-f]{64}):([0-9]+)$')


@dataclass(frozen=True)
class _Section:
    title: str
    start: int  # Zero-based, inclusive source line.
    end: int  # Zero-based, exclusive source line.
    depth: int


class Document:
    """An immutable source snapshot with verified section addresses."""

    def __init__(self, source: str, sections: list[_Section]):
        self._source = source
        self._lines = source.splitlines(keepends=True)
        self._sections = sections
        self._digest = sha256(source.encode('utf-8')).hexdigest()
        self.root_token = self._token(0)
        self.outline_rows = [
            f'{self._token(index)} {"  " * section.depth}{section.title} '
            f'(lines {section.start + 1 if section.end else 0}-{section.end})'
            for index, section in enumerate(sections)
        ]

    def _token(self, index: int) -> str:
        return f's:{self._digest}:{index}'

    def read(self, section: str = '') -> str:
        """Return original source for a section, including its descendants."""
        if section == '':
            return self._source
        match = _ADDRESS.fullmatch(section) if isinstance(section, str) else None
        if match is None or match.group(1) != self._digest:
            raise ValueError('Section address is missing or stale; refresh the outline')
        index = int(match.group(2))
        if index >= len(self._sections) or section != self._token(index):
            raise ValueError('Section address is missing or stale; refresh the outline')
        selected = self._sections[index]
        return ''.join(self._lines[selected.start:selected.end])


def _markdown_sections(source: str) -> list[_Section]:
    from markdown_it import MarkdownIt

    lines = source.splitlines(keepends=True)
    sections = [_Section('Entire document', 0, len(lines), 0)]
    headings: list[tuple[int, str, int]] = []
    tokens = MarkdownIt('commonmark').parse(source)
    for index, token in enumerate(tokens):
        if token.type != 'heading_open' or token.map is None:
            continue
        inline = tokens[index + 1]
        title = ' '.join(inline.content.split()) or '[untitled heading]'
        headings.append((int(token.tag[1]), title, token.map[0]))
    ends = [len(lines)] * len(headings)
    open_headings: list[int] = []
    for index, (level, _, start) in enumerate(headings):
        while open_headings and headings[open_headings[-1]][0] >= level:
            ends[open_headings.pop()] = start
        open_headings.append(index)
    for (level, title, start), end in zip(headings, ends):
        sections.append(_Section(title, start, end, level))
    return sections


def _python_sections(source: str) -> list[_Section]:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ValueError(f'Python source has a syntax error at line {exc.lineno}') from exc
    except RecursionError as exc:
        raise ValueError('Python source is too deeply nested to parse') from exc
    lines = source.splitlines(keepends=True)
    sections = [_Section('Entire document', 0, len(lines), 0)]

    pending: list[tuple[ast.AST, int]] = [(tree, 1)]
    while pending:
        node, depth = pending.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            first = min([node.lineno, *(item.lineno for item in node.decorator_list)]) - 1
            kind = ('async def' if isinstance(node, ast.AsyncFunctionDef)
                    else 'def' if isinstance(node, ast.FunctionDef) else 'class')
            sections.append(_Section(f'{kind} {node.name}', first, node.end_lineno, depth))
            depth += 1
        pending.extend((child, depth) for child in reversed(list(ast.iter_child_nodes(node))))
    return sections


def build_document(source: str, path: Path) -> Document:
    """Build a static outline for saved Markdown or Python source."""
    suffix = path.suffix.lower()
    if suffix == '.ipynb':
        raise ValueError('Use notebook_outline for saved .ipynb notebooks')
    if suffix in ('.md', '.markdown'):
        return Document(source, _markdown_sections(source))
    if suffix == '.py':
        return Document(source, _python_sections(source))
    raise ValueError('Document outline supports only Markdown (.md, .markdown) and Python (.py) files')

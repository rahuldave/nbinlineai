"""Bounded notebook landmarks for interpreting the latest AI question."""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .context_budget import ContextUnit, ai_role

_ATX_HEADING = re.compile(r"^ {0,3}#{1,6}(?:[ \t]+|$)")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def _has_heading(source: str) -> bool:
    """Recognize ATX headings outside Markdown backtick/tilde fences."""
    fence_char = ""
    fence_width = 0
    for line in source.splitlines():
        marker = _FENCE.match(line)
        if marker:
            run, rest = marker.groups()
            if not fence_char and (run[0] != "`" or "`" not in rest):
                fence_char, fence_width = run[0], len(run)
                continue
            if fence_char == run[0] and len(run) >= fence_width and not rest.strip():
                fence_char, fence_width = "", 0
                continue
        if not fence_char and _ATX_HEADING.match(line):
            return True
    return False


@dataclass(frozen=True)
class _Landmark:
    cell: dict[str, Any] | None
    position: int


@dataclass(frozen=True)
class FocusLandmarks:
    """Physical targets from one frozen snapshot, independent of selection."""

    current_id: str
    current_position: int
    immediate: _Landmark
    code: _Landmark
    text: _Landmark
    heading: _Landmark
    section_cells: tuple[dict[str, Any], ...]

    def render(
        self,
        included_ids: set[str],
        partial_ids: set[str],
        units: list[ContextUnit],
        selected_pairs: list[ContextUnit],
    ) -> str:
        """Render a constant-width status field for every budget round."""
        candidate_ids = {cell["id"] for unit in units for cell in
                         (unit.cell, unit.prompt, unit.answer) if cell}
        chat_map = {cell["id"]: f"{number:05d}{role}" for number, pair in
                    enumerate(selected_pairs, 1) for role, cell in
                    (("Q", pair.prompt), ("A", pair.answer)) if cell}

        def line(name: str, landmark: _Landmark) -> str:
            cell = landmark.cell
            if cell is None:
                return f"{name}: id=none; position=00000; type=none; status=NONE; chat=00000-"
            cell_id = cell["id"]
            if cell_id in partial_ids:
                status = "PART"
            elif cell_id in included_ids:
                status = "FULL"
            elif cell_id in candidate_ids:
                status = "OMIT"
            else:
                status = "EXCL"
            role = ai_role(cell)
            cell_type = f"AI-{role}" if role else cell["cell_type"]
            return (f"{name}: id={cell_id}; position={landmark.position:05d}; "
                    f"type={cell_type}; status={status}; chat={chat_map.get(cell_id, '00000-')}")

        full_count = sum(cell["id"] in included_ids and cell["id"] not in partial_ids
                         for cell in self.section_cells)
        partial_count = sum(cell["id"] in partial_ids for cell in self.section_cells)
        return "\n".join((
            f"Question: id={self.current_id}; position={self.current_position:05d}.",
            line("Immediate cell above", self.immediate),
            line("Nearest code above", self.code),
            line("Nearest ordinary Markdown above", self.text),
            line("Section heading above", self.heading),
            (f"Section from heading to just before question: full={full_count:05d}/"
             f"{len(self.section_cells):05d}; partial={partial_count:05d}."),
            ("Status FULL means full source supplied; PART means clipped; OMIT means selected but "
             "removed by context budget; EXCL means outside selected context or ineligible; "
             "NONE means no such preceding cell. A nonzero chat field identifies the retained "
             "prior conversation pair number and Q/A role; its raw text is in the earlier chat turns."),
        ))


def locate_focus(
    cells: list[dict[str, Any]], prompt_id: str, *, legacy: bool = False,
) -> FocusLandmarks:
    """Find only nearby reference cells; never copy their source into landmarks."""
    index = len(cells) if legacy else next(i for i, cell in enumerate(cells)
                                               if cell["id"] == prompt_id)
    above = cells[:index]

    def nearest(predicate: Callable[[dict[str, Any]], bool]) -> _Landmark:
        for position in range(index - 1, -1, -1):
            if predicate(cells[position]):
                return _Landmark(cells[position], position + 1)
        return _Landmark(None, 0)

    immediate = _Landmark(above[-1], index) if above else _Landmark(None, 0)
    code = nearest(lambda cell: cell["cell_type"] == "code")
    text = nearest(lambda cell: cell["cell_type"] == "markdown" and ai_role(cell) is None)
    heading = nearest(lambda cell: cell["cell_type"] == "markdown"
                      and ai_role(cell) is None and _has_heading(cell["source"]))
    section = tuple(cells[heading.position - 1:index]) if heading.cell else ()
    return FocusLandmarks(prompt_id, index + 1, immediate, code, text, heading, section)

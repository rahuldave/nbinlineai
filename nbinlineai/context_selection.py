"""Resolve notebook context candidates from a frozen, ordered model snapshot."""

from dataclasses import dataclass
from typing import Any

from .context_budget import ContextUnit, ai_role, eligible_units

CONTEXT_MODES = frozenset({"default", "current-only", "full-notebook", "all-above", "ten-above",
                           "ten-above-below", "custom"})


@dataclass
class Selection:
    units: list[ContextUnit]
    report: dict[str, Any]


def _answer_link(cell: dict[str, Any]) -> str | None:
    ai = cell.get("metadata", {}).get("nbinlineai", {})
    if not isinstance(ai, dict):
        return None
    return ai.get("promptCellId") or ai.get("prompt_cell_id")


def _answer_done(cell: dict[str, Any]) -> bool:
    ai = cell.get("metadata", {}).get("nbinlineai", {})
    return isinstance(ai, dict) and ai.get("status", "done") == "done"


def select_context(cells: list[dict[str, Any]], prompt_id: str, mode: str) -> Selection:
    """Select prose independently from earlier tool declarations.

    Window positions count every physical cell except this question's linked
    answers. In explicit modes, an unpaired AI cell is labeled source; only a
    complete selected pair wholly above the target becomes conversation.
    """
    if mode not in CONTEXT_MODES:
        raise ValueError("Invalid context mode")
    ids = [cell["id"] for cell in cells]
    if prompt_id not in ids:
        raise ValueError("Current AI question is missing from the notebook snapshot")
    prompt_index = ids.index(prompt_id)
    prompt_ids = {cell["id"] for cell in cells if ai_role(cell) == "prompt"}
    excluded_self = {prompt_id, *(cell["id"] for cell in cells
                                  if ai_role(cell) == "response" and _answer_link(cell) == prompt_id)}
    before = [cell["id"] for cell in cells[:prompt_index] if cell["id"] not in excluded_self]
    after = [cell["id"] for cell in cells[prompt_index + 1:] if cell["id"] not in excluded_self]
    if mode == "current-only":
        scope = set()
    elif mode == "default" or mode == "all-above":
        scope = set(before)
    elif mode == "ten-above":
        scope = set(before[-10:])
    elif mode == "ten-above-below":
        scope = set(before[-10:] + after[:10])
    else:
        scope = set(before + after)

    legacy = eligible_units(cells[:prompt_index]) if mode == "default" else []
    legacy_ids = {cell["id"] for unit in legacy
                  for cell in (unit.cell, unit.prompt, unit.answer) if cell}

    selected: set[str] = set()
    ineligible: list[dict[str, str]] = []
    for cell in cells:
        cell_id = cell["id"]
        role = ai_role(cell)
        reason = None
        if cell_id == prompt_id:
            reason = "current-question"
        elif cell_id in excluded_self:
            reason = "answer-to-current-question"
        elif cell["cell_type"] == "raw":
            reason = "raw-cell"
        elif (not cell["source"] or (mode != "default" and not cell["source"].strip())) and not (
            mode == "default" and cell_id in legacy_ids
        ):
            reason = "empty-cell"
        elif role == "response" and not _answer_done(cell):
            reason = "answer-not-complete"
        elif role == "response" and _answer_link(cell) not in prompt_ids:
            reason = "orphan-answer"
        elif mode == "default" and role and cell_id not in legacy_ids:
            reason = "default-requires-earlier-complete-pair"
        if reason:
            ineligible.append({"id": cell_id, "reason": reason})
            continue
        if cell_id in scope and (mode != "custom" or cell.get("context_include", True)):
            selected.add(cell_id)

    if mode == "default":
        units = [unit for unit in legacy if (unit.cell and unit.cell["id"] not in excluded_self)
                 or (unit.prompt and unit.answer and unit.prompt["id"] not in excluded_self
                     and unit.answer["id"] not in excluded_self)]
        selected = {unit.cell["id"] for unit in units if unit.cell}
        selected.update(cell["id"] for unit in units for cell in (unit.prompt, unit.answer) if cell)
    else:
        prompts = {cell["id"]: (index, cell) for index, cell in enumerate(cells)
                   if ai_role(cell) == "prompt"}
        pairs: dict[str, tuple[int, dict[str, Any], int, dict[str, Any]]] = {}
        for index, answer in enumerate(cells):
            if ai_role(answer) != "response" or answer["id"] not in selected:
                continue
            link = _answer_link(answer)
            if link in prompts and link in selected:
                pindex, prompt = prompts[link]
                if pindex < index < prompt_index:
                    pairs[link] = (pindex, prompt, index, answer)
        paired = {cell["id"] for pair in pairs.values() for cell in (pair[1], pair[3])}
        units = [ContextUnit("pair", answer_index, prompt=prompt, answer=answer)
                 for _, prompt, answer_index, answer in pairs.values()]
        for index, cell in enumerate(cells):
            if cell["id"] in selected - paired:
                units.append(ContextUnit("source", index, cell=cell,
                                         position="above" if index < prompt_index else "below"))
        # Earlier pairs retain their answer anchor. Sources use their own distance.
        units.sort(key=lambda unit: (abs(unit.anchor - prompt_index),
                                     0 if unit.anchor < prompt_index else 1, -unit.anchor))

    ineligible_ids = {item["id"] for item in ineligible}
    report = {
        "context_mode": mode,
        "snapshot_cell_count": len(cells),
        "selected_cell_ids": [cell_id for cell_id in ids if cell_id in selected],
        "excluded_cell_ids": [cell_id for cell_id in ids if cell_id not in selected
                              and cell_id not in ineligible_ids],
        "ineligible_cells": ineligible,
        "selected_cell_count": len(selected),
        "excluded_cell_count": len(ids) - len(selected) - len(ineligible),
    }
    return Selection(units, report)

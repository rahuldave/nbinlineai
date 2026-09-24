"""Nearest-first context selection for one frozen notebook cell snapshot.

Accounting uses compact sorted-key JSON of normalized messages (msg2dict)
plus compact JSON of tool schemas, with Unicode unescaped. It includes roles,
part wrappers, labels, separators, and preserved provider raw tool messages.
This deterministic character estimate is not a model-token guarantee.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from aidialog.msg_parts import Msg, Text, msg2dict

MAX_CONTEXT_CHARS = 64_000


class ContextWindowExceededError(ValueError):
    """Fixed prompt and tool material exceeds the character budget."""


@dataclass(frozen=True)
class ContextUnit:
    """One ordinary source cell or one completed AI prompt/answer pair."""

    kind: str
    anchor: int
    cell: dict[str, Any] | None = None
    prompt: dict[str, Any] | None = None
    answer: dict[str, Any] | None = None
    position: str = "above"


@dataclass
class BuiltContext:
    """Provider messages and visible per-round context accounting."""

    messages: list[Msg]
    counts: dict[str, Any]


def ai_role(
    cell: dict[str, Any],  # Cell from the frozen browser snapshot.
) -> str | None:  # Prompt, response, or ordinary source.
    """Classify AI cells, favoring response when metadata is malformed."""
    metadata = cell.get("metadata")
    if not isinstance(metadata, dict):
        return None
    ai = metadata.get("nbinlineai")
    if not isinstance(ai, dict):
        return None
    if ai.get("isOutputCell") or ai.get("is_output_cell") or ai.get("role") == "response":
        return "response"
    if ai.get("isPromptCell") or ai.get("is_prompt_cell") or ai.get("role") == "prompt":
        return "prompt"
    return None


def eligible_units(
    cells: list[dict[str, Any]],  # Complete preceding-cell snapshot.
) -> list[ContextUnit]:  # Newest-first eligible source cells and completed pairs.
    """Pair completed AI turns and retain ordinary source as separate units."""
    prompts: dict[str, tuple[int, dict[str, Any]]] = {}
    pairs: dict[str, ContextUnit] = {}
    sources: list[ContextUnit] = []
    for index, cell in enumerate(cells):
        role = ai_role(cell)
        if role == "prompt":
            prompts[cell["id"]] = (index, cell)
        elif role == "response":
            ai = cell["metadata"]["nbinlineai"]
            prompt_id = ai.get("promptCellId") or ai.get("prompt_cell_id")
            if ai.get("status", "done") == "done" and prompt_id in prompts:
                prompt_index, prompt = prompts[prompt_id]
                if prompt_index < index:
                    # The latest completed output wins for duplicate links.
                    pairs[prompt_id] = ContextUnit("pair", index, prompt=prompt, answer=cell)
        elif cell["cell_type"] in ("code", "markdown") and cell["source"]:
            sources.append(ContextUnit("source", index, cell=cell))
    return sorted([*sources, *pairs.values()], key=lambda unit: unit.anchor, reverse=True)


def json_chars(
    value: Any,  # JSON-ready normalized message or tool definitions.
) -> int:  # Serialized Unicode character count.
    """Count compact JSON using a stable representation for provider raw parts."""
    return len(json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), default=str))


def message_chars(
    message: Msg,  # One normalized provider message.
) -> int:  # Serialized message character count.
    """Count role, content wrappers, and preserved provider raw data."""
    return json_chars(msg2dict(message))


def messages_chars(
    messages: list[Msg],  # Complete normalized provider conversation.
) -> int:  # Serialized message-array character count.
    """Include JSON array brackets and commas between messages."""
    return json_chars([msg2dict(message) for message in messages])


def _escaped_chars(
    value: str,  # Text inserted into a normalized JSON string.
) -> int:  # Escaped content length without enclosing quotes.
    """Count text cost inside a JSON message string."""
    return len(json.dumps(value, ensure_ascii=False)) - 2


def _source_label(
    cell: dict[str, Any],  # Ordinary code or Markdown cell.
    partial: bool,  # Whether only its nearest source suffix is included.
    position: str = "above",
) -> str:  # Labeled source prefix.
    """Label source without implying that code was executed."""
    role = ai_role(cell)
    if role:
        ai = cell.get("metadata", {}).get("nbinlineai", {})
        linked = ai.get("promptCellId") or ai.get("prompt_cell_id") if role == "response" else None
        label = f"AI {'answer' if role == 'response' else 'question'} cell {cell['id']} (notebook source {position}"
        if linked:
            label += f"; linked question {linked}"
        label += ")"
    else:
        label = (f"Code cell {cell['id']} (source {position}; execution count {cell.get('execution_count')})"
                 if cell["cell_type"] == "code" else f"Markdown cell {cell['id']} (source {position})")
    if partial:
        label += f" [partial; nearest source {'suffix' if position == 'above' else 'prefix'} retained]"
    return f"[{label}]\n"


def _partial_suffix(
    cell: dict[str, Any],  # Source cell at the budget boundary.
    remaining: int,  # Escaped-character allowance for this source chunk.
    position: str = "above",
) -> str:  # Largest labeled nonempty suffix that fits, or empty.
    """Clip one boundary cell from its top while keeping nearest text."""
    source = cell["source"]
    label = _source_label(cell, partial=True, position=position)
    low, high = 0, len(source)
    while low < high:
        middle = (low + high + 1) // 2
        chunk = source[-middle:] if position == "above" else source[:middle]
        if _escaped_chars(label + chunk) <= remaining:
            low = middle
        else:
            high = middle - 1
    return label + (source[-low:] if position == "above" else source[:low]) if low else ""


def build_context(
    cells: list[dict[str, Any]],  # Frozen preceding-cell snapshot.
    units: list[ContextUnit],  # Eligible units from that snapshot, newest first.
    tools: list[dict[str, Any]],  # Provider tool definitions.
    system_prefix: str,  # Fixed system text before notebook source.
    system_suffix: str,  # Fixed style text after notebook source.
    current_prompt: str,  # Current question after live variable expansion.
    executed_messages: list[Msg],  # Completed assistant/tool groups to preserve.
    selection_report: dict[str, Any] | None = None,
    focus: Any = None,  # Bounded frozen-snapshot landmarks, when available.
    *,
    round_wire_cost: Callable[[list[Msg], list[dict[str, Any]]], int] | None = None,
) -> BuiltContext:  # Messages and per-round accounting.
    """Fit fixed material first, then nearest units without gaps.

    A non-API transport can provide the exact cost of its complete serialized
    round, including schema, framing, and any escaping of these messages.
    The same callback is used before optional context and for each candidate.
    """
    tool_schema_chars = json_chars(tools)
    current = Msg("user", [Text(current_prompt)])
    focus_before = focus.render(set(), set(), units, []) if focus else ""
    focus_prefix = (system_prefix + "\n\nNotebook cell landmarks:\n" + focus_before
                    + "\n\nNotebook source:\n") if focus else system_prefix
    empty_system = Msg("system", [Text(focus_prefix + system_suffix)])
    fixed_messages = [empty_system, current, *executed_messages]
    fixed = (round_wire_cost(fixed_messages, tools) if round_wire_cost
             else tool_schema_chars + messages_chars(fixed_messages))
    if isinstance(fixed, bool) or not isinstance(fixed, int) or fixed < 0:
        raise ValueError("Round wire cost must be a nonnegative integer")
    if fixed > MAX_CONTEXT_CHARS:
        raise ContextWindowExceededError(
            "Current prompt, instructions, tool definitions, or executed tool results exceed "
            f"the {MAX_CONTEXT_CHARS}-character context budget. Shorten the prompt or "
            "instructions, register fewer tools, or start a new AI prompt."
        )

    selected_sources: list[tuple[int, dict[str, Any], str, int, bool]] = []
    selected_pairs: list[ContextUnit] = []
    used = fixed
    separator_cost = _escaped_chars("\n\n")

    def candidate_wire_cost() -> int:
        """Serialize the currently selected optional units exactly once."""
        ordered_sources = sorted(selected_sources, key=lambda item: item[0])
        ordered_pairs = sorted(selected_pairs, key=lambda item: item.anchor)
        source_text = "\n\n".join(item[2] for item in ordered_sources)
        system = Msg("system", [Text(focus_prefix + source_text + system_suffix)])
        history = []
        for pair in ordered_pairs:
            assert pair.prompt is not None and pair.answer is not None
            history.extend([Msg("user", [Text(pair.prompt["source"])]),
                            Msg("assistant", [Text(pair.answer["source"])])])
        cost = round_wire_cost([system, *history, current, *executed_messages], tools)
        if isinstance(cost, bool) or not isinstance(cost, int) or cost < 0:
            raise ValueError("Round wire cost must be a nonnegative integer")
        return cost

    for unit in units:
        if unit.kind == "pair":
            assert unit.prompt is not None and unit.answer is not None
            if round_wire_cost:
                selected_pairs.append(unit)
                candidate = candidate_wire_cost()
                if candidate > MAX_CONTEXT_CHARS:
                    selected_pairs.pop()
                    break
                used = candidate
            else:
                cost = (message_chars(Msg("user", [Text(unit.prompt["source"])]))
                        + message_chars(Msg("assistant", [Text(unit.answer["source"])])) + 2)
                if used + cost > MAX_CONTEXT_CHARS:
                    break
                selected_pairs.append(unit)
                used += cost
            continue
        assert unit.cell is not None
        cell = unit.cell
        separator = separator_cost if selected_sources else 0
        full = _source_label(cell, partial=False, position=unit.position) + cell["source"]
        if round_wire_cost:
            selected_sources.append((unit.anchor, cell, full, len(cell["source"]), False))
            candidate = candidate_wire_cost()
            if candidate <= MAX_CONTEXT_CHARS:
                used = candidate
                continue
            selected_sources.pop()
            label = _source_label(cell, partial=True, position=unit.position)
            low, high = 0, len(cell["source"])
            partial = ""
            while low < high:
                middle = (low + high + 1) // 2
                chunk = (cell["source"][-middle:] if unit.position == "above"
                         else cell["source"][:middle])
                text = label + chunk
                selected_sources.append((unit.anchor, cell, text, middle, True))
                cost = candidate_wire_cost()
                selected_sources.pop()
                if cost <= MAX_CONTEXT_CHARS:
                    low = middle
                    partial = text
                    used = cost
                else:
                    high = middle - 1
            if partial:
                selected_sources.append((unit.anchor, cell, partial, low, True))
            break
        cost = _escaped_chars(full) + separator
        if used + cost <= MAX_CONTEXT_CHARS:
            selected_sources.append((unit.anchor, cell, full, len(cell["source"]), False))
            used += cost
            continue
        partial = _partial_suffix(cell, MAX_CONTEXT_CHARS - used - separator, unit.position)
        if partial:
            retained = len(partial) - len(_source_label(cell, partial=True, position=unit.position))
            selected_sources.append((unit.anchor, cell, partial, retained, True))
            used += _escaped_chars(partial) + separator
        break

    selected_sources.sort(key=lambda item: item[0])
    selected_pairs.sort(key=lambda item: item.anchor)
    source_text = "\n\n".join(item[2] for item in selected_sources)
    included_ids = {item[1]["id"] for item in selected_sources}
    included_ids.update(cell["id"] for pair in selected_pairs
                        for cell in (pair.prompt, pair.answer) if cell)
    partial_ids = {item[1]["id"] for item in selected_sources if item[4]}
    focus_after = focus.render(included_ids, partial_ids, units, selected_pairs) if focus else ""
    assert len(focus_after) == len(focus_before), "Landmark status must not change budget cost"
    final_prefix = (system_prefix + "\n\nNotebook cell landmarks:\n" + focus_after
                    + "\n\nNotebook source:\n") if focus else system_prefix
    system = Msg("system", [Text(final_prefix + source_text + system_suffix)])
    history = []
    for pair in selected_pairs:
        assert pair.prompt is not None and pair.answer is not None
        history.extend([Msg("user", [Text(pair.prompt["source"])]),
                        Msg("assistant", [Text(pair.answer["source"])])])
    messages = [system, *history, current, *executed_messages]
    exact = (round_wire_cost(messages, tools) if round_wire_cost
             else tool_schema_chars + messages_chars(messages))
    assert exact == used, "Incremental accounting must match serialized messages"

    source_units = sum(unit.kind == "source" for unit in units)
    pair_units = len(units) - source_units
    included = len(selected_sources) + 2 * len(selected_pairs)
    eligible = source_units + 2 * pair_units
    partial_count = sum(item[4] for item in selected_sources)
    counts = {
        "code_cells": sum(item[1]["cell_type"] == "code" for item in selected_sources),
        "markdown_cells": sum(item[1]["cell_type"] == "markdown" for item in selected_sources),
        "code_chars": sum(item[3] for item in selected_sources if item[1]["cell_type"] == "code"),
        "markdown_chars": sum(item[3] for item in selected_sources
                              if item[1]["cell_type"] == "markdown"),
        "source_chars": sum(item[3] for item in selected_sources),
        "source_truncated": bool(partial_count or source_units > len(selected_sources)),
        "history_truncated": pair_units > len(selected_pairs),
        "cell_count": included,
        "preceding_cell_count": len(cells),
        "omitted_cell_count": eligible - included,
        "partial_cell_count": partial_count,
        "context_chars": exact,
        "context_budget_chars": MAX_CONTEXT_CHARS,
        "tool_schema_chars": tool_schema_chars,
    }
    if round_wire_cost:
        counts["round_wire_chars"] = exact
    selected_ids = [item[1]["id"] for item in selected_sources]
    selected_ids.extend(cell["id"] for pair in selected_pairs
                        for cell in (pair.prompt, pair.answer) if cell)
    partial_ids = [item[1]["id"] for item in selected_sources if item[4]]
    candidate_ids = [unit.cell["id"] for unit in units if unit.cell]
    candidate_ids.extend(cell["id"] for unit in units for cell in (unit.prompt, unit.answer) if cell)
    candidate_set = set(candidate_ids)
    included_set = set(selected_ids)
    counts.update({
        "included_cell_ids": [cell["id"] for cell in cells if cell["id"] in included_set],
        "omitted_cell_ids": [cell["id"] for cell in cells
                             if cell["id"] in candidate_set and cell["id"] not in included_set],
        "partial_cell_ids": partial_ids,
        "partial_cells": [{"id": cell_id, "retained": "suffix" if next(
            (unit.position for unit in units if unit.cell and unit.cell["id"] == cell_id), "above"
        ) == "above" else "prefix"} for cell_id in partial_ids],
    })
    if selection_report:
        counts.update(selection_report)
        if selection_report.get("context_mode") == "default":
            counts["selected_cell_ids"] = counts["included_cell_ids"]
            counts["selected_cell_count"] = len(counts["included_cell_ids"])
    counts["eligible_candidate_count"] = len(candidate_set)
    counts["budget_omitted_cell_count"] = len(counts["omitted_cell_ids"])
    counts["included_above_cell_count"] = sum(
        1 for unit in units if unit.position == "above" for cell in
        ([unit.cell] if unit.cell else [unit.prompt, unit.answer])
        if cell and cell["id"] in included_set
    )
    counts["included_below_cell_count"] = len(included_set) - counts["included_above_cell_count"]
    return BuiltContext(messages, counts)

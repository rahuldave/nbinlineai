"""Nearest-first context selection for one frozen notebook cell snapshot.

Accounting uses compact sorted-key JSON of normalized messages (msg2dict)
plus compact JSON of tool schemas, with Unicode unescaped. It includes roles,
part wrappers, labels, separators, and preserved provider raw tool messages.
This deterministic character estimate is not a model-token guarantee.
"""

import json
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
) -> str:  # Labeled source prefix.
    """Label source without implying that code was executed."""
    label = (f"Code cell {cell['id']} (source; execution count {cell.get('execution_count')})"
             if cell["cell_type"] == "code" else f"Markdown cell {cell['id']} (source)")
    if partial:
        label += " [partial; nearest source suffix retained]"
    return f"[{label}]\n"


def _partial_suffix(
    cell: dict[str, Any],  # Source cell at the budget boundary.
    remaining: int,  # Escaped-character allowance for this source chunk.
) -> str:  # Largest labeled nonempty suffix that fits, or empty.
    """Clip one boundary cell from its top while keeping nearest text."""
    source = cell["source"]
    label = _source_label(cell, partial=True)
    low, high = 0, len(source)
    while low < high:
        middle = (low + high + 1) // 2
        if _escaped_chars(label + source[-middle:]) <= remaining:
            low = middle
        else:
            high = middle - 1
    return label + source[-low:] if low else ""


def build_context(
    cells: list[dict[str, Any]],  # Frozen preceding-cell snapshot.
    units: list[ContextUnit],  # Eligible units from that snapshot, newest first.
    tools: list[dict[str, Any]],  # Provider tool definitions.
    system_prefix: str,  # Fixed system text before notebook source.
    system_suffix: str,  # Fixed style text after notebook source.
    current_prompt: str,  # Current question after live variable expansion.
    executed_messages: list[Msg],  # Completed assistant/tool groups to preserve.
) -> BuiltContext:  # Messages and per-round accounting.
    """Fit schemas and fixed messages first, then nearest units without gaps."""
    tool_schema_chars = json_chars(tools)
    current = Msg("user", [Text(current_prompt)])
    empty_system = Msg("system", [Text(system_prefix + system_suffix)])
    fixed = tool_schema_chars + messages_chars([empty_system, current, *executed_messages])
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
    for unit in units:
        if unit.kind == "pair":
            assert unit.prompt is not None and unit.answer is not None
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
        full = _source_label(cell, partial=False) + cell["source"]
        cost = _escaped_chars(full) + separator
        if used + cost <= MAX_CONTEXT_CHARS:
            selected_sources.append((unit.anchor, cell, full, len(cell["source"]), False))
            used += cost
            continue
        partial = _partial_suffix(cell, MAX_CONTEXT_CHARS - used - separator)
        if partial:
            retained = len(partial) - len(_source_label(cell, partial=True))
            selected_sources.append((unit.anchor, cell, partial, retained, True))
            used += _escaped_chars(partial) + separator
        break

    selected_sources.sort(key=lambda item: item[0])
    selected_pairs.sort(key=lambda item: item.anchor)
    source_text = "\n\n".join(item[2] for item in selected_sources)
    system = Msg("system", [Text(system_prefix + source_text + system_suffix)])
    history = []
    for pair in selected_pairs:
        assert pair.prompt is not None and pair.answer is not None
        history.extend([Msg("user", [Text(pair.prompt["source"])]),
                        Msg("assistant", [Text(pair.answer["source"])])])
    messages = [system, *history, current, *executed_messages]
    exact = tool_schema_chars + messages_chars(messages)
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
    return BuiltContext(messages, counts)

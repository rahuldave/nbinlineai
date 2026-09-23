"""Nearest-first source/history selection and serialized character budget."""

import pytest
from aidialog.msg_parts import Msg, ToolResult, ToolUse

from nbinlineai import context_budget
from nbinlineai.context_budget import (
    ContextWindowExceededError,
    build_context,
    eligible_units,
    json_chars,
    messages_chars,
)


def _source(
    cell_id: str,  # Notebook cell ID.
    text: str,  # Ordinary Markdown source.
) -> dict:  # Browser preceding-cell entry.
    """Make one ordinary Markdown source cell."""
    return {"id": cell_id, "cell_type": "markdown", "source": text}


def _pair(
    prompt_id: str,  # Prior AI question ID.
    question: str,  # Prior question source.
    answer: str,  # Completed answer source.
) -> list[dict]:  # Two browser preceding-cell entries.
    """Make one complete prior AI exchange."""
    return [
        {"id": prompt_id, "cell_type": "markdown", "source": question,
         "metadata": {"nbinlineai": {"isPromptCell": True}}},
        {"id": prompt_id + "-answer", "cell_type": "markdown", "source": answer,
         "metadata": {"nbinlineai": {"isOutputCell": True, "promptCellId": prompt_id,
                                      "status": "done"}}},
    ]


def test_mixed_units_restore_chronology_and_count_wrappers() -> None:
    """Pair messages and ordinary source keep notebook order after nearest-first fit."""
    cells = [_source("old", "Old note"), *_pair("q1", "Earlier question", "Earlier answer"),
             {"id": "near", "cell_type": "code", "source": "x = 7", "execution_count": 2}]
    built = build_context(cells, eligible_units(cells), [], "Prefix\n", "\nSuffix", "Now?", [])
    assert built.messages[0].text.index("Old note") < built.messages[0].text.index("x = 7")
    assert [(message.role, message.text) for message in built.messages[1:]] == [
        ("user", "Earlier question"), ("assistant", "Earlier answer"), ("user", "Now?")
    ]
    assert built.counts["cell_count"] == built.counts["preceding_cell_count"] == 4
    assert built.counts["omitted_cell_count"] == 0
    assert built.counts["context_chars"] == (
        json_chars([]) + messages_chars(built.messages)
    )
    assert built.counts["context_budget_chars"] == 64_000


def test_atomic_pair_boundary_stops_before_older_small_source(
    monkeypatch: pytest.MonkeyPatch,  # Lower budget for a focused boundary.
) -> None:
    """A too-large pair cannot be split or skipped to admit an older small cell."""
    monkeypatch.setattr(context_budget, "MAX_CONTEXT_CHARS", 700)
    cells = [_source("old", "SHOULD_STAY_OUT"), *_pair("q1", "Q" * 1_000, "A" * 100),
             _source("near", "NEAREST")]
    built = build_context(cells, eligible_units(cells), [], "Prefix\n", "\nSuffix", "Now?", [])
    assert "NEAREST" in built.messages[0].text
    assert "SHOULD_STAY_OUT" not in built.messages[0].text
    assert not any("Q" * 100 in message.text for message in built.messages[1:])
    assert built.counts["cell_count"] == 1
    assert built.counts["omitted_cell_count"] == 3
    assert built.counts["source_truncated"] and built.counts["history_truncated"]


def test_boundary_source_keeps_nearest_suffix_with_partial_label(
    monkeypatch: pytest.MonkeyPatch,  # Lower budget for a focused boundary.
) -> None:
    """Keep a suffix from one source cell and omit its oldest beginning."""
    monkeypatch.setattr(context_budget, "MAX_CONTEXT_CHARS", 650)
    cells = [_source("old", "BEGIN" + "x" * 1_000 + "END"), _source("near", "LATEST")]
    built = build_context(cells, eligible_units(cells), [], "Prefix\n", "\nSuffix", "Now?", [])
    system = built.messages[0].text
    assert "LATEST" in system and "END" in system and "BEGIN" not in system
    assert "partial; nearest source suffix retained" in system
    assert built.counts["partial_cell_count"] == 1
    assert built.counts["cell_count"] == 2 and built.counts["omitted_cell_count"] == 0
    assert built.counts["source_truncated"] and not built.counts["history_truncated"]
    assert built.counts["context_chars"] <= 650


def test_executed_tool_group_is_preserved_while_old_source_shrinks(
    monkeypatch: pytest.MonkeyPatch,  # Lower budget for one simulated tool round.
) -> None:
    """Rebudget preceding cells, keeping the current prompt and tool pair whole."""
    monkeypatch.setattr(context_budget, "MAX_CONTEXT_CHARS", 1_200)
    cells = [_source("old", "o" * 700), _source("near", "NEAR")]
    units = eligible_units(cells)
    first = build_context(cells, units, [], "Prefix\n", "\nSuffix", "Now?", [])
    call = ToolUse(id="c1", name="sum", arguments={"value": 1},
                   raw={"reasoning": "preserved-provider-raw"})
    executed = [Msg("assistant", [call]), Msg("tool", [ToolResult(
        id="c1", name="sum", arguments={"value": 1}, text="R" * 200
    )])]
    second = build_context(cells, units, [], "Prefix\n", "\nSuffix", "Now?", executed)
    assert second.counts["source_chars"] < first.counts["source_chars"]
    assert second.messages[-2:] == executed
    assert second.messages[-3].text == "Now?"
    assert second.counts["context_chars"] <= 1_200
    assert second.counts["context_chars"] == json_chars([]) + messages_chars(second.messages)


def test_fixed_material_overflow_is_actionable_and_never_discards_tool_round(
    monkeypatch: pytest.MonkeyPatch,  # Lower budget for overflow.
) -> None:
    """Reject a fixed prompt/tool group that cannot fit by itself."""
    monkeypatch.setattr(context_budget, "MAX_CONTEXT_CHARS", 500)
    executed = [Msg("assistant", [ToolUse(id="c1", name="sum", arguments={})]),
                Msg("tool", [ToolResult(id="c1", name="sum", text="R" * 700)])]
    with pytest.raises(ContextWindowExceededError, match="Shorten the prompt"):
        build_context([], [], [], "Prefix", "Suffix", "Now?", executed)


def test_nonadjacent_pair_and_dual_role_response_handling() -> None:
    """A moved linked output pairs once; malformed response flags never become source."""
    pair = _pair("q1", "Question", "Answer")
    cells = [
        pair[0], _source("between", "Between"), pair[1],
        {"id": "dual", "cell_type": "markdown", "source": "GENERATED",
         "metadata": {"nbinlineai": {"isPromptCell": True, "isOutputCell": True}}},
    ]
    units = eligible_units(cells)
    assert [unit.kind for unit in units] == ["pair", "source"]
    built = build_context(cells, units, [], "", "", "Now?", [])
    assert "GENERATED" not in built.messages[0].text
    assert [(message.role, message.text) for message in built.messages[1:3]] == [
        ("user", "Question"), ("assistant", "Answer")
    ]


def test_many_short_pairs_count_message_array_separators(
    monkeypatch: pytest.MonkeyPatch,  # Small context limit for many pair wrappers.
) -> None:
    """Never undercount JSON brackets or commas between prior turns."""
    monkeypatch.setattr(context_budget, "MAX_CONTEXT_CHARS", 5_000)
    cells = [cell for number in range(100) for cell in _pair(
        f"q{number}", f"Q{number} \\\\ \n", f"A{number} \" quoted"
    )]
    built = build_context(cells, eligible_units(cells), [], "Prefix", "Suffix", "Now?", [])
    assert built.counts["history_truncated"] is True
    assert built.counts["cell_count"] % 2 == 0
    assert built.counts["context_chars"] <= 5_000
    assert built.counts["context_chars"] == json_chars([]) + messages_chars(built.messages)

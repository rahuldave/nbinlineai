"""Versioned notebook context selection and provider-free preview."""

import asyncio

import pytest
from aidialog.msg_parts import Msg, ToolResult, ToolUse

from nbinlineai.context_budget import build_context
from nbinlineai.context_selection import select_context
from nbinlineai.prompt import preview_context, run_prompt, validate_request


def cell(cell_id, source="text", *, role=None, link=None, status="done", kind="markdown",
         include=True, tools=True):
    metadata = {}
    if role == "question":
        metadata = {"nbinlineai": {"isPromptCell": True}}
    elif role == "answer":
        metadata = {"nbinlineai": {"isOutputCell": True, "promptCellId": link, "status": status}}
    return {"id": cell_id, "cell_type": kind, "source": source,
            "metadata": metadata, "context_include": include, "tools_include": tools}


def request(cells, mode="default", prompt="Explain"):
    cells = [{**entry, "source": prompt} if entry["id"] == "current" else entry for entry in cells]
    return {"snapshot_version": 1, "notebook_cells": cells, "context_mode": mode,
            "prompt": prompt, "session_id": "s", "prompt_cell_id": "current",
            "backend": "openai_api", "model": "test-model", "preview_generation": "rev-1"}


def test_physical_window_skips_own_answer_and_does_not_extend_ineligible_slots():
    before = [cell(f"b{i}") for i in range(12)]
    after = [cell("own-answer", role="answer", link="current"),
             cell("raw", kind="raw"), *[cell(f"a{i}") for i in range(11)]]
    cells = [*before, cell("current", role="question"), *after]
    selection = select_context(cells, "current", "ten-above-below")
    assert selection.report["selected_cell_ids"] == [
        *[f"b{i}" for i in range(2, 12)], *[f"a{i}" for i in range(9)]
    ]
    assert {"id": "raw", "reason": "raw-cell"} in selection.report["ineligible_cells"]
    assert {"id": "own-answer", "reason": "answer-to-current-question"} in selection.report["ineligible_cells"]


def test_independent_ai_source_and_prior_pair_roles():
    cells = [cell("q1", "old question", role="question"),
             cell("a1", "old answer", role="answer", link="q1"),
             cell("q2", "solo question", role="question"),
             cell("a2", "unchecked answer", role="answer", link="q2", include=False),
             cell("current", role="question"),
             cell("q3", "later question", role="question"),
             cell("a3", "later answer", role="answer", link="q3")]
    selection = select_context(cells, "current", "custom")
    assert [unit.kind for unit in selection.units].count("pair") == 1
    built = build_context(cells, selection.units, [], "Prefix\n", "\nSuffix", "Now?", [], selection.report)
    assert [(message.role, message.text) for message in built.messages[1:3]] == [
        ("user", "old question"), ("assistant", "old answer")]
    system = built.messages[0].text
    assert "AI question cell q2 (notebook source above)" in system
    assert "AI question cell q3 (notebook source below)" in system
    assert "AI answer cell a3 (notebook source below; linked question q3)" in system
    assert "unchecked answer" not in system


def test_below_boundary_keeps_prefix_and_reports_ids(monkeypatch):
    from nbinlineai import context_budget

    monkeypatch.setattr(context_budget, "MAX_CONTEXT_CHARS", 900)
    cells = [cell("current", role="question"), cell("later", "BEGIN" + "x" * 1000 + "END")]
    selected = select_context(cells, "current", "full-notebook")
    built = build_context(cells, selected.units, [], "Prefix\n", "\nSuffix", "Now?", [], selected.report)
    assert built.counts["partial_cell_ids"] == ["later"]
    assert built.counts["partial_cells"] == [{"id": "later", "retained": "prefix"}]
    assert "BEGIN" in built.messages[0].text and "END" not in built.messages[0].text


def test_versioned_validation_rejects_duplicate_and_missing_target():
    body = request([cell("current", role="question")])
    assert validate_request(body.copy(), preview=True)["context_mode"] == "default"
    with pytest.raises(ValueError, match="unique"):
        validate_request({**body, "notebook_cells": [cell("current"), cell("current")]}, preview=True)
    with pytest.raises(ValueError, match="missing"):
        validate_request({**body, "notebook_cells": [cell("other")]}, preview=True)
    with pytest.raises(ValueError, match="Current cell must"):
        validate_request({**body, "notebook_cells": [cell("current")]}, preview=True)
    with pytest.raises(ValueError, match="changed"):
        validate_request({**body, "prompt": "Different"}, preview=True)


def test_default_explains_unpaired_ai_cells_and_orphan_answers():
    cells = [cell("solo", "question", role="question"),
             cell("invalid-link", "answer", role="answer", link="ordinary"),
             cell("ordinary", "note"), cell("current", role="question")]
    selected = select_context(cells, "current", "default")
    reasons = {item["id"]: item["reason"] for item in selected.report["ineligible_cells"]}
    assert reasons["solo"] == "default-requires-earlier-complete-pair"
    assert reasons["invalid-link"] == "orphan-answer"
    assert selected.report["selected_cell_ids"] == ["ordinary"]


def test_default_legacy_empty_pair_is_not_both_included_and_ineligible():
    cells = [cell("q", "", role="question"), cell("a", "done", role="answer", link="q"),
             cell("current", role="question")]
    selected = select_context(cells, "current", "default")
    assert [unit.kind for unit in selected.units] == ["pair"]
    assert selected.report["selected_cell_ids"] == ["q", "a"]
    assert not ({"q", "a"} & {item["id"] for item in selected.report["ineligible_cells"]})


def test_snapshot_limits_version_and_metadata_are_validated():
    base = request([cell("current", role="question")])
    with pytest.raises(ValueError, match="at most 10000"):
        validate_request({**base, "notebook_cells": [cell(f"c{i}") for i in range(10_001)]}, preview=True)
    with pytest.raises(ValueError, match="4000000"):
        validate_request({**base, "notebook_cells": [cell("current", "x" * 4_000_001,
                                                         role="question")]}, preview=True)
    with pytest.raises(ValueError, match="Unsupported notebook snapshot version"):
        validate_request({**base, "snapshot_version": 2}, preview=True)
    for invalid in (True, 1.0):
        with pytest.raises(ValueError, match="Unsupported notebook snapshot version"):
            validate_request({**base, "snapshot_version": invalid}, preview=True)
    with pytest.raises(ValueError, match="Invalid preview generation"):
        validate_request({**base, "preview_generation": True}, preview=True)
    with pytest.raises(TypeError, match="Invalid AI cell metadata"):
        validate_request({**base, "notebook_cells": [{**cell("current", role="question"),
            "metadata": {"nbinlineai": "bad"}}]}, preview=True)
    with pytest.raises(ValueError, match="Invalid context mode"):
        validate_request({**base, "context_mode": ["default"]}, preview=True)


class Dispatcher:
    def __init__(self):
        self.inspected = []

    async def inspect_preview(self, kernel_id, kernel, variables, functions):
        self.inspected.append((variables, functions))
        return {**({"value": {"repr": "42"}} if variables else {}),
                **{name: {"docstring": "registered", "parameters": {}} for name in functions}}

    async def inspect(self, kernel_id, kernel, variables, functions):
        return await self.inspect_preview(kernel_id, kernel, variables, functions)


def test_preview_and_execution_first_round_match_without_provider_or_tools(monkeypatch):
    from nbinlineai import providers

    cells = [cell("old", "note"), cell("current", role="question"), cell("later", "tail")]
    body = validate_request(request(cells, "full-notebook", "What is $`value`?"), preview=True)
    dispatcher = Dispatcher()
    calls = []

    async def complete(*args, **kwargs):
        calls.append(args)
        raise RuntimeError("stop after first report")

    monkeypatch.setattr(providers, "complete", complete)
    async def exercise():
        preview = await preview_context(body, dispatcher, "kernel", object())
        assert not calls
        assert preview["variables"]["value"]["repr"] == "42"
        events = run_prompt(body, dispatcher, "kernel", object())
        first = await anext(events)
        assert first == preview
        await events.aclose()

    asyncio.run(exercise())
    assert not calls
    assert dispatcher.inspected == [(["value"], []), (["value"], [])]


@pytest.mark.parametrize("mode", ["default", "current-only", "full-notebook", "all-above", "ten-above",
                                  "ten-above-below", "custom"])
def test_tool_inheritance_ignores_prose_selection_and_below_declarations(mode):
    cells = [cell("declaration", "Use &`helper`", include=False),
             *[cell(f"filler-{index}", "x") for index in range(12)],
             cell("current", role="question"), cell("later", "Use &`later_tool`")]
    body = validate_request(request(cells, mode, "What is $`value`?"), preview=True)
    dispatcher = Dispatcher()
    report = asyncio.run(preview_context(body, dispatcher, "kernel", object()))
    assert report["tools"] == ["helper"]
    assert dispatcher.inspected == [(["value"], ["helper"])]
    if mode in ("current-only", "ten-above", "ten-above-below", "custom"):
        assert "declaration" not in report["included_cell_ids"]


def test_tool_flag_filters_disabled_declarations_but_duplicate_enabled_one_survives():
    cells = [cell("disabled", "&`shared` &`missing`", tools=False),
             cell("enabled", "&`shared`"),
             cell("current", role="question"),
             cell("below", "&`below_missing`")]
    body = validate_request(request(cells, "current-only", "Explain"), preview=True)
    dispatcher = Dispatcher()
    report = asyncio.run(preview_context(body, dispatcher, "kernel", object()))
    assert report["selected_cell_ids"] == []
    assert report["included_cell_ids"] == []
    assert report["tools"] == ["shared"]
    assert dispatcher.inspected == [([], ["shared"])]
    assert report["tool_disabled_cell_ids"] == ["disabled"]


def test_current_question_can_disable_own_tools_without_affecting_live_values():
    cells = [cell("earlier", "&`earlier_tool`"),
             cell("current", role="question", tools=False)]
    body = validate_request(request(cells, "all-above",
                                    "Use &`missing_current` and $`value`."), preview=True)
    dispatcher = Dispatcher()

    async def exercise():
        report = await preview_context(body, dispatcher, "kernel", object())
        stream = run_prompt(body, dispatcher, "kernel", object())
        actual = await anext(stream)
        await stream.aclose()
        assert actual == report
        assert report["tools"] == ["earlier_tool"]
        assert report["variables"]["value"]["repr"] == "42"
        assert "missing_current" not in dispatcher.inspected[0][1]

    asyncio.run(exercise())


def test_reference_cap_applies_after_tool_flags_filter_disabled_cells():
    disabled = cell("disabled", " ".join(f"&`tool_{index}`" for index in range(21)), tools=False)
    cells = [disabled, cell("current", role="question")]
    body = validate_request(request(cells, "current-only", "Explain"), preview=True)
    report = asyncio.run(preview_context(body, Dispatcher(), "kernel", object()))
    assert report["tools"] == []
    enabled = validate_request(request([{**disabled, "tools_include": True}, cells[1]],
                                       "current-only", "Explain"), preview=True)
    with pytest.raises(ValueError, match="limit 20"):
        asyncio.run(preview_context(enabled, Dispatcher(), "kernel", object()))


def test_tool_flag_validation_rejects_non_boolean():
    base = request([cell("current", role="question")])
    with pytest.raises(TypeError, match="tools_include"):
        validate_request({**base, "notebook_cells": [{**base["notebook_cells"][0],
                                                       "tools_include": "false"}]}, preview=True)


def test_moved_current_answers_and_straddling_pairs_are_source_only():
    cells = [cell("own-moved", "old answer to current", role="answer", link="current"),
             cell("q", "straddling question", role="question"),
             cell("current", role="question"),
             cell("a", "straddling answer", role="answer", link="q"),
             cell("own-later", "second answer to current", role="answer", link="current")]
    selected = select_context(cells, "current", "full-notebook")
    assert {"own-moved", "own-later"}.isdisjoint(selected.report["selected_cell_ids"])
    assert all(unit.kind == "source" for unit in selected.units)
    built = build_context(cells, selected.units, [], "P\n", "\nS", "Now", [], selected.report)
    assert "straddling question" in built.messages[0].text
    assert "straddling answer" in built.messages[0].text
    assert "old answer to current" not in built.messages[0].text


def test_duplicate_completed_answers_latest_prior_pair_and_earlier_source():
    cells = [cell("q", "question", role="question"),
             cell("a1", "first answer", role="answer", link="q"),
             cell("a2", "second answer", role="answer", link="q"),
             cell("current", role="question")]
    selected = select_context(cells, "current", "all-above")
    pairs = [unit for unit in selected.units if unit.kind == "pair"]
    assert len(pairs) == 1 and pairs[0].answer["id"] == "a2"
    assert any(unit.cell and unit.cell["id"] == "a1" for unit in selected.units)


def test_above_boundary_keeps_suffix_and_default_checks_only_fitted(monkeypatch):
    from nbinlineai import context_budget

    monkeypatch.setattr(context_budget, "MAX_CONTEXT_CHARS", 900)
    cells = [cell("old", "START" + "x" * 1000 + "END"),
             cell("near", "Near"), cell("current", role="question")]
    selection = select_context(cells, "current", "default")
    built = build_context(cells, selection.units, [], "P\n", "\nS", "Now", [], selection.report)
    assert built.counts["partial_cell_ids"] == ["old"]
    assert built.counts["partial_cells"] == [{"id": "old", "retained": "suffix"}]
    assert built.counts["selected_cell_ids"] == built.counts["included_cell_ids"]
    assert "END" in built.messages[0].text and "START" not in built.messages[0].text


def test_new_mode_rebudgets_below_source_without_replaying_tool_group(monkeypatch):
    from nbinlineai import context_budget

    monkeypatch.setattr(context_budget, "MAX_CONTEXT_CHARS", 1_600)
    cells = [cell("q", "prior question", role="question"),
             cell("a", "prior answer", role="answer", link="q"),
             cell("current", role="question"), cell("below", "BEGIN" + "x" * 850 + "END")]
    selected = select_context(cells, "current", "full-notebook")
    first = build_context(cells, selected.units, [], "P\n", "\nS", "Now", [], selected.report)
    call = ToolUse(id="c1", name="helper", arguments={}, raw={"reasoning": "preserve"})
    executed = [Msg("assistant", [call]), Msg("tool", [ToolResult(
        id="c1", name="helper", arguments={}, text="result" * 45)])]
    second = build_context(cells, selected.units, [], "P\n", "\nS", "Now", executed, selected.report)
    assert first.counts["partial_cell_ids"] == []
    assert second.counts["partial_cell_ids"] == ["below"]
    assert second.counts["partial_cells"] == [{"id": "below", "retained": "prefix"}]
    assert second.messages[1:3] == first.messages[1:3]
    assert second.messages[-2:] == executed
    assert sum(message.role == "tool" for message in second.messages) == 1
    assert second.counts["context_chars"] <= 1_600


def test_preview_budget_parity_with_unicode_escaping_live_value_and_tool_schema():
    cells = [cell("declaration", "&`helper`"),
             cell("long", 'BEGIN "\\\n🌌' + "字" * 70_000 + "END"),
             cell("current", role="question")]
    body = validate_request(request(cells, "all-above", "Explain $`value`"), preview=True)

    class LargeDispatcher(Dispatcher):
        async def inspect_preview(self, kernel_id, kernel, variables, functions):
            self.inspected.append((variables, functions))
            return {"value": {"repr": "🍀" * 1900},
                    "helper": {"docstring": 'quoted "\\\n' + "漢" * 950, "parameters": {}}}

    async def exercise():
        dispatcher = LargeDispatcher()
        preview = await preview_context(body, dispatcher, "kernel", object())
        stream = run_prompt(body, dispatcher, "kernel", object())
        actual = await anext(stream)
        await stream.aclose()
        assert actual == preview
        assert preview["tools"] == ["helper"]
        assert preview["tool_schema_chars"] > 950
        assert preview["partial_cell_ids"] == ["long"]
        assert preview["context_chars"] <= preview["context_budget_chars"]

    asyncio.run(exercise())

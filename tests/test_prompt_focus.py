"""Notebook landmarks and shared task focus in provider payloads."""

import asyncio

import pytest
from aidialog.msg_parts import Completion, Msg, Text

from nbinlineai import context_budget, providers
from nbinlineai.context_budget import build_context
from nbinlineai.context_selection import select_context
from nbinlineai.prompt import PROMPT_MODE_INSTRUCTIONS, preview_context, run_prompt
from nbinlineai.prompt_focus import locate_focus


def cell(cell_id, source, kind="markdown", ai=None, include=True):
    return {"id": cell_id, "cell_type": kind, "source": source,
            "metadata": {"nbinlineai": ai} if ai else {}, "context_include": include}


def body(cells, prompt="Explain the code above", mode="default", style="compact", **extra):
    return {"snapshot_version": 1, "notebook_cells": cells, "context_mode": mode,
            "prompt": prompt, "prompt_cell_id": "current", "session_id": "s",
            "backend": "openai_api", "model": "fake", "max_tool_steps": 0,
            "prompt_mode": style, **extra}


def current(prompt="Explain the code above"):
    return cell("current", prompt, ai={"isPromptCell": True})


@pytest.mark.parametrize("backend", ["openai_api", "anthropic_api"])
@pytest.mark.parametrize("style", ["compact", "full", "learning"])
def test_shared_focus_and_raw_ai_history_reach_both_providers(monkeypatch, backend, style):
    cells = [cell("heading", "# Analysis"), cell("code", "value = 7", kind="code"),
             cell("old-q", "What is value?", ai={"isPromptCell": True}),
             cell("old-a", "Seven.", ai={"isOutputCell": True, "promptCellId": "old-q",
                                               "status": "done"}), current()]
    captured = {}

    async def fake_complete(selected, model, messages, tools):
        captured.update(backend=selected, messages=messages)
        return Completion(model, Msg("assistant", [Text("OK")]))

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def exercise():
        return [event async for event in run_prompt({**body(cells, style=style), "backend": backend},
                                                    None, "kernel", None)]

    events = asyncio.run(exercise())
    assert captured["backend"] == backend
    system = captured["messages"][0].text
    assert "latest question defines the task" in system
    assert "selected notebook material is background" in system
    assert "Immediate cell above: id=old-a; position=00004; type=AI-response; status=FULL; chat=00001A" in system
    assert "Nearest code above: id=code; position=00002; type=code; status=FULL" in system
    assert "Section heading above: id=heading; position=00001; type=markdown; status=FULL" in system
    assert PROMPT_MODE_INSTRUCTIONS[style] in system
    assert [(message.role, message.text) for message in captured["messages"][1:]] == [
        ("user", "What is value?"), ("assistant", "Seven."),
        ("user", "Explain the code above")]
    assert events[0]["context_chars"] <= events[0]["context_budget_chars"]


def test_excluded_nearest_code_is_not_replaced_by_older_included_code(monkeypatch):
    cells = [cell("older", "older_value = 1", kind="code"),
             cell("nearest", "SECRET_EXCLUDED = 2", kind="code", include=False), current()]
    captured = {}

    async def fake_complete(backend, model, messages, tools):
        captured["system"] = messages[0].text
        return Completion(model, Msg("assistant", [Text("OK")]))

    monkeypatch.setattr(providers, "complete", fake_complete)
    asyncio.run(_collect(run_prompt(body(cells, mode="custom"), None, "kernel", None)))
    system = captured["system"]
    assert "Nearest code above: id=nearest; position=00002; type=code; status=EXCL" in system
    assert "older_value = 1" in system
    assert "SECRET_EXCLUDED = 2" not in system


@pytest.mark.parametrize("backend", ["openai_api", "anthropic_api"])
def test_current_only_reports_unavailable_targets_without_source(monkeypatch, backend):
    cells = [cell("section", "# Private heading\nDO_NOT_SEND"),
             cell("code", "PRIVATE_CODE = 1", kind="code"), current("Explain this section")]
    captured = {}

    async def fake_complete(backend, model, messages, tools):
        captured["system"] = messages[0].text
        return Completion(model, Msg("assistant", [Text("OK")]))

    monkeypatch.setattr(providers, "complete", fake_complete)
    asyncio.run(_collect(run_prompt({**body(cells, prompt="Explain this section", mode="current-only",
                                          prompt_instructions="Answer in my own format."),
                                     "backend": backend}, None,
                                    "kernel", None)))
    system = captured["system"]
    assert "Section heading above: id=section; position=00001; type=markdown; status=EXCL" in system
    assert "Nearest code above: id=code; position=00002; type=code; status=EXCL" in system
    assert "DO_NOT_SEND" not in system and "PRIVATE_CODE" not in system
    assert "Answer in my own format." in system
    assert "latest question defines the task" in system


def test_heading_parser_ignores_fences_and_indented_fake_headings():
    cells = [cell("real", "## Genuine section"),
             cell("fenced", "```python\n# Not a heading\n```"),
             cell("indented", "    # Also not a heading"),
             cell("tilde", "~~~\n### Neither is this\n~~~"), current("Explain this section")]
    focus = locate_focus(cells, "current")
    assert focus.heading.cell["id"] == "real"
    assert [entry["id"] for entry in focus.section_cells] == [
        "real", "fenced", "indented", "tilde"]


def test_budget_rounds_recompute_partial_landmarks_and_preview_parity(monkeypatch):
    cells = [cell("heading", "# Section"), cell("target", "START" + "x" * 1800 + "END", kind="code"),
             current()]
    request = body(cells)
    selection = select_context(cells, "current", "default")
    focus = locate_focus(cells, "current")
    baseline = build_context(cells, [], [], "Shared", "Style", request["prompt"], [],
                             selection.report, focus).counts["context_chars"]
    with monkeypatch.context() as budget_patch:
        budget_patch.setattr(context_budget, "MAX_CONTEXT_CHARS", baseline + 1100)
        first = build_context(cells, selection.units, [], "Shared", "Style", request["prompt"], [],
                              selection.report, focus)
        second = build_context(cells, selection.units, [], "Shared", "Style", request["prompt"],
                               [Msg("assistant", [Text("y" * 700)])], selection.report, focus)
        third = build_context(cells, selection.units, [], "Shared", "Style", request["prompt"],
                              [Msg("assistant", [Text("y" * 900)])], selection.report, focus)
        assert first.counts["context_chars"] <= context_budget.MAX_CONTEXT_CHARS
        assert second.counts["context_chars"] <= context_budget.MAX_CONTEXT_CHARS
        assert third.counts["context_chars"] <= context_budget.MAX_CONTEXT_CHARS
    assert "Nearest code above: id=target; position=00002; type=code; status=PART" in first.messages[0].text
    assert "Nearest code above: id=target; position=00002; type=code; status=PART" in second.messages[0].text
    assert first.counts["source_chars"] > second.counts["source_chars"]
    assert "Nearest code above: id=target; position=00002; type=code; status=OMIT" in third.messages[0].text
    assert third.counts["source_chars"] == 0

    # Preview and the first provider round use the same builder and snapshot.
    captured = {}

    async def fake_complete(backend, model, messages, tools):
        captured["system"] = messages[0].text
        return Completion(model, Msg("assistant", [Text("OK")]))

    monkeypatch.setattr(providers, "complete", fake_complete)

    async def exercise():
        preview = await preview_context(request, None, "kernel", None)
        events = await _collect(run_prompt(request, None, "kernel", None))
        return preview, events

    preview, events = asyncio.run(exercise())
    assert preview["context_chars"] == events[0]["context_chars"]
    assert preview["partial_cell_ids"] == events[0]["partial_cell_ids"]
    assert "Notebook cell landmarks:" in captured["system"]


async def _collect(stream):
    return [event async for event in stream]

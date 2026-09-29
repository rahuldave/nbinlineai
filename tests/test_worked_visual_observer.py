"""The visual guard tests use a synthetic prompt generator; no server or model."""

import asyncio
import json
import os
from pathlib import Path

import pytest

from scripts.worked_visual_observer import VisualObserver, arm_question

SECRET = "private-prompt-and-cell-source"
BINDING = {
    "session_id": "session", "kernel_id": "kernel", "path": "trial.ipynb",
    "prompt_cell_id": "question", "backend": "openai_codex_subscription",
    "model": "gpt-6-sol", "max_tool_steps": 2,
}
LIST = {"name": "list_cells", "arguments": {"start": {"equals": 0}, "limit": {"equals": 20}}}
EDIT = {"name": "set_cell_source", "arguments": {
    "cell_id": {"one_of": ["cell-1"]}, "source": {"text_max": 200},
}}


def _private(tmp_path):
    directory = tmp_path / "private"
    directory.mkdir(mode=0o700)
    return directory


def _events(*calls, done_steps=1):
    yield {"type": "context", "prompt": SECRET}
    for index, (name, arguments) in enumerate(calls):
        yield {"type": "tool_start", "id": f"call-{index}", "name": name, "arguments": arguments}
        yield {"type": "tool_result", "id": f"call-{index}", "name": name, "text": SECRET}
    yield {"type": "context"}
    yield {"type": "done", "tool_steps": done_steps, "model": "gpt-6-sol"}


async def _collect(observer, body=None, scope=None):
    return [event async for event in observer(body or BINDING, None, "kernel", None,
                                               subscription_scope=scope or {
                                                   "session_id": "session", "notebook_path": "trial.ipynb",
                                               })]


def test_success_forwards_events_and_logs_no_payload(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST]])
    source = list(_events(("list_cells", {"start": 0, "limit": 20})))

    async def original(*_args, **_kwargs):
        for event in source:
            yield event

    observer = VisualObserver(directory, original)
    try:
        assert asyncio.run(_collect(observer)) == source
        with pytest.raises(ValueError, match="fresh valid arm"):
            asyncio.run(_collect(observer))
    finally:
        observer.close()
    log_path = directory / "events.jsonl"
    log = log_path.read_text()
    assert SECRET not in log
    assert "session" not in log and "trial.ipynb" not in log
    assert stat_mode(log_path) == 0o600
    records = [json.loads(line) for line in log.splitlines()]
    assert [record["kind"] for record in records[:4]] == [
        "admitted", "tool_start", "tool_result", "terminal",
    ]
    assert records[2]["state"] == "returned"


def stat_mode(path: Path):
    return path.stat().st_mode & 0o777


@pytest.mark.parametrize("name,arguments", [
    ("delete_cell", {"cell_id": "cell-1"}),
    ("list_cells", {"start": 1, "limit": 20}),
    ("list_cells", {"start": 0, "limit": 20, "source": SECRET}),
])
def test_blocks_before_effect(tmp_path, name, arguments):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST]])
    effects = []

    async def original(*_args, **_kwargs):
        yield {"type": "context"}
        yield {"type": "tool_start", "id": "call", "name": name, "arguments": arguments}
        effects.append(name)
        yield {"type": "tool_result", "id": "call", "name": name, "text": SECRET}

    observer = VisualObserver(directory, original)
    try:
        with pytest.raises(ValueError, match="blocked"):
            asyncio.run(_collect(observer))
    finally:
        observer.close()
    assert effects == []
    assert SECRET not in (directory / "events.jsonl").read_text()


def test_binding_mismatch_consumes_arm_without_advancing(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST]])
    started = []

    async def original(*_args, **_kwargs):
        started.append(True)
        yield {"type": "done", "tool_steps": 0}

    observer = VisualObserver(directory, original)
    try:
        with pytest.raises(ValueError, match="did not match"):
            asyncio.run(_collect(observer, {**BINDING, "model": "other"}))
        with pytest.raises(ValueError, match="fresh valid arm"):
            asyncio.run(_collect(observer))
    finally:
        observer.close()
    assert started == []
    assert not (directory / "arm.json").exists()


def test_two_calls_in_one_group_block_duplicate_before_its_effect(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST]])
    effects = []

    async def original(*_args, **_kwargs):
        yield {"type": "context"}
        for index in range(2):
            yield {"type": "tool_start", "id": str(index), "name": "list_cells",
                   "arguments": {"start": 0, "limit": 20}}
            effects.append(index)
            yield {"type": "tool_result", "id": str(index), "name": "list_cells", "text": "{}"}

    observer = VisualObserver(directory, original)
    try:
        with pytest.raises(ValueError, match="unexpected tool"):
            asyncio.run(_collect(observer))
    finally:
        observer.close()
    assert effects == [0]


def test_two_group_read_then_edit_and_exact_count(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST], [EDIT]])
    source = [
        {"type": "context"},
        {"type": "tool_start", "id": "read", "name": "list_cells", "arguments": {"start": 0, "limit": 20}},
        {"type": "tool_result", "id": "read", "name": "list_cells", "text": SECRET},
        {"type": "context"},
        {"type": "tool_start", "id": "edit", "name": "set_cell_source",
         "arguments": {"cell_id": "cell-1", "source": SECRET}},
        {"type": "tool_result", "id": "edit", "name": "set_cell_source", "text": "ok"},
        {"type": "context"},
        {"type": "done", "tool_steps": 2},
    ]

    async def original(*_args, **_kwargs):
        for event in source:
            yield event

    observer = VisualObserver(directory, original)
    try:
        assert asyncio.run(_collect(observer)) == source
    finally:
        observer.close()
    assert SECRET not in (directory / "events.jsonl").read_text()


def test_allowed_multi_call_group_preserves_order(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST, EDIT]])
    source = list(_events(("list_cells", {"start": 0, "limit": 20}),
                          ("set_cell_source", {"cell_id": "cell-1", "source": SECRET})))

    async def original(*_args, **_kwargs):
        for event in source:
            yield event

    observer = VisualObserver(directory, original)
    try:
        assert asyncio.run(_collect(observer)) == source
    finally:
        observer.close()
    log = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
    assert [(item["group"], item["call"], item["name"]) for item in log
            if item["kind"] == "tool_start"] == [(0, 0, "list_cells"), (0, 1, "set_cell_source")]


def test_error_and_active_prompt_require_fresh_arm(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST]])
    entered = asyncio.Event()
    release = asyncio.Event()

    async def original(*_args, **_kwargs):
        yield {"type": "context"}
        entered.set()
        await release.wait()
        raise RuntimeError(SECRET)
        yield  # make this an async generator

    observer = VisualObserver(directory, original)

    async def scenario():
        first = asyncio.create_task(_collect(observer))
        await entered.wait()
        with pytest.raises(ValueError, match="active question"):
            await _collect(observer)
        release.set()
        with pytest.raises(RuntimeError, match=SECRET):
            await first
        with pytest.raises(ValueError, match="fresh valid arm"):
            await _collect(observer)

    try:
        asyncio.run(scenario())
    finally:
        observer.close()
    assert SECRET not in (directory / "events.jsonl").read_text()
    assert not (directory / "arm.json").exists()


def test_short_group_and_wrong_result_order_fail_closed(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST, LIST]])

    async def short(*_args, **_kwargs):
        yield {"type": "context"}
        yield {"type": "tool_start", "id": "a", "name": "list_cells",
               "arguments": {"start": 0, "limit": 20}}
        yield {"type": "tool_result", "id": "a", "name": "list_cells", "text": "{}"}
        yield {"type": "done", "tool_steps": 1}

    observer = VisualObserver(directory, short)
    try:
        with pytest.raises(ValueError, match="exact tool count"):
            asyncio.run(_collect(observer))
    finally:
        observer.close()

    arm_question(directory, BINDING, [[LIST]])

    async def wrong(*_args, **_kwargs):
        yield {"type": "context"}
        yield {"type": "tool_start", "id": "a", "name": "list_cells",
               "arguments": {"start": 0, "limit": 20}}
        yield {"type": "tool_result", "id": "b", "name": "list_cells", "text": "{}"}

    observer = VisualObserver(directory, wrong)
    try:
        with pytest.raises(ValueError, match="unmatched"):
            asyncio.run(_collect(observer))
    finally:
        observer.close()


def test_final_round_blocks_extra_tool_before_effect(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST]])
    effects = []

    async def original(*_args, **_kwargs):
        yield {"type": "context"}
        yield {"type": "tool_start", "id": "a", "name": "list_cells",
               "arguments": {"start": 0, "limit": 20}}
        effects.append("read")
        yield {"type": "tool_result", "id": "a", "name": "list_cells", "text": "{}"}
        yield {"type": "context"}
        yield {"type": "tool_start", "id": "b", "name": "set_cell_source",
               "arguments": {"cell_id": "cell-1", "source": SECRET}}
        effects.append("edit")

    observer = VisualObserver(directory, original)
    try:
        with pytest.raises(ValueError, match="unexpected tool"):
            asyncio.run(_collect(observer))
    finally:
        observer.close()
    assert effects == ["read"]


def test_rejects_insecure_arm_and_directory(tmp_path):
    directory = _private(tmp_path)
    arm_question(directory, BINDING, [[LIST]])
    with pytest.raises(FileExistsError):
        arm_question(directory, BINDING, [[LIST]])
    assert stat_mode(directory / "arm.json") == 0o600
    os.chmod(directory, 0o755)
    with pytest.raises(ValueError, match="private directory"):
        VisualObserver(directory, None)

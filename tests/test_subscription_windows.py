"""Selector caller to owned worker-loop lifecycle, without credentials or network."""

from __future__ import annotations

import asyncio
import os
import threading
import time

import pytest

from nbinlineai import subscription_runtime as runtime


class _SyntheticCore(runtime.SubscriptionRuntime):
    """Exercise the real run registry/disconnect with a pending synthetic round."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.round_entered = threading.Event()
        self.round_cleaned = threading.Event()
        self.preflight_entered = threading.Event()
        self.preflight_cleaned = threading.Event()
        self.executor_thread: threading.Thread | None = None

    async def complete_round(self, _model, _messages, _tools, *, reasoning_effort, scope, run_id):
        if run_id == "preflight":
            # Real account/model discovery happens before the core registers a
            # run. A canceled facade future must not hide unfinished cleanup.
            self.preflight_entered.set()
            try:
                await asyncio.Future()
            finally:
                await asyncio.sleep(0.1)
                self.preflight_cleaned.set()
            return
        task = asyncio.current_task()
        assert task is not None
        self._run_tasks[run_id] = task
        self.round_entered.set()
        try:
            await asyncio.Future()
        finally:
            # Cancellation must get worker-loop time to finish async cleanup.
            await asyncio.sleep(0.05)
            self._run_tasks.pop(run_id, None)
            self.round_cleaned.set()

    async def status(self):
        def work():
            self.executor_thread = threading.current_thread()
            time.sleep(0.05)
            return {"state": "signed_out", "configured": False}

        return await asyncio.to_thread(work)


def _selector_run(coroutine):
    loop = asyncio.SelectorEventLoop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(asyncio.wait_for(coroutine, 8))
    finally:
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.run_until_complete(loop.shutdown_default_executor())
        asyncio.set_event_loop(None)
        loop.close()


@pytest.fixture
def worker_factory(monkeypatch):
    monkeypatch.setattr(runtime, "SubscriptionRuntime", _SyntheticCore)
    # The production Windows path uses an actual Proactor under Jupyter's
    # Selector loop. Other CI platforms emulate only the worker lifecycle.
    if os.name != "nt":
        monkeypatch.setattr(asyncio, "ProactorEventLoop", asyncio.new_event_loop, raising=False)
    return runtime._WindowsSubscriptionRuntime


def test_close_joins_active_round_finally_and_default_executor(worker_factory):
    async def scenario():
        manager = worker_factory()
        core = manager._core
        assert isinstance(asyncio.get_running_loop(), asyncio.SelectorEventLoop)
        assert (await manager.status())["state"] == "signed_out"
        task = asyncio.create_task(manager.complete_round(
            "synthetic", [], [], reasoning_effort=None, scope={}, run_id="run-one",
        ))
        assert await asyncio.to_thread(core.round_entered.wait, 2)
        await manager.close()
        assert core.round_cleaned.is_set()
        assert not manager._thread.is_alive()
        assert core.executor_thread is not None and not core.executor_thread.is_alive()
        outcome = (await asyncio.gather(task, return_exceptions=True))[0]
        assert isinstance(outcome, asyncio.CancelledError)

    _selector_run(scenario())


def test_caller_cancellation_propagates_to_worker_and_close_is_idempotent(worker_factory):
    async def scenario():
        manager = worker_factory()
        core = manager._core
        task = asyncio.create_task(manager.complete_round(
            "synthetic", [], [], reasoning_effort=None, scope={}, run_id="run-cancel",
        ))
        assert await asyncio.to_thread(core.round_entered.wait, 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert await asyncio.to_thread(core.round_cleaned.wait, 2)
        await asyncio.gather(manager.close(), manager.close())
        assert not manager._thread.is_alive()

    _selector_run(scenario())


def test_close_drains_cancelled_preflight_before_core_run_registration(worker_factory):
    async def scenario():
        manager = worker_factory()
        core = manager._core
        task = asyncio.create_task(manager.complete_round(
            "synthetic", [], [], reasoning_effort=None, scope={}, run_id="preflight",
        ))
        assert await asyncio.to_thread(core.preflight_entered.wait, 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await manager.close()
        assert core.preflight_cleaned.is_set()
        assert not manager._thread.is_alive()

    _selector_run(scenario())


def test_concurrent_dispatch_and_shutdown_never_wait_on_stopped_loop(worker_factory):
    async def scenario():
        manager = worker_factory()
        started = [asyncio.create_task(manager.status()) for _ in range(12)]
        closing = asyncio.create_task(manager.close())
        late = [asyncio.create_task(manager.status()) for _ in range(12)]
        results = await asyncio.wait_for(asyncio.gather(*started, closing, *late,
                                                       return_exceptions=True), 5)
        assert all(isinstance(result, dict) or result is None
                   or isinstance(result, runtime.SubscriptionRuntimeError)
                   for result in results)
        assert not manager._thread.is_alive()

    _selector_run(scenario())

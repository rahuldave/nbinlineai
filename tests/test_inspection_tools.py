"""Bounded inspection and execution effects for the optional survey tools."""

import asyncio
import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from jupyter_client import AsyncKernelManager

from nbinlineai.inspection_tools import (
    INSPECTION_TOOL_FUNCTIONS,
    api_names,
    inspect_value,
    list_skills,
    read_skill,
    search_docs,
    search_value,
    source_files,
    trace_function,
)
from nbinlineai.kernel import KernelDispatcher
from nbinlineai.tool_schema import fastllm_tool


@pytest.fixture
def live_names(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Give direct calls a small stand-in for the bound IPython namespace."""
    namespace: dict = {}
    monkeypatch.setattr("IPython.get_ipython", lambda: SimpleNamespace(user_ns=namespace))
    return namespace


def test_all_tools_have_flat_provider_schemas() -> None:
    """The eight wrappers are callable through the existing named-argument bridge."""
    from inspect import Parameter, signature

    assert set(INSPECTION_TOOL_FUNCTIONS) == {
        "api_names", "search_docs", "inspect_value", "search_value", "source_files",
        "list_skills", "read_skill", "trace_function",
    }
    for name, function in INSPECTION_TOOL_FUNCTIONS.items():
        parameters = {}
        for item in signature(function).parameters.values():
            assert item.kind in (Parameter.POSITIONAL_OR_KEYWORD, Parameter.KEYWORD_ONLY)
            parameters[item.name] = {
                "type": item.annotation.__name__ if isinstance(item.annotation, type) else "str",
                "description": item.name,
                **({"default": repr(item.default)} if item.default is not Parameter.empty else {}),
            }
        schema = fastllm_tool(name, {"docstring": function.__doc__, "parameters": parameters})
        assert schema["name"] == name and schema["parameters"]["type"] == "object"


def test_static_api_search_does_not_invoke_properties(live_names: dict) -> None:
    class Sample:
        """A public class for the lesson."""

        @property
        def hazardous(self) -> str:
            raise AssertionError("Property body must never run")

        def grade(self) -> int:
            """Compute a student grade."""
            return 1

    live_names["Sample"] = Sample
    live_names["sample_instance"] = Sample()
    live_names["sample_list"] = []
    assert "grade" in api_names("Sample")
    assert "hazardous" in api_names("Sample")
    assert "hazardous" in api_names("sample_instance")
    assert "append" in api_names("sample_list")
    assert "Sample.grade" in search_docs("Sample", "student", depth=1)
    assert "hazardous" in search_docs("Sample", "hazardous", depth=1)
    assert "dumps" in api_names("", module="json", query="dump")
    assert "json" in source_files("", module="json", limit=2)


def test_value_slices_and_search_are_bounded(live_names: dict) -> None:
    live_names.update(items=["alpha", "beta", "gamma"], notes="alpha then beta then alpha", object_only=object(), mapping={
        "first": "alpha", "second": "beta"
    })
    assert "list, length 3" in inspect_value("items", start=1, limit=1)
    assert "beta" in inspect_value("items", start=1, limit=1)
    assert "second" in inspect_value("mapping", start=1, limit=1)
    assert "length 26" in inspect_value("notes", start=0, limit=5)
    assert "beta" in search_value("items", "beta")
    assert search_value("notes", "alpha").count("alpha") >= 2
    live_names["unicode_notes"] = "Straße and STRASSE"
    assert "0:" in search_value("unicode_notes", "Straße")
    assert "11:" in search_value("unicode_notes", "STRASSE")
    with pytest.raises(ValueError, match="Supported values"):
        inspect_value("object_only")
    with pytest.raises(ValueError, match="start"):
        inspect_value("items", start=10_001)


def test_pyskill_metadata_and_instructions_are_read_without_import(monkeypatch: pytest.MonkeyPatch) -> None:
    original_import = importlib.import_module

    def no_skill_import(name: str, *args: object, **kwargs: object) -> object:
        if name.startswith("pyskills"):
            raise AssertionError("Skill discovery must not import its module")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(importlib, "import_module", no_skill_import)
    listing = list_skills(query="pyskills.skill", limit=5)
    assert "pyskills.skill" in listing
    instructions = read_skill("pyskills.skill")
    assert "Pyskill pyskills.skill" in instructions
    assert "skill" in instructions.casefold()
    with pytest.raises(ValueError, match="No installed pyskill"):
        read_skill("definitely_unregistered_skill")


def test_editable_skill_source_is_bounded_and_never_imported(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    package = tmp_path / "editable_skill"
    package.mkdir()
    (package / "__init__.py").write_text("")
    source = package / "lesson.py"
    source.write_text('"""Lesson instructions without import.\n\nRead this source."""\n'
                      'raise AssertionError("module was imported")\n')
    monkeypatch.syspath_prepend(str(tmp_path))

    class Distribution:
        def __init__(self) -> None:
            self.files: list = []

    entry = SimpleNamespace(name="editable", value="editable_skill.lesson", dist=Distribution())
    monkeypatch.setattr("nbinlineai.inspection_tools.entry_points", lambda **kwargs: [entry])
    assert "Lesson instructions without import" in list_skills()
    assert "Read this source" in read_skill("editable")
    assert "editable_skill.lesson" not in sys.modules
    source.write_text('"""' + "x" * 1_000_100 + '"""')
    with pytest.raises(ValueError, match="1 MB"):
        read_skill("editable")


def test_trace_runs_once_and_restores_previous_trace(live_names: dict) -> None:
    state = {"calls": 0}

    def increment(amount: int = 1) -> int:
        state["calls"] += amount
        return state["calls"]

    live_names["increment"] = increment
    prior = sys.gettrace()
    result = trace_function("increment", kwargs_json=json.dumps({"amount": 3}), max_events=10)
    assert state["calls"] == 3
    assert "Executed increment once" in result
    assert "return 3" in result
    assert "line increment:" in result
    assert sys.gettrace() is prior

    def sentinel(frame: object, event: str, arg: object) -> object:
        return sentinel

    sys.settrace(sentinel)
    try:
        assert "return 4" in trace_function("increment")
        assert sys.gettrace() is sentinel
    finally:
        sys.settrace(prior)

    async def async_work() -> int:
        return 1

    def generator_work():
        yield 1

    live_names["async_work"] = async_work
    live_names["generator_work"] = generator_work
    with pytest.raises(ValueError, match="synchronous"):
        trace_function("async_work")
    with pytest.raises(ValueError, match="synchronous"):
        trace_function("generator_work")

    def fail() -> None:
        state["calls"] += 1
        raise RuntimeError("planned failure")

    live_names["fail"] = fail
    failed = trace_function("fail")
    assert state["calls"] == 5
    assert "raised RuntimeError: planned failure" in failed
    assert sys.gettrace() is prior
    with pytest.raises(ValueError, match="args_json must be an array"):
        trace_function("increment", args_json="{}")


def test_trace_schema_and_effect_through_real_kernel(tmp_path) -> None:
    """The existing dispatcher inspects and calls an imported wrapper in one kernel."""
    class Sessions:
        async def get_session(self, *, session_id: str) -> dict:
            assert session_id == "inspection-session"
            return {"type": "notebook", "kernel": {"id": "inspection-kernel", "name": "python3"}}

    class Kernels:
        def __init__(self, kernel: AsyncKernelManager) -> None:
            self.kernel = kernel

        def __contains__(self, kernel_id: str) -> bool:
            return kernel_id == "inspection-kernel"

        def get_kernel(self, kernel_id: str) -> AsyncKernelManager:
            assert kernel_id == "inspection-kernel"
            return self.kernel

    async def setup(kernel: AsyncKernelManager) -> None:
        client = kernel.client()
        client.start_channels()
        try:
            await client.wait_for_ready(timeout=15)
            message_id = client.execute(
                "from nbinlineai.inspection_tools import trace_function, inspect_value\n"
                "counter = [0]\n"
                "def bump(amount: int = 1) -> int:\n"
                "    counter[0] += amount\n"
                "    return counter[0]"
            )
            while True:
                message = await client.get_iopub_msg(timeout=15)
                if message.get("parent_header", {}).get("msg_id") != message_id:
                    continue
                if message.get("msg_type") == "error":
                    raise AssertionError(message["content"].get("evalue"))
                if message.get("msg_type") == "status" and message["content"].get("execution_state") == "idle":
                    return
        finally:
            client.stop_channels()

    async def run() -> None:
        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel(cwd=str(tmp_path))
        try:
            await setup(kernel)
            dispatcher = KernelDispatcher(Sessions(), Kernels(kernel))
            kernel_id, bound_kernel = await dispatcher.resolve("inspection-session")
            info = await dispatcher.inspect(kernel_id, bound_kernel, [], ["trace_function", "inspect_value"])
            assert fastllm_tool("trace_function", info["trace_function"])["parameters"]["required"] == ["name"]
            assert fastllm_tool("inspect_value", info["inspect_value"])["parameters"]["required"] == ["name"]
            result = await dispatcher.call("inspection-session", kernel_id, bound_kernel,
                                           {"trace_function"}, "trace_function",
                                           {"name": "bump", "kwargs_json": '{"amount": 2}'})
            assert "Executed bump once" in result and "return 2" in result
            values = await dispatcher.call("inspection-session", kernel_id, bound_kernel,
                                           {"inspect_value"}, "inspect_value", {"name": "counter"})
            assert "0: 2" in values
        finally:
            await kernel.shutdown_kernel(now=True)

    asyncio.run(run())

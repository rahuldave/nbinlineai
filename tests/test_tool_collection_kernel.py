"""Registry, schemas, and representative effects in one isolated real kernel."""

import asyncio
from pathlib import Path

from jupyter_client import AsyncKernelManager

from nbinlineai.kernel import KernelDispatcher
from nbinlineai.tool_schema import fastllm_tool
from nbinlineai.tools import SPECIAL_TOOL_FUNCTIONS, TOOL_FUNCTIONS


class _Sessions:
    async def get_session(self, *, session_id: str) -> dict:
        assert session_id == "collection-session"
        return {"type": "notebook", "kernel": {"id": "collection-kernel", "name": "python3"}}


class _Kernels:
    def __init__(self, kernel: AsyncKernelManager) -> None:
        self.kernel = kernel

    def __contains__(self, kernel_id: str) -> bool:
        return kernel_id == "collection-kernel"

    def get_kernel(self, kernel_id: str) -> AsyncKernelManager:
        assert kernel_id == "collection-kernel"
        return self.kernel


async def _setup(kernel: AsyncKernelManager, source: str) -> None:
    client = kernel.client()
    client.start_channels()
    try:
        await client.wait_for_ready(timeout=15)
        message_id = client.execute(source)
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


def test_every_advertised_tool_inspects_and_representative_calls_work(tmp_path: Path) -> None:
    """One kernel sees the whole registry and applies bounded saved-file effects."""
    names = list(TOOL_FUNCTIONS)
    assert len(names) == 55
    assert len(SPECIAL_TOOL_FUNCTIONS) == 15
    assert set(SPECIAL_TOOL_FUNCTIONS) <= set(names)

    async def run() -> None:
        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel(cwd=str(tmp_path))
        try:
            await _setup(kernel, "from nbinlineai.tools import " + ", ".join(names))
            dispatcher = KernelDispatcher(_Sessions(), _Kernels(kernel))
            kernel_id, bound_kernel = await dispatcher.resolve("collection-session")
            inspected = {}
            for start in range(0, len(names), 20):
                chunk = names[start:start + 20]
                inspected.update(await dispatcher.inspect(kernel_id, bound_kernel, [], chunk))
            assert set(inspected) == set(names)
            for name in names:
                info = inspected[name]
                assert "error" not in info, (name, info)
                schema = fastllm_tool(name, info)
                assert schema["type"] == "function" and schema["name"] == name
                assert schema["parameters"]["type"] == "object"
                assert info.get("frontend_special") == (
                    name if name in SPECIAL_TOOL_FUNCTIONS else None
                )
            batch = fastllm_tool("file_strs_replace", inspected["file_strs_replace"])["parameters"]
            assert batch["properties"]["old_strings"]["type"] == "array"
            assert batch["properties"]["old_strings"]["items"] == {"type": "string"}
            assert batch["properties"]["new_strings"]["items"] == {"type": "string"}

            async def call(name: str, **arguments: object) -> str:
                return await dispatcher.call(
                    "collection-session", kernel_id, bound_kernel, set(names), name, arguments
                )

            path = "lesson.py"
            await call("create_file", path=path, contents=(
                '"""A small lesson."""\n'
                'def score(value: int) -> int:\n'
                '    """Return the original score."""\n'
                '    return value + 1\n'
            ))
            assert (tmp_path / path).exists()
            viewed = await call("view_file", path=path)
            assert "return value + 1" in viewed
            await call("file_strs_replace", path=path,
                       old_strings=["original", "value + 1"],
                       new_strings=["revised", "value + 2"])
            assert "revised score" in (tmp_path / path).read_text()
            assert "value + 2" in (tmp_path / path).read_text()
            assert "score" in await call("source_doc", path=path)
            assert "score" in await call("python_symbols", path=path)
            assert "value + 2" in await call("search_files", query="value + 2", path=path)

            process = await call("run_python", code=(
                'from pathlib import Path\n'
                'Path("subprocess-marker.txt").write_text("ran once")\n'
                'print("SUBPROCESS_OK")'
            ), cwd=".", timeout=5)
            assert "SUBPROCESS_OK" in process
            assert (tmp_path / "subprocess-marker.txt").read_text() == "ran once"

            await _setup(kernel, (
                "browser_read_alias = read_cell\n"
                "def read_cell(cell_id: str) -> str:\n"
                "    return cell_id"
            ))
            aliases = await dispatcher.inspect(kernel_id, bound_kernel, [],
                                               ["browser_read_alias", "read_cell"])
            assert aliases["browser_read_alias"]["frontend_special"] == "read_cell"
            assert "frontend_special" not in aliases["read_cell"]
        finally:
            await kernel.shutdown_kernel(now=True)

    asyncio.run(run())

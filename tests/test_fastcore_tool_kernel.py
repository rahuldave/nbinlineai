"""Fastcore-inspired helpers through the actual notebook kernel bridge."""

import ast
import asyncio
from pathlib import Path

from jupyter_client import AsyncKernelManager

from nbinlineai.kernel import KernelDispatcher
from nbinlineai.tool_schema import fastllm_tool


class _Sessions:
    async def get_session(self, *, session_id: str) -> dict:
        assert session_id == "fastcore-session"
        return {"type": "notebook", "kernel": {"id": "fastcore-kernel", "name": "python3"}}


class _Kernels:
    def __init__(self, kernel: AsyncKernelManager) -> None:
        self.kernel = kernel

    def __contains__(self, kernel_id: str) -> bool:
        return kernel_id == "fastcore-kernel"

    def get_kernel(self, kernel_id: str) -> AsyncKernelManager:
        assert kernel_id == "fastcore-kernel"
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


def test_fastcore_tools_schema_and_file_effects_in_bound_kernel(tmp_path: Path) -> None:
    """A real kernel exposes flat schemas and applies edits in its own cwd."""
    names = (
        "path_info", "list_files", "view_file", "create_file", "file_str_replace",
        "file_insert_line", "file_replace_lines", "show_doc",
    )

    async def run() -> None:
        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel(cwd=str(tmp_path))
        try:
            await _setup(kernel, (
                "from nbinlineai.tools import " + ", ".join(names) + "\n"
                "def lesson_rate(\n"
                "    score: int,  # The student's current score.\n"
                "    bonus: int = 2,  # Extra points for the lesson.\n"
                ") -> int:\n"
                "    \"\"\"Add a lesson bonus.\"\"\"\n"
                "    return score + bonus\n"
            ))
            dispatcher = KernelDispatcher(_Sessions(), _Kernels(kernel))
            kernel_id, bound_kernel = await dispatcher.resolve("fastcore-session")
            info = await dispatcher.inspect(kernel_id, bound_kernel, [], list(names))
            assert list(info) == list(names)
            for name in names:
                assert "error" not in info[name], (name, info[name])
                schema = fastllm_tool(name, info[name])
                assert schema["type"] == "function" and schema["name"] == name
                assert schema["parameters"]["type"] == "object"
                assert schema["strict"] is False
            assert set(fastllm_tool("file_str_replace", info["file_str_replace"])["parameters"]["required"]) == {
                "path", "old_str", "new_str"
            }
            assert fastllm_tool("show_doc", info["show_doc"])["parameters"]["required"] == ["name"]

            async def call(tool_name: str, **arguments: object) -> str:
                text = await dispatcher.call(
                    "fastcore-session", kernel_id, bound_kernel, set(names), tool_name, arguments
                )
                try:
                    value = ast.literal_eval(text)
                except (SyntaxError, ValueError):
                    return text
                return value if isinstance(value, str) else text

            live_doc = await call("show_doc", name="lesson_rate")
            assert "lesson_rate" in live_doc
            assert "student's current score" in live_doc
            assert "Extra points for the lesson" in live_doc
            stdlib_doc = await call("show_doc", name="dumps", module="json")
            assert "dumps" in stdlib_doc

            assert "sample.txt" in await call("create_file", path="sample.txt", contents="alpha\nbeta\n")
            assert (tmp_path / "sample.txt").read_text() == "alpha\nbeta\n"
            assert "sample.txt" in await call("path_info", path="sample.txt")
            assert "sample.txt" in await call("list_files", path=".", pattern="*.txt")
            assert "alpha" in await call("view_file", path="sample.txt", start_line=1, end_line=2)

            await call("file_str_replace", path="sample.txt", old_str="beta", new_str="gamma")
            await call("file_insert_line", path="sample.txt", line=2, new_str="middle")
            await call("file_replace_lines", path="sample.txt", start_line=1, end_line=1, new_content="start")
            assert (tmp_path / "sample.txt").read_text() == "start\ngamma\nmiddle\n"
            assert "gamma" in await call("view_file", path="sample.txt", start_line=1, end_line=3)
        finally:
            await kernel.shutdown_kernel(now=True)

    asyncio.run(run())

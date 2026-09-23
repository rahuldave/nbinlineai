"""Keep shipped student notebooks valid and runnable without a provider key."""

import asyncio
import json
from pathlib import Path

import nbformat
import pytest
from jupyter_client import AsyncKernelManager

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = [
    "quickstart.ipynb",
    "live-variables-and-tools.ipynb",
    "socratic-learning-dialog.ipynb",
    "bundled-tools.ipynb",
    "live-notebook-tools.ipynb",
    "python-and-web-tools.ipynb",
    "data/ecosystem-lesson.ipynb",
]


async def _run_code(
    kernel: AsyncKernelManager,  # isolated Python kernel for one example
    source: str,  # one ordinary code cell's source
) -> str:
    """Execute one ordinary cell and return its visible text output."""
    client = kernel.client()
    client.start_channels()
    try:
        await client.wait_for_ready(timeout=15)
        message_id = client.execute(source)
        output: list[str] = []
        while True:
            message = await client.get_iopub_msg(timeout=15)
            if message.get("parent_header", {}).get("msg_id") != message_id:
                continue
            kind = message.get("msg_type")
            content = message.get("content", {})
            if kind == "error":
                raise AssertionError(f"Example code failed: {content.get('evalue')}")
            if kind == "stream":
                output.append(content.get("text", ""))
            if kind in ("execute_result", "display_data"):
                output.append(content.get("data", {}).get("text/plain", ""))
            if kind == "status" and content.get("execution_state") == "idle":
                return "".join(output)
    finally:
        client.stop_channels()


@pytest.mark.parametrize("relative_path", EXAMPLES)
def test_shipped_example_code_cells_run_headlessly(relative_path: str) -> None:  # relative_path: example notebook
    """Run every ordinary code cell, leaving instructional AI Markdown untouched."""
    notebook_path = ROOT / "examples" / relative_path
    notebook = json.loads(notebook_path.read_text())
    nbformat.validate(notebook)
    code_cells = [cell for cell in notebook["cells"] if cell["cell_type"] == "code"]
    assert code_cells, f"No code cells in {relative_path}"
    assert all(not cell.get("outputs") for cell in code_cells)

    async def run() -> list[str]:
        """Use an isolated Python namespace for one example's setup cells."""
        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel(cwd=str(ROOT))
        try:
            return [await _run_code(kernel, "".join(cell["source"])) for cell in code_cells]
        finally:
            await kernel.shutdown_kernel(now=True)

    outputs = asyncio.run(run())
    if relative_path == "bundled-tools.ipynb":
        assert "&`find_notebook_cells`" in "\n".join(outputs)
        assert "&`read_notebook_cell`" in "\n".join(outputs)
        assert "&`search_kernel_names`" in "\n".join(outputs)
    if relative_path == "live-variables-and-tools.ipynb":
        assert "&`record_bonus`" in "\n".join(outputs)
        assert "Tool calls observed: 0" in "\n".join(outputs)
    if relative_path == "live-notebook-tools.ipynb":
        assert "&`list_cells`" in "\n".join(outputs)
        assert "&`insert_markdown`" in "\n".join(outputs)
    if relative_path == "python-and-web-tools.ipynb":
        assert "&`inspect_python`" in "\n".join(outputs)
        assert "&`average_alias`" in "\n".join(outputs)

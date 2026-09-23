"""Keep shipped student notebooks valid and runnable without a provider key."""

import ast
import asyncio
import json
import re
from pathlib import Path

import nbformat
import pytest
from jupyter_client import AsyncKernelManager

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = [
    "context-selection.ipynb",
    "quickstart.ipynb",
    "live-variables-and-tools.ipynb",
    "socratic-learning-dialog.ipynb",
    "bundled-tools.ipynb",
    "live-notebook-tools.ipynb",
    "python-and-web-tools.ipynb",
    "data/ecosystem-lesson.ipynb",
]
TOOL_REFERENCE = re.compile(r"&`([A-Za-z_][A-Za-z0-9_]*)`")


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
    """Run setup code; skip only the documented JupyterLab-only helper example."""
    notebook_path = ROOT / "examples" / relative_path
    notebook = json.loads(notebook_path.read_text())
    nbformat.validate(notebook)
    code_cells = [cell for cell in notebook["cells"] if cell["cell_type"] == "code"]
    assert code_cells, f"No code cells in {relative_path}"
    assert all(not cell.get("outputs") for cell in code_cells)

    async def run() -> tuple[list[str], list[str]]:
        """Execute setup in notebook order and inspect every AI question's offered names."""
        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel(cwd=str(ROOT))
        try:
            outputs: list[str] = []
            unresolved: list[str] = []
            declared: set[str] = set()
            for cell in notebook["cells"]:
                source = "".join(cell["source"])
                if cell["cell_type"] == "code":
                    ui_only = "nbinlineai-ui-only" in cell.get("metadata", {}).get("tags", [])
                    if ui_only:
                        assert (relative_path, cell["id"]) == (
                            "live-variables-and-tools.ipynb", "live-insert-tools-optional"
                        )
                    else:
                        outputs.append(await _run_code(kernel, source))
                    continue
                if cell["cell_type"] != "markdown":
                    continue
                ai = cell.get("metadata", {}).get("nbinlineai", {})
                if ai.get("promptCellId") or ai.get("isOutputCell"):
                    continue
                current = set(TOOL_REFERENCE.findall(source))
                if not ai.get("isPromptCell"):
                    declared.update(current)
                    continue
                names = sorted(declared | current)
                if names:
                    probe = (
                        "import builtins\n"
                        f"print([name for name in {names!r} "
                        "if name not in get_ipython().user_ns and not hasattr(builtins, name)])"
                    )
                    missing = ast.literal_eval((await _run_code(kernel, probe)).strip())
                    unresolved.extend(f"{cell['id']}: {name}" for name in missing)
                declared.update(current)
            return outputs, unresolved
        finally:
            await kernel.shutdown_kernel(now=True)

    outputs, unresolved = asyncio.run(run())
    assert not unresolved, f"Unbound inherited tool references in {relative_path}: {unresolved}"
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


def test_examples_teach_inherited_tool_declarations() -> None:
    """Keep both ordinary-Markdown and earlier-question examples executable in order."""
    live = json.loads((ROOT / "examples/live-variables-and-tools.ipynb").read_text())
    cells = live["cells"]
    declaration = next(index for index, cell in enumerate(cells)
                       if cell["id"] == "live-tool-declaration")
    questions = [index for index, cell in enumerate(cells)
                 if cell.get("metadata", {}).get("nbinlineai", {}).get("isPromptCell")]
    assert questions and declaration < min(questions)
    assert "&`record_bonus`" in "".join(cells[declaration]["source"])
    assert "&`average_score`" in "".join(cells[declaration]["source"])
    assert all("&`" not in "".join(cells[index]["source"]) for index in questions)

    quickstart = json.loads((ROOT / "examples/quickstart.ipynb").read_text())
    prompts = ["".join(cell["source"]) for cell in quickstart["cells"]
               if cell.get("metadata", {}).get("nbinlineai", {}).get("isPromptCell")]
    assert len(prompts) == 2
    assert "&`add_bonus`" in prompts[0]
    assert "&`" not in prompts[1]

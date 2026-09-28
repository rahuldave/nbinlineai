"""Keep student notebooks valid and runnable without a provider key."""

import ast
import asyncio
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory

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
    "fastcore-tools.ipynb",
    "project-tools.ipynb",
    "tool-catalog-inspection.ipynb",
    "tool-catalog-files.ipynb",
    "tool-catalog-saved-notebooks.ipynb",
    "tool-catalog-live-notebook.ipynb",
    "tool-catalog-web.ipynb",
    "tool-catalog-processes.ipynb",
    "browser-media-foundation.ipynb",
    "browser-media-playback.ipynb",
    "browser-media-transforms.ipynb",
    "jupyter-ai-and-nbinlineai.ipynb",
    "codex-acp-worked-example.ipynb",
    "data/ecosystem-lesson.ipynb",
]
TOOL_REFERENCE = re.compile(r"&`([A-Za-z_][A-Za-z0-9_]*)`")
HEADLESS_UI_CELLS = {
    ("live-variables-and-tools.ipynb", "live-insert-tools-optional"):
        "insert_tools(",
    ("browser-media-foundation.ipynb", "media-capabilities-call"): "browser_capabilities(",
    ("browser-media-foundation.ipynb", "media-capabilities-inspect"): "capabilities.status",
    ("browser-media-foundation.ipynb", "media-save-call"): "save_media(",
    ("browser-media-foundation.ipynb", "media-save-inspect"): "saved.status",
    ("browser-media-foundation.ipynb", "media-status-call"): "operation_status(",
    ("browser-media-foundation.ipynb", "media-status-inspect"): "lookup.status",
    ("browser-media-foundation.ipynb", "media-cancel-call"): "cancel_operation(",
    ("browser-media-foundation.ipynb", "media-cancel-inspect"): "cancelled.status",
    ("browser-media-foundation.ipynb", "media-release-call"): "release_media(",
    ("browser-media-foundation.ipynb", "media-release-inspect"): "released.status",
    ("browser-media-foundation.ipynb", "media-cleanup"): "saved.media",
    ("browser-media-playback.ipynb", "playback-choose-call"): "choose_file(",
    ("browser-media-playback.ipynb", "playback-choose-inspect"): "selected.status",
    ("browser-media-playback.ipynb", "playback-open-call"): "open_media(",
    ("browser-media-playback.ipynb", "playback-open-inspect"): "opened.status",
    ("browser-media-playback.ipynb", "playback-play-call"): "play_media(",
    ("browser-media-playback.ipynb", "playback-play-inspect"): "playing.status",
    ("browser-media-playback.ipynb", "playback-pause-call"): "pause_media(",
    ("browser-media-playback.ipynb", "playback-pause-inspect"): "paused.status",
    ("browser-media-playback.ipynb", "playback-seek-call"): "seek_media(",
    ("browser-media-playback.ipynb", "playback-seek-inspect"): "seeked.status",
    ("browser-media-playback.ipynb", "playback-volume-call"): "set_media_volume(",
    ("browser-media-playback.ipynb", "playback-volume-inspect"): "volume.status",
    ("browser-media-playback.ipynb", "playback-close-call"): "close_media(",
    ("browser-media-playback.ipynb", "playback-close-inspect"): "closed.status",
    ("browser-media-playback.ipynb", "playback-copy-call"): "copy_text(",
    ("browser-media-playback.ipynb", "playback-copy-inspect"): "copied.status",
    ("browser-media-playback.ipynb", "playback-paste-call"): "paste_content(",
    ("browser-media-playback.ipynb", "playback-paste-inspect"): "pasted.status",
    ("browser-media-transforms.ipynb", "transform-frames-call"): "extract_frames(",
    ("browser-media-transforms.ipynb", "transform-frames-inspect"): "frames.status",
    ("browser-media-transforms.ipynb", "transform-crop-call"): "crop_image(",
    ("browser-media-transforms.ipynb", "transform-crop-inspect"): "crop.status",
    ("browser-media-transforms.ipynb", "transform-annotate-call"): "annotate_image(",
    ("browser-media-transforms.ipynb", "transform-annotate-inspect"): "annotated.status",
}


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
    """Run setup code; skip only exact JupyterLab receipt or helper cells."""
    notebook_path = ROOT / "examples" / relative_path
    notebook = json.loads(notebook_path.read_text())
    nbformat.validate(notebook)
    code_cells = [cell for cell in notebook["cells"] if cell["cell_type"] == "code"]
    assert code_cells, f"No code cells in {relative_path}"
    assert all(not cell.get("outputs") for cell in code_cells)

    async def run(kernel_cwd: Path) -> tuple[list[str], list[str]]:
        """Execute setup in notebook order and inspect every AI question's offered names."""
        kernel = AsyncKernelManager(kernel_name="python3")
        await kernel.start_kernel(cwd=str(kernel_cwd))
        try:
            outputs: list[str] = []
            unresolved: list[str] = []
            declared: set[str] = set()
            for cell in notebook["cells"]:
                source = "".join(cell["source"])
                if cell["cell_type"] == "code":
                    tags = set(cell.get("metadata", {}).get("tags", []))
                    if "nbinlineai-ui-only" in tags:
                        assert (relative_path, cell["id"]) in HEADLESS_UI_CELLS
                    if (relative_path, cell["id"]) in HEADLESS_UI_CELLS:
                        assert "nbinlineai-ui-only" in tags
                        assert HEADLESS_UI_CELLS[(relative_path, cell["id"])] in source
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

    with TemporaryDirectory(prefix="nbinlineai-example-") as scratch:
        kernel_cwd = Path(scratch) if relative_path in {
            "browser-media-foundation.ipynb", "browser-media-playback.ipynb",
            "browser-media-transforms.ipynb"} else ROOT
        outputs, unresolved = asyncio.run(run(kernel_cwd))
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
    if relative_path == "fastcore-tools.ipynb":
        text = "\n".join(outputs)
        assert "Number of observed visits" in text
        assert "Visits in the first observation" in text
        assert "Serialize" in text
        assert "Status: planned" in text
    if relative_path == "project-tools.ipynb":
        text = "\n".join(outputs)
        assert "Disposable project ready" in text
        assert "stable-note" in text
        assert "visits" in text
        assert "Study notes" in text
    if relative_path == "tool-catalog-inspection.ipynb":
        text = "\n".join(outputs)
        assert "catalog_double" in text
        assert "Path.read_text" in text
    if relative_path == "tool-catalog-files.ipynb":
        text = "\n".join(outputs)
        assert "Disposable folder:" in text
        assert "Counts" in text
        assert "sha256:" in text
    if relative_path == "tool-catalog-saved-notebooks.ipynb":
        assert "catalog-note" in "\n".join(outputs)
    if relative_path == "tool-catalog-live-notebook.ipynb":
        assert "Live notebook tools imported" in "\n".join(outputs)
    if relative_path == "tool-catalog-web.ipynb":
        assert "Public page tools imported" in "\n".join(outputs)
    if relative_path == "tool-catalog-processes.ipynb":
        text = "\n".join(outputs)
        assert "catalog-ready" in text
        assert "5" in text
    if relative_path == "browser-media-foundation.ipynb":
        text = "\n".join(outputs)
        assert "sha256" in text
        assert "browser-media-source-" in text
    if relative_path == "browser-media-transforms.ipynb":
        text = "\n".join(outputs)
        assert "Disposable transform files removed" in text
        assert "Disposable exact PNG and 16×16 two-color VP9 clip" in text
    if relative_path == "jupyter-ai-and-nbinlineai.ipynb":
        assert "meadow: 5.50 visits per ten flowers" in "\n".join(outputs)
        assert "courtyard: 2.29 visits per ten flowers" in "\n".join(outputs)
    if relative_path == "codex-acp-worked-example.ipynb":
        diagnostics = "\n".join(outputs)
        assert "Needs work:" in diagnostics
        assert "North count: expected 3, got 2" in diagnostics
        assert "South count: expected 3, got 2" in diagnostics
        assert "regions: expected ['East', 'North', 'South'], got ['North', 'South']" in diagnostics
        assert "All checks pass" not in diagnostics


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

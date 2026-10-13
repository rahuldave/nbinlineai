"""Static notebook rendering retains saved evidence and never runs source code."""

import base64
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath

from scripts.build_docs_site import build
from scripts.smalldocs_notebook import close_open_fence, decorate


def test_adapter_preserves_source_outputs_and_marks_every_cell() -> None:
    notebook = {
        "nbformat": 4, "nbformat_minor": 5, "metadata": {},
        "cells": [
            {"cell_type": "markdown", "id": "intro", "metadata": {},
             "source": "# Worked example\n\nA saved result.\n"},
            {"cell_type": "code", "id": "code-call", "metadata": {},
             "source": "raise RuntimeError('must not run')",
             "execution_count": 1,
             "outputs": [{"output_type": "stream", "name": "stdout",
                          "text": "```python\nprint('<saved>')\n```\n"}]},
            {"cell_type": "markdown", "id": "ask-ai",
             "metadata": {"nbinlineai": {"isPromptCell": True}},
             "source": "What happened?"},
            {"cell_type": "markdown", "id": "answer-ai",
             "metadata": {"nbinlineai": {"isOutputCell": True}},
             "source": "Read the saved output."},
        ],
    }
    original = copy.deepcopy(notebook)
    result = decorate(notebook, PurePosixPath("data/lesson.ipynb"))
    assert notebook == original
    assert 'title: "Worked example"' in result["cells"][0]["source"]
    assert "#intro" in result["cells"][1]["source"]
    assert result["cells"][2]["source"].startswith("#| label: code-call\n")
    assert result["cells"][2]["outputs"] == original["cells"][1]["outputs"]
    assert ".nbinlineai-ai-prompt" in result["cells"][3]["source"]
    assert ".nbinlineai-ai-response" in result["cells"][4]["source"]
    assert "../../examples.html" in result["cells"][-1]["source"]
    assert "examples/data/lesson.ipynb" in result["cells"][-1]["source"]


def test_truncated_saved_markdown_fence_closes_at_cell_boundary() -> None:
    source = "Saved excerpt:\n\n```python\nprint('from the source')\n"
    assert close_open_fence(source).endswith("```\n")
    assert close_open_fence(source + "```\n") == source + "```\n"


def test_build_displays_saved_output_and_cannot_execute_notebook(tmp_path: Path) -> None:
    docs = tmp_path / "docs"
    examples = tmp_path / "examples"
    docs.mkdir()
    examples.mkdir()
    (docs / "_smalldocs.yml").write_text(
        "project:\n  type: website\n  output-dir: _site\n"
        "  render: ['*.md', 'notebooks/*.ipynb']\n"
        "website:\n  title: Test\n", encoding="utf-8"
    )
    (docs / "index.md").write_text("# Index\n", encoding="utf-8")
    (docs / "examples.md").write_text("# Examples\n", encoding="utf-8")
    marker = tmp_path / "executed.txt"
    png = base64.b64encode(b"not-a-real-png-but-saved-bytes").decode()
    notebook = {
        "nbformat": 4, "nbformat_minor": 5, "metadata": {},
        "cells": [
            {"cell_type": "markdown", "id": "intro", "metadata": {},
             "source": "# Evidence\n\nThis page uses saved outputs.\n"},
            {"cell_type": "code", "id": "saved-code", "metadata": {},
             "source": f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')",
             "execution_count": 1,
             "outputs": [
                 {"output_type": "stream", "name": "stdout", "text": "```\n<saved & safe>\n```\n"},
                 {"output_type": "display_data", "data": {"text/html": "<table><tr><td>saved HTML</td></tr></table>"}, "metadata": {}},
                 {"output_type": "display_data", "data": {"image/svg+xml": '<svg xmlns="http://www.w3.org/2000/svg"><text>saved SVG</text></svg>'}, "metadata": {}},
                 {"output_type": "display_data", "data": {"image/png": png}, "metadata": {}},
                 {"output_type": "execute_result", "data": {"text/plain": "saved text"}, "metadata": {}, "execution_count": 1},
             ]},
            {"cell_type": "markdown", "id": "ai-prompt", "metadata": {"nbinlineai": {"isPromptCell": True}},
             "source": "Ask about the saved outputs."},
            {"cell_type": "markdown", "id": "ai-answer", "metadata": {"nbinlineai": {"isOutputCell": True}},
             "source": "Saved answer."},
            {"cell_type": "markdown", "id": "truncated-source", "metadata": {},
             "source": "```python\nprint('partial excerpt')\n"},
        ],
    }
    path = examples / "evidence.ipynb"
    path.write_text(json.dumps(notebook), encoding="utf-8")
    checkpoint = examples / ".ipynb_checkpoints"
    checkpoint.mkdir()
    (checkpoint / "private.ipynb").write_text(json.dumps(notebook), encoding="utf-8")
    original_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    assert build(tmp_path) == (1, 3)
    assert not (docs / "_site" / "notebooks" / "private.html").exists()
    html = (docs / "_site" / "notebooks" / "evidence.html").read_text(encoding="utf-8")
    assert not marker.exists()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == original_hash
    for anchor in ("intro", "saved-code", "ai-prompt", "ai-answer", "truncated-source"):
        assert f'id="{anchor}"' in html
    assert html.count('class="cell-output ') == 5
    assert "&lt;saved &amp; safe&gt;" in html
    assert "saved HTML" in html and "saved SVG" in html and "saved text" in html
    assert "data:image/png;base64," in html
    assert "nbinlineai-ai-prompt" in html and "nbinlineai-ai-response" in html
    assert "Download this notebook" in html
    assert "examples/evidence.ipynb" in html

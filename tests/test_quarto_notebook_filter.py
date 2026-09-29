"""The Quarto filter decorates notebook cells in memory only."""

import copy

from scripts.quarto_notebook_filter import decorate


def test_decorate_keeps_code_and_marks_ai_cells() -> None:
    notebook = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {},
        "cells": [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": ["# My example\n", "\n", "A short introduction."],
            },
            {
                "cell_type": "code",
                "metadata": {},
                "source": "raise RuntimeError('must not run')",
                "outputs": [],
                "execution_count": None,
            },
            {
                "cell_type": "markdown",
                "id": "demo-prompt",
                "metadata": {"nbinlineai": {"isPromptCell": True}},
                "source": "What happened?",
            },
            {
                "cell_type": "markdown",
                "metadata": {"nbinlineai": {"isOutputCell": True}},
                "source": "It did not run.",
            },
        ],
    }
    original = copy.deepcopy(notebook)
    result = decorate(copy.deepcopy(notebook), "sample.ipynb")
    assert notebook == original
    front_matter = "".join(result["cells"][0]["source"])
    assert 'title: "My example"' in front_matter
    assert 'description: "A short introduction."' in front_matter
    assert "enabled: false" in front_matter
    assert result["cells"][2] == original["cells"][1]
    assert ".nbinlineai-ai-cell .nbinlineai-ai-prompt" in "".join(result["cells"][3]["source"])
    assert "#demo-prompt" in "".join(result["cells"][3]["source"])
    assert ".nbinlineai-ai-cell .nbinlineai-ai-response" in "".join(result["cells"][4]["source"])
    assert "Download this notebook" in "".join(result["cells"][-1]["source"])


def test_stdout_fences_render_as_literal_text_without_changing_saved_output() -> None:
    notebook = {
        "nbformat": 4, "nbformat_minor": 5, "metadata": {},
        "cells": [
            {"cell_type": "markdown", "id": "intro", "metadata": {},
             "source": ["# Fenced output\n", "\n", "A worked result.\n"]},
            {"cell_type": "code", "id": "documented-call", "metadata": {},
             "source": "print(show_doc())", "execution_count": 1,
             "outputs": [
                 {"output_type": "stream", "name": "stdout",
                  "text": ["### Function\n\n", "```python\n", "def example(): pass\n",
                           "```\n", "<ordinary text>\n"]},
                 {"output_type": "stream", "name": "stdout", "text": "ordinary output\n"},
             ]},
            {"cell_type": "code", "id": "following-cell", "metadata": {},
             "source": "print('still visible')", "execution_count": 2, "outputs": []},
        ],
    }
    original = copy.deepcopy(notebook)
    rendered = decorate(copy.deepcopy(notebook), "fenced-output.ipynb")
    assert notebook == original
    assert rendered["cells"][2]["source"] == original["cells"][1]["source"]
    fenced = rendered["cells"][2]["outputs"][0]
    assert fenced["output_type"] == "display_data"
    assert "&#96;&#96;&#96;python" in fenced["data"]["text/html"]
    assert "&lt;ordinary text&gt;" in fenced["data"]["text/html"]
    assert rendered["cells"][2]["outputs"][1] == original["cells"][1]["outputs"][1]
    assert rendered["cells"][3]["id"] == "following-cell"

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

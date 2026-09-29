"""Merging retained live answers must preserve verified latest source and calls."""

import json

import pytest

from scripts.merge_worked_notebook import merge


def _write(path, cells):
    path.write_text(json.dumps({"cells": cells, "metadata": {}}), encoding="utf-8")


def test_merge_keeps_current_source_and_real_evidence(tmp_path):
    source = tmp_path / "source.ipynb"
    direct = tmp_path / "direct.ipynb"
    ai = tmp_path / "ai.ipynb"
    code = {"id": "call", "cell_type": "code", "source": ["saved = search_kernel_names('x')\n"],
            "metadata": {}, "execution_count": None, "outputs": []}
    question = {"id": "question", "cell_type": "markdown", "source": ["Use &`search_kernel_names`."],
                "metadata": {"nbinlineai": {"isPromptCell": True}}}
    _write(source, [code, question])
    _write(direct, [{**code, "execution_count": 2, "outputs": [{"output_type": "stream", "text": ["Found x\n"]}],
                    "metadata": {"nbinlineaiWorkedDirectCalls": [
                        {"name": "search_kernel_names", "cellId": "call", "completed": True}]}}, question])
    answer = {"id": "answer", "cell_type": "markdown", "source": ["I found x."],
              "metadata": {"nbinlineai": {"isOutputCell": True, "promptCellId": "question", "status": "done"}}}
    trace = {"id": "trace", "cell_type": "markdown",
             "source": ["| Tool | Submitted arguments | Observed result |\n",
                        "| --- | --- | --- |\n",
                        "| `search_kernel_names` | {\"query\":\"x\"} | Found x |\n"],
             "metadata": {"nbinlineaiWorkedTrace": True, "questionCellId": "question"}}
    _write(ai, [code, question, answer, trace])

    worked = merge(source, direct, ai)
    assert [cell["id"] for cell in worked["cells"]] == ["call", "question", "answer", "trace"]
    assert worked["cells"][0]["metadata"]["nbinlineaiWorkedDirectCalls"][0]["completed"] is True
    assert worked["cells"][3]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"] == [
        {"name": "search_kernel_names", "resultState": "completed", "frontendAction": False}]

    _write(source, [{**code, "source": ["changed_source()\n"]}, question])
    with pytest.raises(ValueError, match="latest source"):
        merge(source, direct, ai)

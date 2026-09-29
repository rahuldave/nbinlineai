"""Merging retained live answers must preserve verified latest source and calls."""

import json
from pathlib import Path

import pytest

from scripts.merge_worked_notebook import _observed_insertion, merge


def _write(path, cells):
    path.write_text(json.dumps({"cells": cells, "metadata": {}}), encoding="utf-8")


def test_merge_keeps_current_source_and_real_evidence(tmp_path):
    source = tmp_path / "quickstart.ipynb"
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


def test_merge_preserves_inserted_cell_and_structured_operation_evidence(tmp_path):
    source = tmp_path / "quickstart.ipynb"
    direct = tmp_path / "direct.ipynb"
    ai = tmp_path / "ai.ipynb"
    question = {"id": "question", "cell_type": "markdown", "source": ["Use &`insert_code`."],
                "metadata": {"nbinlineai": {"isPromptCell": True}}}
    _write(source, [question])
    _write(direct, [question])
    answer = {"id": "answer", "cell_type": "markdown", "source": ["Inserted a code cell."],
              "metadata": {"nbinlineai": {"isOutputCell": True, "promptCellId": "question", "status": "done"}}}
    trace = {"id": "trace", "cell_type": "markdown", "source": [
        "| Tool | Result state | Submitted arguments | Observed result |\n",
        "| --- | --- | --- | --- |\n",
        '| `insert_code` | completed | {"content":"print(\'suggested\')"} | Inserted cell inserted. |\n'],
             "metadata": {"nbinlineaiWorkedTrace": True, "questionCellId": "question",
                          "nbinlineaiWorkedEvidence": {"questionCellId": "question", "observedTools": [
                              {"name": "insert_code", "resultState": "completed", "frontendAction": True,
                               "operationId": "op-real-12345678901234567890"}]}}}
    inserted = {"id": "inserted", "cell_type": "code", "source": ["print('suggested')"],
                "metadata": {}, "execution_count": None, "outputs": []}
    _write(ai, [question, answer, trace, inserted])
    worked = merge(source, direct, ai)
    assert [cell["id"] for cell in worked["cells"]] == ["question", "answer", "trace", "inserted"]
    assert worked["cells"][2]["metadata"]["nbinlineaiWorkedEvidence"]["observedTools"][0][
        "operationId"] == "op-real-12345678901234567890"
    assert worked["cells"][3]["execution_count"] is None

    wrong = {**inserted, "id": "wrong-id"}
    _write(ai, [question, answer, trace, wrong])
    with pytest.raises(ValueError, match="Unexpected or executed"):
        merge(source, direct, ai)
    wrong_content = {**inserted, "source": ["print('different')"]}
    _write(ai, [question, answer, trace, wrong_content])
    with pytest.raises(ValueError, match="Unexpected or executed"):
        merge(source, direct, ai)
    trace["source"][-1] = trace["source"][-1].replace("Inserted cell inserted.",
                                                        "Inserted cell prefixinsertedsuffix.")
    _write(ai, [question, answer, trace, inserted])
    with pytest.raises(ValueError, match="Unexpected or executed"):
        merge(source, direct, ai)
    trace["source"][-1] = trace["source"][-1].replace("prefixinsertedsuffix", "inserted")
    _write(ai, [question, answer, trace, inserted])

    trace["metadata"].pop("nbinlineaiWorkedEvidence")
    trace["source"] = ["| Tool | Submitted arguments | Observed result |\n",
                       "| --- | --- | --- |\n",
                       '| `insert_code` | {} | {"status":"failed","error":"denied"} |\n']
    _write(ai, [question, answer, trace, inserted])
    with pytest.raises(ValueError, match="Structured tool result"):
        merge(source, direct, ai)


def test_actual_bundled_insert_trace_matches_saved_cell():
    notebook = json.loads((Path(__file__).resolve().parents[1] / "examples" / "bundled-tools.ipynb")
                          .read_text(encoding="utf-8"))
    cells = notebook["cells"]
    trace_index = next(index for index, cell in enumerate(cells)
                       if cell["id"] == "worked-trace-bundled-code-draft-question")
    assert _observed_insertion(cells[trace_index], cells[trace_index + 1], {"insert_code"}) is not None


def test_url_to_note_preserves_requested_early_position(tmp_path):
    source = tmp_path / "python-and-web-tools.ipynb"
    direct = tmp_path / "direct.ipynb"
    ai = tmp_path / "ai.ipynb"
    setup = {"id": "setup", "cell_type": "code", "source": ["answer = 42\n"],
             "metadata": {}, "execution_count": None, "outputs": []}
    later = {"id": "later", "cell_type": "markdown", "source": ["A later section"], "metadata": {}}
    question = {"id": "question", "cell_type": "markdown", "source": ["Use &`url_to_note`."],
                "metadata": {"nbinlineai": {"isPromptCell": True}}}
    note = {"id": "actual-note", "cell_type": "markdown",
            "source": ["Source: https://docs.python.org/3/library/statistics.html\n\nReal fetched page"],
            "metadata": {}}
    answer = {"id": "answer", "cell_type": "markdown", "source": ["Inserted the note."],
              "metadata": {"nbinlineai": {"isOutputCell": True, "promptCellId": "question", "status": "done"}}}
    row = ('| `url_to_note` | completed | '
           '{"url":"https://docs.python.org/3/library/statistics.html",'
           '"after_cell_id":"setup"} | Inserted Markdown cell actual-note in the live notebook model. |\n')
    trace = {"id": "trace", "cell_type": "markdown", "source": [row],
             "metadata": {"nbinlineaiWorkedTrace": True, "questionCellId": "question",
                          "nbinlineaiWorkedEvidence": {"questionCellId": "question", "observedTools": [
                              {"name": "url_to_note", "resultState": "completed"}]}}}
    _write(source, [setup, later, question])
    _write(direct, [setup, later, question])
    _write(ai, [setup, note, later, question, answer, trace])
    assert [cell["id"] for cell in merge(source, direct, ai)["cells"]] == [
        "setup", "actual-note", "later", "question", "answer", "trace"]

    for changed_note, changed_trace, expected in [
        ({**note, "id": "wrong-note"}, trace, "Unexpected or executed"),
        (note, {**trace, "source": [row.replace('"setup"', '"missing"')]}, "missing requested anchor"),
        (note, {**trace, "source": [row.replace('"setup"', '"later"')]}, "requested anchor"),
        ({**note, "source": ["Unattributed content"]}, trace, "Unexpected or executed"),
    ]:
        _write(ai, [setup, changed_note, later, question, answer, changed_trace])
        with pytest.raises(ValueError, match=expected):
            merge(source, direct, ai)
    _write(ai, [setup, later, note, question, answer, trace])
    with pytest.raises(ValueError, match="requested anchor"):
        merge(source, direct, ai)
    _write(ai, [later, setup, note, question, answer, trace])
    with pytest.raises(ValueError, match="source cell order"):
        merge(source, direct, ai)
    _write(ai, [setup, note, question, answer, trace])
    with pytest.raises(ValueError, match="changed source"):
        merge(source, direct, ai)


@pytest.mark.parametrize("explicit_anchor", [False, True])
def test_two_verified_insertions_keep_the_frontend_anchor_tail(tmp_path, explicit_anchor):
    source = tmp_path / "quickstart.ipynb"
    direct = tmp_path / "direct.ipynb"
    ai = tmp_path / "ai.ipynb"
    setup = {"id": "setup", "cell_type": "markdown", "source": ["Setup"], "metadata": {}}
    question = {"id": "question", "cell_type": "markdown", "source": ["Use &`insert_markdown`."],
                "metadata": {"nbinlineai": {"isPromptCell": True}}}
    answer = {"id": "answer", "cell_type": "markdown", "source": ["Both inserted."],
              "metadata": {"nbinlineai": {"isOutputCell": True, "promptCellId": "question", "status": "done"}}}
    argument_suffix = ',"after_cell_id":"setup"' if explicit_anchor else ''
    rows = [
        ('| `insert_markdown` | completed | '
         '{"content":"First"' + argument_suffix + '} | Inserted cell first. |\n'),
        ('| `insert_markdown` | completed | '
         '{"content":"Second"' + argument_suffix + '} | Inserted cell second. |\n'),
    ]
    trace = {"id": "trace", "cell_type": "markdown", "source": rows,
             "metadata": {"nbinlineaiWorkedTrace": True, "questionCellId": "question",
                          "nbinlineaiWorkedEvidence": {"questionCellId": "question", "observedTools": [
                              {"name": "insert_markdown", "resultState": "completed"}]}}}
    first = {"id": "first", "cell_type": "markdown", "source": ["First"], "metadata": {}}
    second = {"id": "second", "cell_type": "markdown", "source": ["Second"], "metadata": {}}
    _write(source, [setup, question])
    _write(direct, [setup, question])
    cells = ([setup, first, second, question, answer, trace] if explicit_anchor
             else [setup, question, answer, trace, first, second])
    _write(ai, cells)
    assert [cell["id"] for cell in merge(source, direct, ai)["cells"]] == [cell["id"] for cell in cells]
    swapped = ([setup, second, first, question, answer, trace] if explicit_anchor
               else [setup, question, answer, trace, second, first])
    _write(ai, swapped)
    with pytest.raises(ValueError, match="observed call order"):
        merge(source, direct, ai)
    unrelated = {"id": "unrelated", "cell_type": "markdown", "source": ["Unrelated"], "metadata": {}}
    misplaced = ([setup, first, unrelated, second, question, answer, trace] if explicit_anchor
                 else [setup, question, answer, trace, first, unrelated, second])
    _write(ai, misplaced)
    with pytest.raises(ValueError, match="requested anchor|Unexpected"):
        merge(source, direct, ai)

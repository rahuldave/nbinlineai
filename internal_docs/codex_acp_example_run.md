# Codex ACP teaching example: isolated live run

Reviewed **2026-09-23**. The reusable, deliberately unexecuted template is
[`examples/codex-acp-worked-example.ipynb`](../examples/codex-acp-worked-example.ipynb).
This record covers a separate Codex task and disposable JupyterLab copy. It is
an implementation/example check, not a release or a test of nbinlineai's API
provider. PyPI remains unchanged.

## Environment and boundaries

- Created a project-local `.venv` with `uv venv --python 3.12 .venv` and
  installed published `nbinlineai==0.1.9`, `jupyter-ai==3.2.0`, `nbformat`,
  `nbclient`, and `ipykernel` using `uv pip install --python .venv/bin/python`.
  Resolved versions: Python 3.12.10, JupyterLab 4.6.4,
  `jupyter-ai-acp-client==0.3.0`, `jupyter-server-mcp==0.3.0`, and
  `nbformat==5.11.1`.
- The existing `/opt/homebrew/bin/codex` launcher failed to start because its
  packaged executable was missing. Installed official npm packages locally,
  inside ignored `.venv/npm`: `@openai/codex` (CLI 0.156.1) and
  `@agentclientprotocol/codex-acp` (1.13.1). The local supported
  `codex login status` command returned **Logged in using ChatGPT**. No login
  flow or API-key fallback was needed. The Jupyter AI [getting-started guide](https://jupyter-ai.readthedocs.io/en/stable/getting-started.html)
  names the Codex adapter and separate agent login.
- Before startup, bind checks confirmed ports **8899** and **3002** were free.
  Started only a loopback JupyterLab on 8899 with port retries disabled and its
  own MCP listener on 3002, using temporary notebook root, Jupyter config,
  data, runtime, and XDG paths under ignored `.venv/`. A copy of the template
  was the only notebook in that root. Port 8888 and the other task ports 8897,
  8898, and 3001 were not used. No nbinlineai provider key was configured.

## What ran

1. `nbformat.validate` accepted the template. A headless pass executed its
   **three** ordinary Python cells in order in the project-local interpreter.
   The draft diagnostic returned `False` and reported the expected five
   mismatches: East absent, North count/mean, and South count/mean. This
   validated the lesson's intentional starting defect without an agent call.
2. In the isolated JupyterLab, both server extensions loaded, the notebook
   displayed nbinlineai controls, and Jupyter Chat offered the **Codex**
   persona. The first copyable chat prompt was sent verbatim. Codex used
   Jupyter AI notebook reads and explained why `if amount` skips both `0.0`
   and `None` and why East has no bucket. It stated it did not edit or run a
   notebook cell. Its startup also issued `pwd`, a failed read of an
   `internal_docs/` path, and a successful read of project documentation;
   these were read-only shell actions, not notebook execution.
3. The second copyable chat prompt was sent verbatim. Codex used Jupyter AI's
   `edit_cell` tool on **only** `revenue-summary-draft`. It moved bucket
   creation before the missing-value check, used `amount is not None`, and
   returned `mean=None` when count was zero. It then used Jupyter AI's
   `run_cell` tool on `revenue-data`, `revenue-summary-draft`, and
   `revenue-checks`, in that order. The code cells showed execution counts
   **1, 2, 3**. The check output was exactly:

   ```text
   All checks pass: zero values count, missing values do not, empty groups remain, and input is unchanged.
   ```

4. Validated the saved disposable notebook with `nbformat`. Relative to the
   template, only `revenue-summary-draft` source changed; cell IDs and all
   `metadata.nbinlineai` values matched. The original template still has
   empty code outputs and execution counts. Neither inline AI question was
   run, no paired answer was generated, and Jupyter AI's Run All was not used.

The live **Codex ACP interaction succeeded** through an existing ChatGPT
login. This demonstrates the agent chat route and its explicit-cell notebook
operations, not an nbinlineai subscription mode: the two inline question/answer
flows would still require nbinlineai's separately configured API provider and
could incur provider charges. The example does not demonstrate `insert_code`;
that is planned for 0.1.10 and must not be implied to exist in published
0.1.9. No account or billing settings were changed and no credentials,
tokens, private notebooks, or generated chat files are committed.

The default Jupyter AI `run_cell` tool used for this run executes Python code
cells by explicit ID. For a nbinlineai Markdown AI question, use its own Run
button or native Shift+Enter. Jupyter AI's Run All invokes JupyterLab's native
command and can submit unanswered AI questions; the example deliberately
avoids it. See the [compatibility assessment](jupyter_ai_compatibility.md) for
the command-level source review.

After the run, the temporary browser tab was closed. A normal JupyterLab
interrupt closed 8899 but left its MCP listener on 3002 in the same owned
process; that process was terminated, and bind checks confirmed both ports
free. No other JupyterLab server was stopped.

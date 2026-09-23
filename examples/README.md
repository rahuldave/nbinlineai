# nbinlineai teaching notebooks

Copy this `examples/` directory into a JupyterLab project, keeping `data/` beside the notebooks. It is also included in the package at `share/doc/nbinlineai/examples/` inside the installed Python environment, and in the [GitHub examples folder](https://github.com/rahuldave/nbinlineai/tree/main/examples). Open a copy in JupyterLab, configure your own provider key, and choose any available model. The notebooks contain no keys or prewritten AI answers.

| Notebook | What to try |
| --- | --- |
| `context-selection.ipynb` | Compare seven Context modes, save Custom text choices, and switch declaration cells on/off with separate Tools controls (0.1.8). |
| `quickstart.ipynb` | A short first prompt with a live variable and one custom function. |
| `live-variables-and-tools.ipynb` | Read a live value, offer selected custom functions, and observe a tool changing Python state. |
| `socratic-learning-dialog.ipynb` | Work through a Learning-style exchange one turn at a time; edit an answer and see how later turns use the correction. |
| `bundled-tools.ipynb` | Import bundled tools, print selected tool references, inspect a saved fixture notebook, and try inserting an unexecuted code draft. |
| `fastcore-tools.ipynb` | Display fastcore-style documentation and try checked text-file edits in a temporary folder. |
| `project-tools.ipynb` | Explore a disposable project with text and AST search, static source docs, document sections, and checked replacements. |
| `live-notebook-tools.ipynb` | Inspect live cells including unsaved edits and insert an editable Markdown note into the open notebook. |
| `python-and-web-tools.ipynb` | Inspect Python help/signatures/source, offer a custom alias, read a public documentation page, and add it as a note. |
| `jupyter-ai-and-nbinlineai.ipynb` | Analyze a small pollinator survey with standard-library Python; optionally use Jupyter AI chat for planning/refactoring and nbinlineai Learning questions for in-notebook explanation and an unexecuted code draft. |
| `codex-acp-worked-example.ipynb` | Ask Codex in Jupyter AI chat to diagnose and fix a revenue calculation that confuses zero with missing data, run its checks, then use nbinlineai for an inline explanation and tutoring follow-up. Tested with an authenticated Codex ACP agent. |

Run the setup code in each notebook before its AI prompts. The Learning notebook has blank prompt cells for **your** attempts: fill and run each one only after reading the previous tutor answer. Work through both combined-extension examples step by step too; their chat and learning activities require pauses. Do not use Run All to skip those pauses. Run All executes code and AI prompts in order; a provider call may incur normal API usage.

The Codex example retains an intentional bug so you can reproduce the exercise. Its Python checks run without an API key and initially report the expected mismatches. The live agent trial fixed a disposable copy and passed every check; the [run record](https://github.com/rahuldave/nbinlineai/blob/main/internal_docs/codex_acp_example_run.md) explains exactly what was tested. Jupyter AI's Codex login is separate from nbinlineai's API configuration, and its chat history does not automatically enter inline context. Both inline questions are unrun in the template.

The bundled-tools example reads `data/ecosystem-lesson.ipynb` from disk. Its setup accepts either a kernel working directory at the repository root (`examples/data/...`) or inside the copied `examples/` directory (`data/...`). Keep the fixture with the examples and save any notebook edits before expecting file tools to see them. The notebook kernel must be able to import `nbinlineai.tools`.

The [tools reference](https://rahuldave.com/nbinlineai/tools.html) lists all 55 tools, and the separate [examples guide](https://rahuldave.com/nbinlineai/examples.html) walks through complete workflows.

For bundled tools, `tools_markdown()` prints references for the 19-tool starter group; pass `group="code"`, `"files"`, `"inspect"`, `"notebook"`, `"saved_notebooks"`, `"web"`, or `"execution"` to choose another group; copy only the desired lines into an **ordinary Markdown declaration above your AI questions**. The custom-tool notebook generates references from its locally defined function names. A tool named with ``&`name` `` in ordinary Markdown or an earlier AI **question** stays available to lower AI questions in that notebook. The kernel must still contain an import or definition of the callable when a lower question runs. AI answers, code cells, raw cells, and cells below the question do not declare tools. Repeating a reference in the current question is optional. Keep declarations selective: lower questions inherit enabled declarations above them. The separate per-cell Tools checkbox can withdraw declarations without changing selected text; another enabled cell can still declare the same name. A ``$`variable` `` value is read only when the **current AI question** contains it.

The live-notebook tools `list_cells`, `read_cell`, `insert_markdown`, `insert_code`, and `url_to_note` are imported Python stubs. Calling one directly in a code cell raises an explanation; an AI Prompt with its `&` reference lets the JupyterLab extension handle it in the current notebook. Inserted notes and code drafts remain editable and become durable when you save the notebook. `insert_code` never executes the draft; review it before running it yourself. `read_url` is an ordinary Python tool and can also be called directly. Web tools make outbound requests only to public HTTP(S) pages, with size and time limits; remote page text is untrusted.

For a custom callable alias, bind the alias in the kernel, then pass an explicit mapping such as `tools_markdown(["average_alias"], custom={"average_alias": average_alias})`. The helper only formats references. Put ``&`average_alias` `` in an ordinary Markdown declaration above the questions that need it, or in an earlier AI question.

The live-variables notebook ends with an optional JupyterLab-only code cell calling `insert_tools(...)`. It inserts the selected references as a new, editable ordinary Markdown declaration immediately below that code cell without calling a model. Run it separately when you want that note, and save the notebook to keep it. The headless example check skips this tagged UI helper cell.

**Keep AI answers** starts on. A completed answer is saved and protected; a tool's previous side effect is not replayed when that answer is kept. Turn Keep off deliberately to refresh an answer, and rerun setup code when you want to reset the example's Python state.

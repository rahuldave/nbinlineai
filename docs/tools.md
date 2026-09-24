---
title: Tools reference
---

# Tools reference

Version **0.1.12** offers 51 optional tools through `nbinlineai.tools`. Import the functions you need into the notebook's Python kernel, then declare them with ``&`name` `` in an ordinary Markdown note above the AI question or in the question itself. Importing a function alone does not offer it to the model. The [examples guide](examples.md) has complete notebook workflows.

A new release with frontend changes needs a **JupyterLab server restart** after installation or upgrade, followed by a browser reload. Restart the selected Python kernel and rerun imports too. The older editable-install, Python-only shortcut for the first eight fastcore tools does not apply to this release's live notebook edits. See [setup](user-guide.md) and [development](development.md).

## Choose and declare tools

```python
from nbinlineai.tools import search_files, source_doc, tools_markdown
print(tools_markdown(["search_files", "source_doc"]))
```

Paste the output into an ordinary Markdown cell above your AI question; delete any references you do not want to offer. To have the frontend insert that note below the calling code cell, use `insert_tools(["search_files", "source_doc"])`. The helper returns an asynchronous receipt: check its `status`, `cell_id`, or `error` in a later code cell. Save the notebook after insertion. The helper needs the nbinlineai frontend and ipykernel 6.18 or newer; `tools_markdown()` also works without the frontend.

`tool_catalog(group="")` lists group names and member names **without `&` declarations**. `tools_markdown(names=None, custom=None, group="starter")` and `insert_tools(names=None, custom=None, group="starter")` default to the 19-tool starter group. Pass a group such as `"code"` (nine tools in 0.1.12), `"notebook"`, or `"web"`, or pass an explicit `names` list to select individual functions. `names` takes precedence over the group. Some groups contain overlapping tools, and the 20-reference limit still applies to a generated note. The available groups are `starter`, `files`, `code`, `inspect`, `notebook`, `saved_notebooks`, `web`, and `execution`.

```python
from nbinlineai.tools import *         # Import the toolbox; declarations choose model access.
print(tool_catalog())                  # names only; no declarations
print(tools_markdown(group="code"))    # removable & references
```

An eligible ordinary Markdown cell or earlier AI question can declare tools for later questions. AI answers, code cells, raw cells, output, and cells below the question do not declare them. The **Tools** checkbox on each declaration cell controls whether its references count; it is independent of the **Context** text checkbox. The server discovers enabled references before optional context trimming, and Current question only retains enabled tool choices. Duplicate names count once. A missing imported name fails before the provider call. The current question's ``$`name` `` reads a live kernel value; earlier `$` references stay literal. A request permits **20 distinct tool and variable names combined**. This is nbinlineai’s own guardrail, not a provider-imposed tool limit. Schemas, instructions, and executed tool results use the shared 64,000-character estimate before optional notebook text. Keep answer skips a completed tool run; cancellation does not undo completed effects.

## Function index

Every row below is an import from `nbinlineai.tools`. Signatures show the callable parameters and defaults. All functions are synchronous; model calls use named arguments. `tools_markdown`, `insert_tools`, and `tool_catalog` are setup helpers, not model tools.

Each **Example** is a question you can ask **after importing the tool and declaring its reference** in an earlier Markdown note with Tools enabled. You do not need to repeat the `&` reference in the question. Ask the model to use the named tool when you want an explicit lookup or action; offering a tool does not force a call. See the [complete declaration-to-question example](examples.md#ask-after-declaring-a-tool).

Replace the sample paths, variable names, and cell descriptions with your own. The examples assume those inputs exist; `create_file` needs an existing parent folder and a new filename. Examples referring to an earlier read, search, outline, or listing need that result in the question's selected context, or the relevant reading tool declared too. Copy actual cell IDs, section addresses, and digests from tool results. Source-checked cell edits need the **complete** current cell source; read any remaining lines before editing a long cell. The write and execution examples perform the requested action when called.

### Live Python and registered skills

| Function | Purpose |
| --- | --- |
| `search_kernel_names(query: str, limit: int = 20)` | Find live Python kernel names containing a literal query, with types only.<br>**Example:** “Find live variable names containing `score` and tell me their types.” |
| `inspect_python(name: str, section: str = 'help')` | Inspect a live Python name's help, signature, or available source.<br>**Example:** “Show the signature and available source of my live function `normalize`.” |
| `show_doc(name: str, module: str = '')` | Show docs for a live name, or import `module` and inspect its public name.<br>**Example:** “Show formatted documentation for `Path.read_text` from the installed module `pathlib`.” |
| `api_names(name: str, module: str = '', query: str = '', limit: int = 30)` | List public members of a live object or explicitly imported module.<br>**Example:** “List up to 15 public names containing `mean` in the installed `statistics` module.” |
| `search_docs(name: str, query: str, module: str = '', depth: int = 1, limit: int = 20)` | Search public names and direct docstrings in a bounded object tree.<br>**Example:** “Search the installed `statistics` module's public docstrings for `sample`.” |
| `inspect_value(name: str, start: int = 0, limit: int = 20)` | Show a bounded slice of a live built-in container or text value.<br>**Example:** “Show the first five items in the live list `scores`.” |
| `search_value(name: str, query: str, limit: int = 20)` | Search bounded visible values in live text or a built-in container.<br>**Example:** “Find entries containing `error` in the live string `log_text`.” |
| `source_files(name: str, module: str = '', limit: int = 30)` | Find nearby Python source files for a live symbol or imported module.<br>**Example:** “Find Python source files near the installed `nbinlineai` package.” |
| `list_skills(query: str = '', limit: int = 30)` | List installed pyskill entry points and static module descriptions.<br>**Example:** “List the installed Python skills and their descriptions.” |
| `read_skill(module: str)` | Read a registered pyskill's static module instructions without importing it.<br>**Example:** “Read the instructions for the registered skill returned by the earlier `list_skills` call.” |
| `trace_function(name: str, args_json: str = '[]', kwargs_json: str = '{}', max_events: int = 40)` | Call a live Python function once and show a bounded execution trace.<br>**Example:** “Run my live function `normalize` once with the list `[2, 4, 6]` as its argument and show up to 20 trace events.” |

### Saved files and source

| Function | Purpose |
| --- | --- |
| `path_info(path: str = '.')` | Show the kernel working directory and a path's resolved type and size.<br>**Example:** “Show the kernel's current working directory and resolve `demo_project`.” |
| `list_files(path: str = '.', pattern: str = '*', recursive: bool = False, limit: int = 30)` | List visible file and directory paths, optionally matching a name pattern.<br>**Example:** “List up to 20 Python files under `demo_project`, including subfolders.” |
| `view_file(path: str, start_line: int = 1, end_line: int = 40)` | Read a bounded range of one UTF-8 text file with one-based line numbers.<br>**Example:** “Read lines 1–30 of `demo_project/analysis.py` with line numbers.” |
| `create_file(path: str, contents: str)` | Create a new UTF-8 text file without replacing an existing path.<br>**Example:** “Create `demo_project/notes.md` containing `# Experiment notes` on its own line.” |
| `file_str_replace(path: str, old_str: str, new_str: str, expected_matches: int = 1)` | Replace an exact literal only when its occurrence count matches expectation.<br>**Example:** “In `demo_project/analysis.py`, replace the single occurrence of `threshold = 0.5` with `threshold = 0.7`.” |
| `file_insert_line(path: str, line: int, new_str: str)` | Insert text after a one-based line; line 0 inserts before the first line.<br>**Example:** “Insert `# Inputs` as a new line after line 2 of `demo_project/analysis.py`.” |
| `file_replace_lines(path: str, start_line: int, end_line: int, new_content: str)` | Replace an explicit inclusive, one-based line range with UTF-8 text.<br>**Example:** “Replace lines 2–3 of `demo_project/notes.md` with the single line `Status: ready`.” |
| `search_files(query: str, path: str = '.', pattern: str = '*', regex: bool = False, limit: int = 20)` | Search saved project source text with bounded Python-based results and file filters.<br>**Example:** “Find `normalize` in Python files under `demo_project`; show up to ten matches.” |
| `source_doc(path: str, symbol: str = '')` | Read Python source documentation statically, without importing the file.<br>**Example:** “Explain the written signature and documentation of `normalize` in `demo_project/analysis.py` without importing it.” |
| `document_outline(path: str, start: int = 0, limit: int = 20)` | List headings or definitions in saved Markdown or Python, with opaque section addresses.<br>**Example:** “Show the section hierarchy of `demo_project/README.md`, including the addresses for reading sections.” |
| `read_document_section(path: str, section: str = '')` | Read saved Markdown or Python, or one section using a copied outline address.<br>**Example:** “Read only the Installation section of `demo_project/README.md` using its address from the earlier outline.” |
| `file_strs_replace(path: str, old_strings: list[str], new_strings: list[str])` | Replace several exact literals atomically when each old string occurs once.<br>**Example:** “In `demo_project/settings.py`, replace `retries = 2` with `retries = 3` and `timeout = 5` with `timeout = 10`, each occurring once.” |
| `view_file_hashes(path: str, start_line: int = 1, end_line: int = 40)` | Show numbered lines and the SHA-256 digest for a saved text file.<br>**Example:** “Show lines 1–20 of `demo_project/settings.py` and its whole-file SHA-256 for a checked edit.” |
| `file_replace_checked(path: str, old_str: str, new_str: str, expected_sha256: str)` | Replace one literal only when the whole file has the expected SHA-256.<br>**Example:** “Using the digest from the earlier file read, replace the single `retries = 2` with `retries = 3` in `demo_project/settings.py`; stop if the file changed.” |

### Saved notebooks

| Function | Purpose |
| --- | --- |
| `list_notebooks(path: str = '.', limit: int = 30)` | List saved .ipynb paths, skipping hidden and environment directories.<br>**Example:** “List up to ten saved notebooks under `demo_project`.” |
| `find_notebook_cells(path: str, query: str, limit: int = 10)` | Find saved notebook cells by case-insensitive literal source text.<br>**Example:** “Find cells containing `train_test_split` in the saved notebook `demo_project/analysis.ipynb`.” |
| `read_notebook_cell(path: str, cell_id: str, start_line: int = 1, end_line: int = 40)` | Read numbered saved cell source by ID or zero-based index:N fallback.<br>**Example:** “Read the saved cell containing `train_test_split` in `demo_project/analysis.ipynb`, using the ID from the earlier search.” |
| `search_notebooks(query: str, path: str = '.', limit: int = 20)` | Search saved notebook cell source; include stable saved cell IDs.<br>**Example:** “Search saved notebooks under `demo_project` for `train_test_split` and report each matching cell ID.” |
| `notebook_outline(path: str, start: int = 0, limit: int = 20)` | Summarize a saved notebook's cells and stable IDs by index.<br>**Example:** “Summarize the first 20 saved cells in `demo_project/analysis.ipynb`, including their IDs.” |

### Live notebook cells

| Function | Purpose |
| --- | --- |
| `list_cells(start: int = 0, limit: int = 20)` | List live notebook cells, including unsaved edits, by ID and position.<br>**Example:** “List the first 20 cells in this open notebook, with their IDs and source previews.” |
| `read_cell(cell_id: str, start_line: int = 1, end_line: int = 40)` | Read live notebook cell source, including unsaved edits, by cell ID.<br>**Example:** “Read lines 1–40 of the live cell with the ID returned by the earlier cell search.” |
| `find_cells(query: str, cell_type: str = '', limit: int = 20)` | Find live notebook cells containing text, including unsaved edits.<br>**Example:** “Find live code cells containing `train_test_split`, including unsaved edits.” |
| `insert_markdown(content: str, after_cell_id: str = '')` | Insert a Markdown note into the current live notebook after a cell.<br>**Example:** “Add an ordinary Markdown note below your answer saying `Check the validation split before training.`” |
| `insert_code(content: str, after_cell_id: str = '')` | Insert an unexecuted code cell below the AI answer, or after a chosen cell.<br>**Example:** “Add a code cell below your answer that plots the live list `scores`; leave it unexecuted for me to review.” |
| `replace_cell(cell_id: str, expected_source: str, new_source: str)` | Replace an ordinary cell only when its source still matches.<br>**Example:** “Replace the scratch cell just read with `print('ready')`, using its exact current source as the check.” |
| `cell_str_replace(cell_id: str, old_str: str, new_str: str, expected_matches: int = 1)` | Replace an exact string when its occurrence count matches.<br>**Example:** “In the live cell just found, replace the single `test_size=0.2` with `test_size=0.25`.” |
| `cell_insert_line(cell_id: str, line: int, content: str, expected_source: str)` | Insert content before a line in an unchanged ordinary cell.<br>**Example:** “In the scratch cell just read, insert `# Prepare inputs` before line 1, checking its full current source.” |
| `cell_replace_lines(cell_id: str, start_line: int, end_line: int, content: str, expected_source: str)` | Replace inclusive source lines in an unchanged ordinary cell.<br>**Example:** “In the scratch cell just read, replace lines 2–3 with `scores = [1, 2, 3]`, checking its full current source.” |
| `delete_cell(cell_id: str, expected_source: str)` | Delete an ordinary cell only when its source still matches.<br>**Example:** “Delete the ordinary scratch cell just read, only if its full source is unchanged.” |
| `move_cell(cell_id: str, after_cell_id: str)` | Move an ordinary cell after another cell without executing it.<br>**Example:** “Move the scratch cell after the imports cell, using their IDs from the earlier listing.” |
| `copy_cell(cell_id: str, after_cell_id: str)` | Copy an ordinary cell after another cell without execution results.<br>**Example:** “Copy the scratch cell after the imports cell, using their listed IDs and leaving the copy unexecuted.” |
| `split_cell(cell_id: str, line: int, expected_source: str)` | Split an unchanged ordinary cell before a source line.<br>**Example:** “Split the scratch cell just read before line 4, checking that its full source is unchanged.” |
| `merge_cells(first_cell_id: str, second_cell_id: str, expected_first: str, expected_second: str)` | Merge adjacent same-type cells when both sources match.<br>**Example:** “Merge the two adjacent ordinary Markdown cells just read, checking both full sources.” |

### Web pages

| Function | Purpose |
| --- | --- |
| `read_url(url: str)` | Read a public web page as bounded, sanitized Markdown with its source URL.<br>**Example:** “Read https://docs.python.org/3/tutorial/datastructures.html and explain its advice about using lists as stacks.” |
| `read_url_section(url: str, selector: str = '')` | Read one public web-page section using a CSS selector or URL fragment.<br>**Example:** “Read only the `#list-comprehensions` section of https://docs.python.org/3/tutorial/datastructures.html and explain its example.” |
| `url_to_note(url: str, after_cell_id: str = '')` | Fetch a public page and insert its bounded Markdown as a notebook note.<br>**Example:** “Insert a reading note from https://docs.python.org/3/tutorial/datastructures.html below your answer.” |

### Processes and terminals

| Function | Purpose |
| --- | --- |
| `run_python(code: str, cwd: str = '.', timeout: int = 10)` | Execute Python with the kernel's interpreter in a fresh process; effects are real.<br>**Example:** “Run `print(sum([2, 4, 6]))` in a fresh Python process and show the result.” |
| `run_shell(command: str, cwd: str = '.', timeout: int = 10)` | Execute a shell command in a separate process; effects are real, not sandboxed.<br>**Example:** “Run `git status --short` in the `demo_project` repository and report changed paths.” |
| `tmux_sessions()` | List local tmux panes; requires tmux and does not list JupyterLab terminals.<br>**Example:** “List the local tmux panes and their session names.” |
| `tmux_read(pane: str, lines: int = 40)` | Read a local tmux pane's recent screen/scrollback without sending input.<br>**Example:** “Read the last 30 lines from the tmux pane identified in the earlier listing.” |

## Files, source, and saved notebooks

File and source tools run on the **selected kernel's machine**, using its current working directory for relative paths. That directory may differ from the notebook's folder and from the Jupyter server's working directory. A search path is the starting location, not a filesystem sandbox; use an explicit path when the working directory is uncertain. These tools use the kernel user's filesystem permissions. They search saved files and therefore cannot see unsaved notebook edits. `path_info()` shows the kernel working directory and a resolved path.

`list_files` lists one directory by default; `recursive=True` descends at most six levels and visits at most 2,000 entries. `search_files` uses bounded Python source search with an optional filename glob and literal or regex query. `search_notebooks` searches **saved cell source**, returning saved cell IDs. Both searches follow nested `.gitignore`, `.ignore`, and `.rgignore` rules using `pathspec`, skip hidden and environment directories, and report partial results when traversal, time, or result bounds are reached. Regex matching has a hard timeout even for a pathological pattern. `list_notebooks`, `find_notebook_cells`, `read_notebook_cell`, and `notebook_outline` also work on saved `.ipynb` files; save first or use live-cell tools. `notebook_outline` paginates cell summaries and validates the saved structure. Existing saved-notebook reads are limited to 8 MB; source/project text reads are limited to 1 MB. Rich outputs and image pixels are not read into these source searches.

The 0.1.11 syntax tools `ast_search`, `ast_rewrite`, `file_ast_replace`, and `python_symbols` are no longer bundled in 0.1.12. Use source text search and checked literal edits for the current tool set.

`source_doc(path, symbol="")` parses a saved Python file **without importing or running it**. It can show the module, a class, or a dotted function/method definition, including the written signature, annotations, defaults, parameter comments, docstring, and public module/class declarations. By comparison, `show_doc(name, module="")` and other live inspection tools inspect objects in the running kernel. When you pass an explicit `module`, importing it runs that module's initialization; inspecting the chosen object does not call it. `inspect_value` and `search_value` read bounded live object data. `trace_function` **calls the live function** with supplied JSON arguments, records a bounded trace, and can have the function's real side effects.

`document_outline` parses saved Markdown headings with `markdown-it-py` and saved Python definitions with the standard library AST. Pass an opaque address copied from that outline to `read_document_section`; any file change invalidates the copied address, so get a fresh outline after editing. An empty `section` reads the whole bounded document. Outlines for JavaScript, TypeScript, TSX, Rust, Zig, and Swift are deferred. `view_file_hashes` shows numbered lines and a **whole-file SHA-256**; give that digest to `file_replace_checked` with one exact old string to reject a stale edit. `file_strs_replace` checks that each distinct old string occurs exactly once and applies the replacements together. `create_file`, the line/literal editors, and digest-checked replacement reject `.ipynb` paths. Ordinary text edits are checked against a fresh read, preserve file mode, write atomically, and return bounded diffs. They do not lock out another writer. New text arguments are bounded; use the returned error to narrow a large edit.

## Live notebook cells

The live-cell functions use the open JupyterLab document model, including **unsaved and offscreen cells**. They bind to the notebook, session, kernel, and stable cell IDs that started the question; switching tabs cannot redirect a call. Direct Python calls to these browser-backed functions raise an explanatory error. `list_cells`, `read_cell`, and `find_cells` inspect source without executing it. `find_cells` scans at most 2,000 cells and 2,000,000 source characters; its result reports scanned cells and whether the search is partial or truncated. A total match count is supplied only after a complete scan. `insert_markdown`, `insert_code`, and `url_to_note` create ordinary editable cells after the paired answer by default, or after an explicit ID. Inserted code has empty outputs and does not execute, including during a current Run All.

The ten live edit tools change **ordinary code, Markdown, or raw cells** through the document model. They do not edit AI question/answer cells. `replace_cell`, line edits, `delete_cell`, `split_cell`, and `merge_cells` require the exact current source text supplied as an `expected_...` argument; `cell_str_replace` requires an exact match count. Stale or missing cells fail instead of applying a guessed edit. Move and copy use stable source and anchor IDs. Copy and split create new IDs. Metadata not owned by nbinlineai is preserved, and edits to code source clear its stale outputs and execution count. No edit tool executes code or saves the notebook file. Save normally after inspecting a change. An acknowledgement means the **live document changed**, not that it was saved; inspect the notebook before retrying after a lost acknowledgement.

## Web, processes, and terminal reading

`read_url` returns a source-attributed excerpt from a public HTTP(S) page. `read_url_section` narrows that page with a CSS selector. `url_to_note` fetches a public page from the Jupyter server and inserts an editable Markdown note in the original notebook. Web fetches bound download size, redirects, and time, reject private/local or credential-bearing URLs, and do not log in, run JavaScript, or read PDF/image contents. Tool results are not automatically saved as transcripts.

`run_python` executes code with the selected kernel's interpreter in a **fresh subprocess**, so it does not share live notebook variables. `run_shell` executes a shell command in a fresh process. Both run with the kernel user's real permissions, are **not sandboxed**, accept an existing `cwd`, enforce a 1–20 second timeout, and bound captured output. Command effects can persist after the call. `tmux_sessions` and `tmux_read` inspect a **local tmux** instance if installed; they do not list JupyterLab terminals, send keys, or create sessions.

## Your own functions

A synchronous Python function you import or define in the kernel can be offered with `&` if it has supported named, typed parameters and a docstring. Custom aliases can be supplied to the setup helpers, for example:

```python
from nbinlineai.tools import read_cell as read_live, tools_markdown
print(tools_markdown(["read_live"], custom={"read_live": read_live}))
```

The alias must also be bound in the kernel namespace when the question runs.

## Relationship to dialoghelper

The tool selection draws on [Answer.AI's dialoghelper](https://github.com/AnswerDotAI/dialoghelper) and the libraries it surfaces. We reuse fastcore helpers where they fit and reimplement selected capabilities with nbinlineai's own arguments, bounded results, and JupyterLab integration. The following describes the **0.1.12 implementation**, rather than every capability available upstream.

| Capability surveyed upstream | Implementation in nbinlineai |
| --- | --- |
| Fastcore documentation and text editing | `show_doc` uses fastcore's `MarkdownRenderer`/docments for formatted object documentation. The file tools wrap fastcore text-edit/diff helpers with our own path, size, match-count, and atomic-write checks. `source_doc` separately parses a Python file without importing it. |
| rgapi file and notebook search | `search_files` and `search_notebooks` were reimplemented using Python matching and notebook JSON reads, with `pathspec` ignore rules and a separate process enforcing the search timeout. They do not require rgapi. |
| exhash document navigation and checked edits | `document_outline` and `read_document_section` were reimplemented for Markdown with `markdown-it-py` and Python with the standard-library AST. Addresses become stale when file contents change. Our checked text edits use whole-file SHA-256 through `hashlib`; they do not expose exhash's edit language or require exhash. |
| toolslm/pyskills inspection and skill discovery | Our fixed-signature tools inspect Python objects and installed `pyskills` entry-point metadata. Skill instructions are read statically; discovering a skill does not install it or automatically offer its functions to the model. |
| dialoghelper/Solveit and aidialog message operations | Live cell search, insertion, replacement, deletion, move/copy, split, and merge are adapted to the originating JupyterLab document through our browser bridge. Saved-notebook tools read `.ipynb` files separately. |
| Execution, tracing, and terminal utilities | Our subprocess tools use Python's standard library; `trace_function` traces a real call in the live kernel. The terminal tools read local tmux. These are our implementations, without the safecmd/safepyrun policy layer or a tracefunc dependency. |

This is a selected capability set, not API compatibility with dialoghelper. Neither dialoghelper, Solveit, nor ipylab is required. The remold/AST tools `ast_search`, `ast_rewrite`, `file_ast_replace`, and `python_symbols` are **deferred in 0.1.12**, along with document outlines for languages other than Markdown/Python. Agent orchestration, Solveit-specific UI/lifecycle operations, and model-driven live-cell execution are also outside the current tools.

The [implementation matrix and pinned upstream survey](https://github.com/rahuldave/nbinlineai/blob/main/internal_docs/fastcore_tool_candidates.md) explain the package-by-package decisions; the [original dialoghelper catalog](https://github.com/rahuldave/nbinlineai/blob/main/internal_docs/dialoghelper_tool_catalog.md) records the earlier research.

[Examples guide](examples.md) · [User guide](user-guide.md) · [FAQ](faq.md) · [Architecture](architecture.md)

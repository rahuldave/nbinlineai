# dialoghelper capabilities: what fits nbinlineai

**Research record, reviewed 2026-09-22** against dialoghelper commit [`118fff2cfba024381a693d20a5612aedec54cf5b`](https://github.com/AnswerDotAI/dialoghelper/tree/118fff2cfba024381a693d20a5612aedec54cf5b). The recommendations below record the options considered before implementation. The user subsequently approved the frontend interface, the tools it enables, and examples. See [the 0.1.6 implementation design](bundled_tools.md) for the selected ten-tool scope and protocol; publication verification is tracked separately in [releasing](releasing.md).

## How to read this assessment

The portability ratings below are our engineering assessment of the inspected code, rather than claims made by upstream. Grouped rows cover related public functions; low-level transport helpers are listed separately from functions a student would give an AI.

- **Small adaptation:** can run in our existing Python tool bridge with a bounded, synchronous wrapper.
- **Saved-file adaptation:** the capability works against a named `.ipynb` on disk. Reading the live, unsaved notebook needs another interface.
- **New Jupyter integration:** feasible, but requires frontend/server work beyond an imported Python function.
- **Solveit implementation:** its exact routes or runtime have no counterpart here. We can implement a Jupyter equivalent where useful.

Most capabilities are feasible in principle. The real decisions are the amount of integration work, whether they inspect or change state, and their value for a student notebook.

The follow-up [ipylab assessment](ipylab_frontend_bridge_assessment.md) compares an existing Python/frontend library with these requirements. It confirms useful command/snippet support but identifies missing cell-specific reads, edit acknowledgements, and command results. Our existing frontend can supply the needed notebook operations through a dedicated protocol.

## 1. Small or saved-file adaptations

| Upstream functions | What they do | How they fit here; what must change |
| --- | --- | --- |
| [`names_containing`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/core.py#L65) | Find names in a live Python namespace. | **Small adaptation.** Read the active IPython namespace directly. Our draft `search_kernel_names` returns names/types without values. |
| [`mk_toollist`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/utils.py#L172) | Generate Markdown references and descriptions for usable Python functions. | **Small adaptation; a helper, not a model tool.** This is the closest match to the requested `cli --tools` equivalent. Our draft `tools_markdown()` lists registered built-ins; a custom-function formatter could also accept an explicit list or name-to-callable mapping. Aliases must match names actually imported into the kernel. |
| [`list_dialogs`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/core.py#L353) | Discover notebooks and folders. | **Saved-file adaptation.** Our draft `list_notebooks` uses an explicit directory. Upstream resolves paths through its gateway; ours uses kernel cwd or absolute filesystem paths. |
| [`find_msgs`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/core.py#L513) | Search cells; filter by type, errors, headings, etc. | **Saved-file adaptation.** Our draft `find_notebook_cells` searches source text. Type/heading filters can be added. Upstream live-state, skip flags, and rich outputs require additional semantics. |
| [`read_msg`, `read_msgid`, `view_msg`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/core.py#L451) | Read particular cells, line ranges, or cells relative to the current one. | **Saved-file adaptation** for explicit paths/IDs, as in our draft `read_notebook_cell`. “Current cell,” relative navigation, unsaved edits, and current outputs need the live frontend model. |
| [`view_dlg`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/core.py#L563) | Read the whole notebook/dialog in a compact form. | **Saved-file adaptation.** A notebook outline or paged source reader would be useful. The current tool channel caps results at 4,000 characters, so promising an entire arbitrary notebook in one response would be misleading. This does not implement automatic whole-notebook context mode. |
| [`url2note`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/core.py#L867) | Fetch a web page and insert its contents as notebook notes, optionally with images. | **Split adaptation.** Fetching bounded page text/Markdown is straightforward and useful for documentation. Inserting a note needs the frontend bridge; returning images needs a richer tool result protocol. A first `read_url_markdown` tool could just return page text and source URL. |
| [`ctx_folder`, `ctx_repo`, `ctx_symfile`, `ctx_symfolder`, `ctx_sympkg`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/utils.py#L96) | Collect code from local folders, repositories, or a symbol's source, then add it to the dialog. | **Split adaptation.** Collecting bounded text can run as a kernel tool; automatically inserting context cells needs frontend integration. Favor specific files/symbols and pagination over dumping a package into a small result channel. |
| [`ast_grep`, `ast_py`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/utils.py#L42) | Search code by syntax structure rather than text. | **Small adaptation with an optional dependency.** `ast-grep` or `ast-grep-py` does the parsing. Return compact matches; do not return a parser object from `ast_py` as a model result. Use argument lists instead of upstream's interpolated shell command. |
| [`_ast_replace` underlying `msg_ast_replace`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/utils.py#L70) | Rewrite matching syntax. | **Small adaptation** if given source text and returning new text/a diff. Applying that edit to a live notebook is a separate feature. Useful for demonstrating refactors. |
| [`tracetool`, `fmt_trace`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/tracetools.py#L23) | Execute a function and record per-line execution counts and local values; format a Markdown trace. | **Adaptable with runtime constraints.** Strong teaching/debugging value. Upstream uses `tracefunc` and Python 3.12+ `sys.monitoring`; we currently support Python 3.11 too. Use an optional extra or a separately designed fallback, limit trace output, and state that it executes the function and can repeat its effects. The formatter can remain a non-tool helper. |

The source files themselves and local checkout were inspected; upstream's generated documentation endpoints were intermittently unavailable through browsing.

## 2. Useful functions imported by dialoghelper, rather than defined there

[`stdtools.py`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/stdtools.py) assembles capabilities from several packages. These deserve consideration, but should not be mistaken for dialoghelper's own implementations or one universally compatible tool bundle. Dependency APIs can move independently from the pinned dialoghelper commit.

| Imported family | Useful capability | Adaptation assessment |
| --- | --- | --- |
| [`toolslm.inspecttools`](https://github.com/AnswerDotAI/toolslm/blob/main/toolslm/inspecttools.py): `symsrc`, `symtype`, `symval`, `symtype_val`, `symdir`, `symlen`, `symslice`, `symnth`, `symsearch` | Inspect Python source, types, attributes, values, lengths, slices, and search results. | **Good kernel candidates.** Bind symbol lookup explicitly to our current IPython namespace, bound returned text, and avoid accidental reliance on Solveit-specific caller sentinels or global `_last` state. A compact source/docstring/signature inspection tool is particularly useful for learners. `$` already covers a known variable's simple repr; tools add discovery and selective inspection. |
| `toolslm.inspecttools`: `importmodule`, `symset` | Import a module or set a helper variable in the caller namespace. | **Feasible state-changing tools.** Imports can execute module initialization. Ordinary code cells already make these actions visible and reproducible; include only if autonomous setup is part of the intended workflow. |
| `fastcore.tools`: `view_file`, `create_file`, `file_insert_line`, `file_str_replace`, `file_strs_replace`, `file_replace_lines`, `file_del_lines` | Read or edit regular text files. | **Small kernel wrappers.** File reading is broadly useful. Editing also works, but changes disk files and needs precise matching/diff behavior. Editing a live notebook's JSON on disk is not a replacement for editing its open document. |
| `fastcore.tools` text transforms and `exhash` | Transform text or apply edits addressed by a line number and content hash. | **Adaptable as pure helpers or explicit file editors.** Hash checks can detect stale edits. They do not supply frontend synchronization by themselves. |
| `rgapi` | Search text in project files. | **Good optional project tool.** Requires its search dependency/runtime and bounded results. It is distinct from searching cells in a saved `.ipynb`. |
| `safecmd.bash`, `safepyrun.RunPython` | Execute shell commands or Python. | **Feasible, substantial capability expansion.** These change the model from calling chosen domain functions to choosing arbitrary commands/programs. Their execution and restriction models need deliberate integration; importing their names does not create a sandbox around nbinlineai. |
| `pyskills` | Discover tools/instructions and manage allowed functions. | **Optional architecture choice.** We already have a per-prompt tool allowlist; adopting another discovery/permission system needs an explicit mapping rather than silently importing every exported symbol. |

## 3. Feasible capabilities requiring a Jupyter frontend/server bridge

| Upstream functions | Why they cannot be copied directly | What a Jupyter implementation needs |
| --- | --- | --- |
| [`curr_dialog`, `find_dname`, `realpath`, `data_root`, `dlg_path`, `cells_client`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/core.py#L151) | They rely on the Solveit gateway's mapping from kernel to dialog/path. A Python kernel does not itself know the user's active cell or complete editor model. | Pass authenticated notebook/session/prompt IDs and a versioned frontend snapshot to the operation. Jupyter session paths help locate a notebook, but don't identify the current cell or unsaved text. |
| `add_msg`, `update_msg`, `del_msgs`, `copy_msgs`, `paste_msgs` | Their mutation/clipboard routes target Solveit. Disk-only edits could conflict with unsaved browser changes. | Apply explicit cell operations to the open Jupyter document using stable IDs and shared-model transactions; preserve prompt/answer links and support undo. Treat closed-file edits separately. |
| `msg_insert_line`, `msg_str_replace`, `msg_strs_replace`, `msg_replace_lines`, `msg_del_lines`, `msg_ast_replace`, `lnhashview_msg`, `msg_exhash` | Text transformations are portable; their read-current-cell/write-current-cell operations are gateway-bound. | Read the live cell, check a revision or content hash, and apply the requested edit atomically to the same cell. The hash-based editing idea is useful even though the upstream message API is not reusable. |
| `run_msg`, `Message.execute`, `Dialog.execute`, `run_and_prompt` | They use Solveit's execution queue/sidecar and its concept of a current message. | Server/frontend execution orchestration respecting our existing Keep settings, cancellation, queue ordering, and output handling. A kernel tool must not block waiting for another execute request to that same busy kernel. |
| `run_code_interactive` | Inserts code and relies on the model/tool loop stopping to await the human. | An “insert suggested code” action plus a real pause/resume contract. Returning text saying “stop” alone is not an enforced pause. Until then the model can return a fenced block for the user to copy. |
| `toggle_header`, `toggle_bookmark`, `toggle_export`, `toggle_comment` | The exact metadata/UI concepts differ. Some exist partly in Jupyter; numbered bookmarks and Solveit pin/skip semantics are not ours. | Define the Jupyter behavior first, then update the live model. Commenting code is a text edit; nbdev export is an optional workflow. Context inclusion/exclusion must await the separately planned context model. |
| `create_or_run_dialog`, `restart_dialog`, `stop_dialog`, `rm_dialog` | Solveit owns its own notebook/kernel lifecycle routes. | Use authenticated Jupyter Contents/Sessions/Kernel services with explicit target selection. A tool that stops/restarts its own executing kernel must be orchestrated outside that kernel. |
| `display_response` | Returns a special object whose display/result split is interpreted by Solveit. Our tool bridge returns bounded text representations. | A typed result contract for separate user-visible Markdown/HTML versus model-visible data, with frontend rendering support. |
| `setup_share`, `start_share`, `capture_screen`, `capture_tool` | Uses Solveit browser events and returns images through a different tool channel. | A Jupyter browser capture UI, user gesture/permission, image transport, and multimodal provider results. Not a Python-only port. |
| `dialog_link`, `msg_ref` | Generate Solveit routes and DOM anchors. | Generate Jupyter URLs and implement/verify cell targeting. A Markdown link helper is easy; dependable navigation to a live cell needs Jupyter integration. |

Sources: [core](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/core.py), [hash-based message edits](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/exhash.py), [screen capture](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/capture.py).

## 4. Specialized tools and Solveit infrastructure

| Functions/modules | Assessment |
| --- | --- |
| [`tmux.pane`, `panes`, `windows`, `sessions`, their `list_*` helpers](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/tmux.py) | **Portable with environment dependencies**, not tied to notebook cells. They read tmux terminal history and optionally SSH hosts. Useful for developer courses if tmux/SSH are installed; not the same as reading a JupyterLab terminal. Use explicit targets, limits, and carefully constructed subprocess arguments. |
| `tmux.shell_ret`, `set_default_history`, `flatten_dict` | `shell_ret` executes commands locally/remotely; it is a separate capability from terminal history reads. The other two are configuration/formatting helpers and need not be model tools. |
| [`import_string`, `import_gist`](https://github.com/AnswerDotAI/dialoghelper/blob/118fff2cfba024381a693d20a5612aedec54cf5b/dialoghelper/utils.py#L156) | **Technically portable.** They execute imported code, including code fetched from a gist. They are not documentation readers. No need to make them default tools when users can explicitly import packages and register their functions. |
| `add_html`, `add_scr`, `iife`, `add_mod`, `js_run`, `js_eval`, their async variants; `fire_event`, `event_get`, `event_once`, `trigger_now`, `pop_data`; `Channel` | **Solveit browser/transport implementations.** Their htmx events, DOM targets, callback routes, and WebSocket relay do not exist in JupyterLab. Replace with named Jupyter actions/comms if needed. Arbitrary JS evaluation is not required to offer notebook-specific tools. |
| `InputBtn`, `InputForm`, customized `input` | Solveit-specific HTML/input rendering. Build Jupyter dialogs/widgets for a similar interactive form; ordinary Python input and this rich form are different interfaces. |
| `mermaid`, `enable_mermaid` | Their injected HTML/JavaScript assumes Solveit's frontend. Generating a Mermaid fenced block is easy; actual rendering should use a verified Jupyter renderer rather than copying the htmx integration. |
| `solveit_docs` | Fetches Solveit's reference. The useful analogue is a bounded `nbinlineai_docs` helper reading our shipped guide/FAQ, or a general documentation reader. Do not present Solveit instructions as nbinlineai instructions. |
| `spawn_agent` | The Python body deliberately raises; Solveit's server intercepts the tool. An equivalent needs agent context, tool inheritance, provider requests, task lifecycle, and cancellation orchestration in our server. It is not functional through a Python import. |
| `call_endp`, `call_endpa`, `xgeta`, `xposta`, response helpers, `Message`, `Dialog` | Transport/model infrastructure, not a student tool catalog. Replace only the parts needed by an actual Jupyter feature. |
| `solve_auth` | Solveit-hosted sign-in integration. It provides neither Jupyter authentication nor ChatGPT subscription sign-in for nbinlineai. |
| `test_dlg`, `test_nbs`, `solveit_test` | Runs notebooks through Solveit's services and restarts kernels. We already use isolated real kernels plus JupyterLab browser tests; reuse the testing ideas rather than the service-specific runner. |

## 5. Why async and execution need care

Many upstream notebook functions are `async def`; our current tool bridge supports synchronous functions and rejects awaitables. For pure file/network work a synchronous bounded implementation can fit the current kernel dispatcher. A future live-notebook bridge should add an explicit asynchronous dispatch design instead of calling `asyncio.run()` inside an already running Jupyter event loop.

The harder execution case is reentrancy: a tool is executing in the same Python kernel to which a nested “run another cell and wait” request would be sent. Ordinary serialized kernel execution can leave the nested request waiting for the current tool to finish while the current tool waits for the nested request. Resolve that at the server/frontend queue boundary, not by casually introducing another event loop. Likewise, do not make a running tool synchronously await the destruction of its own kernel.

## 6. Recommended choices for the next drop

**My recommendation: a learning bundle with six tools plus the formatter.**

1. The four locally drafted functions: `search_kernel_names`, `list_notebooks`, `find_notebook_cells`, `read_notebook_cell`.
2. A Python inspection tool for a named object's docstring/signature/source, inspired by the imported symbol-inspection tools.
3. A bounded web documentation reader, adapting the reading part of `url2note`.
4. `tools_markdown()` as a non-tool helper; also support explicitly chosen custom functions/names so the same workflow works with student-written tools.

The six tools let the model discover live names, consult other notebook material, inspect the Python API being taught, and read documentation. They work through the current kernel bridge and do not depend on live cell mutation.

**Good optional additions:** a saved notebook outline, ordinary text-file reading/search, structural code search, and function tracing. Tracing is especially valuable for teaching but needs a Python-version/dependency decision. File-writing/shell tools are technically possible; include them only if that autonomous development workflow is wanted.

**A separate later feature:** live cell reading/editing/insertion, code execution requests, and context toggles. These should share a deliberate frontend/server cell interface, based on our [cell/kernel model notes](cell_kernel_model_and_context_selection.md). None is implemented by this proposal.

## 7. Current local draft and limits of verification

The four initial tools, reference formatter, three new teaching notebooks, fixture, docs, and package inclusion rules are drafted. Fifteen focused Python tool/example/reference checks and one isolated real JupyterLab browser check passed; 26 existing frontend unit checks and a production frontend build also passed. The broad release gate and publication have not run for this draft. No API charges were incurred by these checks; the provider was simulated while functions ran in real Python kernels. The user's port 8888 server was not used.

That was the draft state at the time of this comparison. The later approved implementation adds Python inspection and web reading, plus the frontend interface for live cell reads and note insertion. See [bundled tools and interface](bundled_tools.md) for the current design rather than treating the earlier scope recommendation as a release inventory.

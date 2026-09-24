# Fastcore and dialoghelper tool candidates

Research reviewed **2026-09-23**. The pinned upstream analysis below predates the 0.1.11 implementation and is retained as decision history. The current source has a **55-tool** registry; publication status and hashes belong in [release records](releasing.md). This extends the [original dialoghelper catalog](dialoghelper_tool_catalog.md), which is also historical.

## 0.1.11 implementation matrix

| Capability from the survey | Current nbinlineai tools or status |
| --- | --- |
| Fastcore documentation and bounded file edits | `show_doc`, `path_info`, `list_files`, `view_file`, `create_file`, `file_str_replace`, `file_insert_line`, `file_replace_lines` |
| rgapi project and saved-notebook search | `search_files`, `search_notebooks` |
| remold syntax search, preview, rewrite and names | `ast_search`, `ast_rewrite`, `file_ast_replace`, `python_symbols` |
| Static source docs and saved outlines | `source_doc`, `notebook_outline`, `document_outline`, `read_document_section` |
| Batch and checked text replacement | `file_strs_replace`, `view_file_hashes`, `file_replace_checked`; whole-file SHA-256 rather than an arbitrary exhash command language |
| Live API/value/source and skill inspection | `api_names`, `search_docs`, `inspect_value`, `search_value`, `source_files`, `list_skills`, `read_skill` |
| Function trace | `trace_function` invokes a live function with bounded JSON arguments/events; execution effects are real |
| Local subprocess and terminal reading | `run_shell`, `run_python`, `tmux_sessions`, `tmux_read`; 1–20 second process timeout; no sandbox or tmux session creation |
| Targeted web extraction | `read_url_section` with a CSS selector within the public-page fetch bounds |
| Live ordinary-cell search and edits | `find_cells`, `replace_cell`, `cell_str_replace`, `cell_insert_line`, `cell_replace_lines`, `delete_cell`, `move_cell`, `copy_cell`, `split_cell`, `merge_cells`; stable IDs and source/match guards where applicable |
| Deferred | Images/screenshots, new agent lifecycle, enforced interactive pause/resume, service-kernel cell execution control, arbitrary Solveit DOM/events, bulk context collectors, and cross-notebook live editing. These need additional transports or orchestration and are not promised for 0.1.11. |

The rest of this document records the **earlier buildability assessment**, including references to missing tools at that point in time. Use the matrix and [current tools reference](../docs/tools.md) for implemented behavior.

## Non-Rust replacement assessment after the 0.1.11 install report

Reviewed **2026-09-23**. This is an assessment, **not an implemented dependency
change**. The published package still requires rgapi and exhash. Their missing
macOS ARM Python 3.14 wheels caused the source-build delay reproduced in the
[compatibility investigation](jupyter_ai_compatibility.md#matched-python-314-follow-up).

Both packages are Jeremy Howard / Answer.AI projects. Verified public consumers
include [dialoghelper's standard tools](https://github.com/AnswerDotAI/dialoghelper/blob/6b4f4c16532c3f4fbc36281aa0c1d0f3b63c4210/dialoghelper/stdtools.py)
and [llmdojo's startup imports](https://github.com/AnswerDotAI/llmdojo/blob/main/claude/startup.py)
for both packages, plus [ipyai's kernel bridge](https://github.com/AnswerDotAI/ipyai/blob/main/ipyai/kernel_bridge.py)
for exhash. Pyskills' README lists both discoverable skills; this is an integration
example, not evidence that installing pyskills installs either package. The
verified consumers are concentrated in Answer.AI's tooling; this search does not
establish a complete user count or the absence of other users.

| Package | Upstream purpose | What nbinlineai actually uses | Candidate replacement |
| --- | --- | --- | --- |
| [rgapi](https://github.com/AnswerDotAI/rgapi) | Parallel file discovery and text search using ripgrep's Rust libraries; ignore rules, regexes, streaming/async results, and cell-aware notebook searches. | Only `rg` and `nbrg`, behind `search_files` and `search_notebooks`. | Python directory walking, literal/regex matching and JSON notebook reads; [pathspec](https://python-path-specification.readthedocs.io/en/latest/readme.html) for Git-style ignore matching. |
| [exhash](https://github.com/AnswerDotAI/exhash) | Line/hash-addressed edits, previews, notebook edits, and navigable Markdown/code section trees. | Only `open_doc`, outline formatting, `at` and `view`, behind `document_outline` and `read_document_section`. | [markdown-it-py](https://markdown-it-py.readthedocs.io/en/latest/using.html) heading tokens/source-line maps, Python `ast` definition spans, and our own digest-checked section addresses. |

The existing checked-edit tools, `view_file_hashes` and `file_replace_checked`,
already use Python's `hashlib.sha256`; replacing exhash does not require replacing
those editors. Fastcore's documentation and ordinary file editing helpers remain
useful independently.

Replacement must preserve the relevant boundaries, not just the happy-path text:

- Search currently has a 1.5-second deadline, 1 MB file bound, depth/result limits,
  partial-result notices, hidden/ignore filtering and saved notebook cell IDs.
  Python `re` has different syntax/performance from Rust regex. A time check
  between files cannot interrupt one pathological match; retaining a hard bound
  requires process isolation or another bounded matcher. A pathspec wrapper must
  implement nested ignore precedence rather than assume one root pattern list
  duplicates ripgrep.
- Document navigation currently excludes headings inside code fences, retains
  hierarchy and link numbering, and checks copied section addresses for stale
  content. Python `ast` covers Python definitions only. Exhash also outlines
  JavaScript, TypeScript/TSX, Rust, Zig and Swift via tree-sitter; a Markdown/Python
  replacement would need explicit fallback behavior or optional parsers for those
  languages. It is not an equivalent replacement for every exhash API.
- `toolslm.read_md` looked promising in an older pyskills example, but toolslm
  **0.3.48 removed `read_md` and `md_hier` in favor of exhash**. See its
  [pinned changelog](https://github.com/AnswerDotAI/toolslm/blob/67b3d6262535fc12629fca8b82bb455d07563d07/CHANGELOG.md).
  Do not add the current toolslm package expecting those modules to exist.

PyPI metadata checked on this date confirms universal `py3-none-any` wheels for
pathspec **1.1.1**, markdown-it-py **4.2.0**, and its only base dependency mdurl
**0.1.2**. Use the base packages: pathspec's optional re2/hyperscan accelerators
and markdown-it-py's optional comparison extras are unnecessary. These candidate
packages were not installed in the user's course environment or added to the
project lockfile.

Recommendation: implement Python-backed search and Markdown/Python navigation as
the default, retaining native acceleration or additional-language parsing only
as explicit optional features if needed. Keep the public tool names and stale
content checks. This addresses the two source builds without pretending that
the whole dependency graph becomes Rust-free: direct `remold` still pulls in
`ast-grep-py` (and LibCST), which need a separate packaging/optional-feature decision.

## Upstream sources inspected

These are source snapshots, not promises that every dependency is installed in a notebook kernel:

| Repository | Pinned revision | Relevant modules |
| --- | --- | --- |
| [dialoghelper](https://github.com/AnswerDotAI/dialoghelper/tree/6b4f4c16532c3f4fbc36281aa0c1d0f3b63c4210) | `6b4f4c1` | `stdtools.py`, `utils.py`, `core.py`, `tracetools.py` |
| [fastcore](https://github.com/AnswerDotAI/fastcore/tree/0ff44bb5b4b8154390f1e700a8842e15ac8db4c9) | `0ff44bb` | `tools.py`, `docments.py`, `nbio.py`, `xtras.py`, `editskill.py` |
| [toolslm](https://github.com/AnswerDotAI/toolslm/tree/67b3d6262535fc12629fca8b82bb455d07563d07) | `67b3d62` | `inspecttools.py` |
| [rgapi](https://github.com/AnswerDotAI/rgapi/tree/2f0b72405559fd75db1164a6f890b44f9e8c85f1) | `2f0b724` | file discovery, file/notebook text search |
| [exhash](https://github.com/AnswerDotAI/exhash/tree/15995a95c040e56f1121ea48f9519cb1f0f8d51a) | `15995a9` | verified edits and document outlines |
| [remold](https://github.com/AnswerDotAI/remold/tree/bb498ccdf54f8ab3566737d4183a52c98e6c7246) | `bb498cc` | AST/CST search and transformations |
| [tracefunc](https://github.com/AnswerDotAI/tracefunc/tree/23b3398b588f4a947f49de34f452a1c4b1ac3b1a) | `23b3398` | Python 3.12+ execution traces |
| [pyskills](https://github.com/AnswerDotAI/pyskills/tree/e387c74806d6f178bce0e126708e9edcd2a01c80) | `e387c74` | API documentation/search, skill discovery and registration |
| [ipykernel-helper](https://github.com/AnswerDotAI/ipykernel-helper/tree/fc9810227536e7d392ecd984ce12e25d23292dbd) | `fc98102` | IPython inspection, page extraction, display plumbing |
| [aidialog](https://github.com/AnswerDotAI/aidialog/tree/c7bf2bb65503b1cf64aca5893d9c54ff7bbb9128) | `c7bf2bb` | `dlgskill.py`: saved-dialog search, structure, editing and execution |

The repository environment already had fastcore **2.2.30**, through the FastLLM dependency graph. It becomes a direct dependency when our own tools use it. No dialoghelper dependency is needed. Its current `stdtools.py` imports fastcore's file tools, rgapi, exhash, toolslm inspection, and execution helpers from other packages. File editing was present in the original research; it was omitted from our original bundled scope.

## What dialoghelper surfaces, including other packages

The pinned [`stdtools.py`](https://github.com/AnswerDotAI/dialoghelper/blob/6b4f4c16532c3f4fbc36281aa0c1d0f3b63c4210/dialoghelper/stdtools.py) imports `dialoghelper`, `dialoghelper.solveitskill`, `ipykernel_helper`, `fastcore.tools`, `toolslm.inspecttools`, `pyskills`, `rgapi`, and `exhash.skill` with star imports. It also imports `safecmd.bash`, `safepyrun.RunPython`, and `aidialog.dlgskill` as `dsk`. That last module is namespaced, not a star export. Utilities such as `ast_grep`, tracing, and tmux live in additional dialoghelper modules; they are not all imported by `stdtools` itself.

This is a capability-family inventory. Exported classes, low-level helpers and asynchronous variants are not each sensible model tools.

| Provider | Surface beyond our bundled tools | Fit / remaining gap |
| --- | --- | --- |
| `fastcore.tools` | `file_strs_replace`, `file_del_lines`, `file_ast_replace`, `file_edit`; string-only equivalents; `line_hash`, `lnhash`, `lnhash_at` | Batch replacement and structural editing are useful additions. Explicit deletion is already expressible with our `file_replace_lines(..., new_content="")`; hash/diff primitives belong inside wrappers. |
| `toolslm.inspecttools` | `symsrc`, `symtype`, `symval`, `symtype_val`, `symdir`, `symnth`, `symlen`, `symslice`, `symsearch`, `symset`, `importmodule`, `symfiles_folder`, `symfiles_package` | Source/type/value inspection overlaps our tools and `$`. Bounded member discovery, slicing/searching values and source-file discovery are missing. Namespace mutation and importing are separate effects. |
| `pyskills` | `doc`, `xdir`, `docfind`, `list_pyskills`; skill registration, enable/disable/delete and `allow` policies | `doc` overlaps `show_doc`; API-name listing and recursive documentation search are useful missing tools. Discovery reads registered skill descriptions without importing the skills. Discovery does not automatically declare tools through `&` or install their dependencies. `doc` has varargs, so it needs a fixed-signature wrapper. Skill administration and execution permissions are a larger integration. |
| `ipykernel_helper` | `info_md`, `read_url`, `scrape_url`, `get_md`; `transient`, `run_cmd`, `call_tool` and IPython setup | `info_md` overlaps `inspect_python`/`show_doc`. URL fragment/CSS-selector extraction is missing from our simpler URL reader and could be added within its existing fetch limits. `run_cmd` emits display commands: it is not a shell executor. Host display plumbing is not a portable Jupyter UI tool. |
| `rgapi` | `fd`, `ls`, `rg`, `rgstr`, `nbrg`, iterator and async variants | Project search, richer file filters and cross-notebook source search are missing. Use synchronous bounded wrappers; async/iterator APIs are implementation choices, not separate model tools. |
| `exhash.skill` | `lnhashview_file`, `file_exhash`, `lnhashview_cell(s)`, `cell_exhash`, `open_doc`, section/search/link result types | Missing verified-address edits and document section/link navigation. Notebook variants operate on saved files, not the live JupyterLab model. Rich result objects and command tuples need simple schemas and bounded text. |
| `aidialog.dlgskill` (`dsk`) | `summary_dlg`, `view_dlg`, `find_msgs`; `move_msgs`, `split_msg`, `merge_msgs`, cut/copy/paste; symbol/AST predicates; text/hash edits; `%nbrun` | Saved-dialog summaries and search are straightforward. Structural editing is absent; live cell equivalents must use our browser bridge. Its file APIs and held objects do not synchronize open unsaved JupyterLab cells. Execution requires a separate integration. |
| `safecmd` / `safepyrun` | `bash`, `RunPython`; allowed-import and callable policies | No bundled arbitrary shell/Python execution tool. These introduce an execution policy, namespace choice, output limits and cancellation; importing a library does not sandbox our kernel or existing tools. |
| `dialoghelper.core` / `solveitskill` | Rich message search, replace/delete/copy/paste, hash edits, metadata toggles, dialog links, lifecycle commands, cell execution, interactive pause/resume, `spawn_agent`, browser JS/HTML/events, Mermaid | We cover reading/listing and adding Markdown/code, plus URL notes. Editing/navigation can extend the existing browser bridge. Execution, lifecycle and agents need orchestration. Solveit DOM/events and UI helpers are host-specific. |
| Additional dialoghelper modules | `utils.ast_py`, `ast_grep`, `msg_ast_replace`, `ctx_*`, `import_string`, `import_gist`, input forms; `tracetools`; tmux tools | AST and bounded source-context tools are buildable. Current `ctx_*` functions are asynchronous Solveit insertion workflows; their reading portions need ordinary wrappers. Importing code executes it. Tracing needs Python 3.12+, tmux needs its own environment, and forms need Jupyter UI integration. |

`fastcore.nbio` and remold provide further useful building blocks even though `stdtools.py` does not directly star-import them. Pyskills can also discover separately installed skills such as ghapi (GitHub), fastmux (terminals), fastcdp (browser control), and tracefunc; the [upstream pyskills examples](https://github.com/AnswerDotAI/pyskills/tree/e387c74806d6f178bce0e126708e9edcd2a01c80) illustrate this wider ecosystem. A listed skill is not a guarantee that dialoghelper installed it, or that nbinlineai can use its complete interface unchanged.

### Installed versus accessible

The 0.1.11 repository environment has fastcore 2.2.30, rgapi 0.1.30, remold 0.1.1, exhash 0.4.16, and pyskills 0.0.33 as direct dependencies. Dialoghelper, toolslm, tracefunc, ipykernel-helper, safecmd, and safepyrun are not required. This says nothing about a separately selected notebook kernel. Current upstream source can also expose APIs absent from the installed dependency version.

The 55 bundled tools are a convenience registry, not a restriction to those callables. A compatible synchronous function imported into the bound kernel can already be offered by `&`. A missing dependency needs installation in that kernel; incompatible signatures/results need wrappers; Solveit service calls need a Jupyter implementation. These are three different gaps.

## Selected first implementation (historical eight-tool phase)

`nbinlineai/fastcore_tools.py` provides eight ordinary synchronous kernel tools, re-exported and advertised by `nbinlineai.tools`:

| Tool | Underlying capability |
| --- | --- |
| `show_doc(name, module="")` | fastcore `MarkdownRenderer` / docments; live object lookup, or explicit installed-module import and symbol lookup |
| `path_info(path=".")` | cwd and resolved filesystem-path information |
| `list_files(path=".", pattern="*", recursive=False, limit=30)` | bounded file discovery; guarded directory traversal complements fastcore's editing helpers |
| `view_file(path, start_line=1, end_line=40)` | bounded numbered UTF-8 text view |
| `create_file(path, contents)` | create a new text file without overwriting existing content |
| `file_str_replace(path, old_str, new_str, expected_matches=1)` | fastcore literal text replacement with an explicit match-count check |
| `file_insert_line(path, line, new_str)` | line insertion retaining newline style, with fastcore diff/save utilities |
| `file_replace_lines(path, start_line, end_line, new_content)` | fastcore replacement with required explicit line bounds/content |

The wrappers use fastcore's editing/formatting utilities while adapting input/output bounds and filesystem behavior to nbinlineai. The raw fastcore `file_replace_lines(path)` defaults to replacing the entire file with empty text, and `view_file` reads a whole file before slicing. Those defaults are unsuitable for our bundled model tools. Actual bridge probes confirmed the installed raw file functions can be introspected and called; the wrappers are for a clear bounded contract, not a new transport requirement.

### Documentation and imports

There is no public `show_doc` function in installed fastcore 2.2.30. The familiar entry point is in nbdev; fastcore owns `MarkdownRenderer`, `ShowDocRenderer`, `docments`, `DocmentText`, and related machinery. Our `show_doc` returns Markdown text usable by the model and supports rich Markdown display when called directly in Python.

- `show_doc("my_function")`: resolve an existing live kernel name or builtin.
- `show_doc("read_csv", module="pandas")`: import an installed module, then inspect its named symbol.
- `show_doc("", module="json")`: import and document the module itself.

Explicit imports execute module initialization. The tool does not install packages, bind new names into the notebook namespace, or call the documented function. A filesystem path is not a Python module name. Static source-file documentation is a distinct candidate below: it can work without import but cannot reproduce every runtime decorator/delegated signature.

## Other candidates, assessed against our architecture

The following were **proposed at the eight-tool phase**. Most are implemented in 0.1.11 as mapped above. “Kernel wrapper” means the existing synchronous callable route is sufficient; it does not mean an upstream function can be exposed unchanged.

| Candidate and upstream basis | Buildability now | Concrete adaptation |
| --- | --- | --- |
| **AST pattern search**: dialoghelper `ast_py` / `ast_grep`; remold `astfind` | **Kernel wrapper plus optional dependency.** | Search bounded Python source/file excerpts and return match text/locations, not an `SgNode` object. Prefer `ast-grep-py` / remold in-process. The upstream `ast_grep` uses shell interpolation; do not copy that command construction. A project search adds bounded traversal. |
| **AST file rewrite**: fastcore `ast_replace` / `file_ast_replace`, backed by remold `astmap` | **Kernel wrapper plus optional dependency.** | Accept declarative string pattern/replacement pairs, produce a diff, check current file content and apply through the same text-file boundary. No model-supplied Python transform callbacks. Preview/apply can be explicit. |
| **Definition/reference search**: remold `symdefs`, `symrefs` | **Kernel wrapper plus optional dependency.** | Return names bound/read in a source snippet or file; useful for short names that text search finds too broadly. This is syntactic analysis, not full semantic cross-module resolution. |
| **Project text search**: rgapi `rg`, `fd`, `ls`, `nbrg` | **Kernel wrapper plus optional dependency.** | Fixed simple schema, explicit root/glob, deadlines, result/byte caps, compact excerpts and partial-result notices. `nbrg` searches saved notebook source with cell IDs; it does not see open unsaved cells. Current rgapi is a native Python/Rust extension using ripgrep crates, not a required `rg` executable. |
| **Source-file API documentation**: fastcore `extract_docstrings`, token/AST parsing | **Kernel wrapper with installed fastcore/stdlib.** | Parse a `.py` file without importing it; show function/class declarations and docstrings, and add parameter comments where available. Runtime decorators, conditional definitions and delegated signatures require live inspection instead. |
| **API listing and documentation search**: pyskills `xdir`, `docfind`, `doc` | **Kernel wrapper; optional pyskills dependency or reuse existing inspection.** | List a module/class's public API, then search names/docstrings with explicit depth, member and output limits. Resolve from the bound kernel; upstream `docfind` traverses attributes and needs limits before constructing results. |
| **Skill discovery**: pyskills `list_pyskills` | **Read-only kernel wrapper plus optional dependency.** | Return a paged inventory of installed skill entry points and descriptions. Loading instructions, importing functions and declaring tools remain explicit; dynamic tool availability during an active request is not implemented. |
| **Saved-notebook outline/search**: fastcore `summary_nb`, `find_cells`, `Notebook` | **Kernel wrapper with installed fastcore.** | Page the outline, return stable IDs/type/source previews, and preserve our saved-file wording and input caps. Complements existing per-notebook search/read tools. Never describe an in-memory `Notebook` object as the live JupyterLab document. |
| **Richer object inspection**: toolslm `symdir`, `symlen`, `symslice`, `symnth`, `symsearch`, `symsrc` | **Kernel wrapper.** | Bind lookup to this kernel, return bounded selected values/attributes, avoid upstream caller-frame assumptions and `_last` globals. Custom indexing/length/representation methods can execute Python; define supported object types and semantics. Existing `$`, `search_kernel_names`, `inspect_python`, and `show_doc` already cover part of this. |
| **Project/source context collectors**: dialoghelper `ctx_folder`, `ctx_repo`, `ctx_symfile`, `ctx_symfolder`, `ctx_sympkg`; toolslm `symfiles_folder`, `symfiles_package` | **Kernel wrapper for reading; existing insertion bridge for notes.** | Current upstream `ctx_*` functions are asynchronous Solveit workflows, not directly callable through our synchronous bridge. Build a file/symbol index and page selected excerpts. Whole-repository dumps do not fit the 4,000-character result cap or 64,000-character shared budget. Insert selected Markdown only through the existing acknowledged browser operation. |
| **Verified file edits**: exhash `file_exhash`, `lnhashview_file` | **Kernel wrapper plus optional dependency.** | Flatten varargs/tuple command structures into supported validated parameters. Hashes check addressed content; they do not provide notebook synchronization or a filesystem sandbox. Current hashes are two Base64url characters, changed from older four-hex examples: pin compatible versions if used. |
| **Document outlines / section reads**: exhash `open_doc` | **Kernel wrapper plus optional dependency.** | Return paged heading/code-section addresses and text. Keep local-file and remote-fetch policies explicit; do not bypass our bounded URL reader merely because the upstream API also accepts URLs. |
| **Live-cell replace/delete/AST rewrite**: dialoghelper `update_msg`, `msg_str_replace`, `msg_ast_replace`, `del_msgs` | **Buildable by extending our existing browser action bridge.** | Add allowlisted operations with stable IDs, expected source/hash checks, shared-model transactions, and preserved AI links/metadata. No third transport is necessary. File editors and fastcore `cell_*` saved-notebook editors cannot perform this job. |
| **Function execution traces**: dialoghelper `tracetool` / `fmt_trace`, tracefunc | **Conditional kernel feature.** | At assessment time nbinlineai advertised Python 3.11 while upstream tracing required 3.12+. We implemented scoped standard-library tracing. The final 0.1.11 release also corrects the package minimum to 3.12 because aidialog uses 3.12 syntax; see the release record. It executes the function and can repeat its effects. Bound snapshots/calls/values; return a teaching-sized trace. |
| **Model-driven cell execution**: dialoghelper `run_msg`, `run_and_prompt` | **Additional execution orchestration required.** | Respect our notebook queue, Keep, cancellation, error stops and outputs. A synchronous tool cannot enqueue work on its own busy kernel and block waiting for it. Use server/browser orchestration with an explicit lifecycle. |
| **Images/screenshots, interactive pause/resume, subagents** | **New result/lifecycle work.** | Current tool results are bounded text and the browser protocol is named document operations. These need image transport, enforced pause/resume, or agent lifecycle/context management respectively. |

The project search, AST/source outlines, AST file rewrite, live-cell editing, and bounded tracing work described above are implemented in the 0.1.11 source. Remaining candidates are explicitly marked deferred in the current matrix.

## Useful fastcore building blocks that need not be model tools

`atomic_save` and `str_diff` belong inside file editors. `docments`, `sig2str`, and `extract_docstrings` power documentation tools. `frontmatter` and `fenced_blocks` can help document extraction when a real task needs it. General `L`/collection helpers, decorators, context managers, assertion utilities, `run`, and `shell` should not all become model tools merely because they are public functions. The model-facing set should expose a useful task and a compact contract.

## Integration boundaries

Ordinary tool signatures must have keyword-capable named parameters. The bridge rejects positional-only parameters, `*args`, `**kwargs`, and awaitables; it supports simple JSON schemas and shallow array items. Each serialized call argument object is capped at 16,000 characters, each result at 4,000, and tool calls have a 30-second dispatcher wait. The wrapper bounds must operate before expensive reads, traversal, mutation, or huge result construction, not only after repr truncation.

All ordinary file tools run on the **bound kernel's machine and cwd**, which can differ from the Jupyter server and notebook path. Existing notebooks continue to use the live frontend model for edits. Adding a registry entry advertises a tool to the helper; actual model availability still requires an imported callable and an enabled Markdown declaration. Keep skips completed tool runs; cancellation does not roll back completed filesystem changes.

# Developer handoff

Reviewed **2026-09-23**. Latest published package: **0.1.12**, source commit `68ef13a364565c82ae7d324ecd952478d372f23a`, tag `v0.1.12`; source and tag are pushed. The release retains **51 opt-in tools in eight groups**, removing `ast_search`, `ast_rewrite`, `file_ast_replace`, and `python_symbols`. `search_files` and `search_notebooks` now use a deadline-bounded separate Python process and `pathspec`; `document_outline` and `read_document_section` use `markdown-it-py` and standard-library AST for Markdown/Python with SHA-256-bound section tokens. Mandatory `rgapi`, `exhash`, and `remold` dependencies are removed, including their now-unused transitive AST packages. Fastcore documentation, checked text edits, fifteen browser tools, live notebook behavior, and execution tools remain. Minimum Python remains **3.12**. Final artifacts, public PyPI downloads, installation from PyPI and live GitHub Pages are verified. See [releasing](releasing.md) for tests, hashes and the Extension Manager upgrade check, and [the tool inventory](fastcore_tool_candidates.md).

The user's course environment and JupyterLab on 8888 must remain untouched. The 0.1.11 investigation reproduced Python 3.14 native builds for rgapi/exhash; the new dependency graph avoids those builds. The actual 0.1.10-to-0.1.12 Extension Manager upgrade passed in 3.803 seconds, but browser-open shutdown probes later exposed a surviving idle AnyIO worker while the main thread waited in threading._shutdown. Its originating component is not yet established; do not claim a JupyterLab deadlock was fixed. A short readonly-manager check passed, but a matched 45-second browser-open test reproduced the same thread wait in readonly mode; do not recommend it as a shutdown fix. A core-only control exited normally, while disabling only MCP in the fuller setup still reproduced the wait; the remaining extension/dependency interaction is unidentified. Weekly wheel monitoring is already active as the thread heartbeat `check-python-3-14-native-wheels` (Mondays 09:00 America/New_York); do not duplicate it.

## Product and environment

- Public repo: https://github.com/rahuldave/nbinlineai; website: https://rahuldave.com/nbinlineai/; PyPI package: `nbinlineai`.
- GPL-3.0-only, matching ai-jup. Runtime Python >=3.12; development uses Python 3.12, uv, JupyterLab >=4.2,<5, Node 22.12+ or 20.19+.
- A prebuilt Python wheel contains frontend assets and the auto-enabled Jupyter Server extension. Students install through JupyterLab's PyPI Extension Manager or their environment's uv/pip. Restart the **whole server** after installation/update, then refresh the page. Reloading only the frontend can leave new server routes unavailable.
- API backends: OpenAI and Anthropic via pinned `python-fastllm==0.0.63`. A native inline ChatGPT subscription/Codex backend remains research only. A separate Jupyter AI Codex ACP chat route was successfully exercised; see the [worked-example run](codex_acp_example_run.md). Never treat a subscription as an API key or assume agent login configures inline requests.
- Students supply their own keys through Configure AI. Private per-user JSON is under `$XDG_CONFIG_HOME/nbinlineai/credentials.json`, or `~/.config/nbinlineai/credentials.json` on macOS/Linux when XDG is absent; Windows falls back to APPDATA. Server environment keys and development `.env` are supported. The browser gets availability, not saved key values. Inspect storage behavior through `credentials.py` and tests, not by printing real credentials.
- Server and selected kernel can use different environments. Bundled imports require installation in the kernel environment too. Custom ordinary functions still work without nbinlineai installed there. `insert_tools` additionally needs `comm>=0.2,<1` and `ipykernel>=6.18` in that kernel.

## Shipped behavior to retain

Questions/answers are editable Markdown with AI metadata, not new nbformat types. Notebook defaults contain provider/model/style/effort/Keep/Context; prompt overrides inherit unless set. Compact, Full, Learning have editable user instructions. Learning asks tutor questions and limits suggested code. Rendered code fences have Copy controls.

Keep is on by default, inherits from notebook defaults, and skips completed protected requests/tools. Native Run All and Shift+Enter are integrated through the public cell executor and a per-notebook queue. Editing an answer changes its later history text; it does not rerun downstream protected answers or restore kernel state. Errors/cancel stop the current batch, and completed effects cannot be rolled back.

0.1.7 discovers `&` tool declarations in the current question plus **all earlier ordinary Markdown and AI questions**, independently of prose trimming. Tools are resolved from the live kernel per run; code/raw/answers/outputs and later cells do not declare tools. Only `$` in the current question resolves variables. The combined distinct reference cap is 20.

The shared budget is 64,000 serialized Unicode characters, including tool schemas, fixed instructions, expanded question and tool messages. It takes nearest earlier eligible source/pairs first, may retain a boundary source suffix, never splits a history pair, and re-budgets before each provider round without repeating tools. See [the exact algorithm](cell_kernel_model_and_context_selection.md). Version 0.1.8 also supports explicit modes and labeled below/independent AI source; reports include selected/included/omitted/partial IDs and reasons. The authoritative preview uses the same selector before the first provider round.

## Source map

| Responsibility | Files |
| --- | --- |
| Plugin, commands, cell executor, notebook header, AI decorations, run lifecycle | `src/index.ts` (large; prefer small extracted modules for new logic) |
| Ordered model snapshot and context modes | `src/context.ts` |
| Context controls, saved Custom choices and preview lifecycle | `src/contextControls.ts` |
| Settings/defaults, Keep precedence, model/provider/style choices | `src/defaults.ts`, `keepAnswer.ts`, `providerChoice.ts`, `modelChoice.ts`, `promptMode.ts`, `schema/plugin.json` |
| Per-notebook execution order and batch failure/cancel | `src/executionQueue.ts` |
| SSE ordering and visible context reports | `src/sse.ts`, `src/contextStatus.ts` |
| Model-tool browser operations | `src/frontendActions.ts`, `nbinlineai/frontend_bridge.py`, `nbinlineai/handlers.py` |
| Python helper browser insertion | `src/insertTools.ts`, `src/insertToolsProtocol.ts`, `nbinlineai/kernel_insert_tools.py` |
| Request validation, reference discovery, tool loop | `nbinlineai/prompt.py` |
| Candidate selection and character accounting | `nbinlineai/context_selection.py`, `nbinlineai/context_budget.py` |
| Question focus, positional landmarks and budget-aware target availability | `nbinlineai/prompt_focus.py` |
| Live namespace introspection and callable execution | `nbinlineai/kernel.py` |
| Flat FastLLM schema translation, API request | `nbinlineai/tool_schema.py`, `nbinlineai/providers.py` |
| Tool registry/formatting, bounded web reads | `nbinlineai/tools.py`, `nbinlineai/web_tools.py` |
| Fastcore documentation/filesystem tools; shared bounds/name lookup | `nbinlineai/fastcore_tools.py`, `nbinlineai/_tool_helpers.py` |
| Project search, static sections and verified file edits | `nbinlineai/source_tools.py`, `nbinlineai/_search.py`, `nbinlineai/_search_worker.py`, `nbinlineai/_documents.py` |
| API/value inspection, skill discovery and execution tracing | `nbinlineai/inspection_tools.py` |
| Live notebook edit signatures and shared-model operations | `nbinlineai/notebook_tools.py`, `src/frontendCellEdits.ts` |
| Separate subprocess execution and local tmux reads | `nbinlineai/execution_tools.py` |
| Authenticated routes, session/kernel binding, safe errors | `nbinlineai/handlers.py`, `nbinlineai/__init__.py` |
| Private keys and server/model configuration | `nbinlineai/credentials.py`, `nbinlineai/config.py` |

Paths in the table are repository-relative. No separate background application server is needed for API mode: Jupyter Server awaits provider calls, Python kernel executes live functions, and JupyterLab owns live documents. Normal kernel dispatch is already asynchronous; do not introduce `asyncio.run`, blocking comm waits, or same-kernel reentrant execution.

## Protocol quick reference

Read [bundled_tools.md](bundled_tools.md) before changing either transport:

1. **Model tools:** authenticated POST `nbinlineai/prompt` opens SSE. An ephemeral server run ID binds session/prompt/kernel; `frontend_action` has a per-action request ID and allowlisted arguments. The originating browser performs a live-model operation and POSTs `nbinlineai/action-reply`. The server awaits an authenticated, bound acknowledgement before continuing the provider loop. 45-second action timeout, one pending action/run, at most 64 runs, 8,000-character insert, 4,000-character reply, 500-character error. Request handlers use Jupyter base URL and authentication/XSRF/execute authorization.
2. **Direct Python `insert_tools`:** one-shot `nbinlineai.insert_tools.v1` comm carries generated Markdown, code-cell ID and actual execute-request ID. Browser tracking binds the request to the original panel/model/kernel and parent message ID. A mutable `InsertToolsReceipt` reports requested/inserted/error asynchronously; timeout is 30 seconds. The native execution scheduling hook handles a kernel starting on the first run. Multiple calls preserve insertion order; saved output is never replayed as an action.

Neither transport saves files. Browser focus is never a target identifier. Duplicate delivery is suppressed within a run/request; this is not durable idempotency across retries. A mutation can happen before its acknowledgement is lost: inspect the notebook before repeating a failed insertion. Cancel does not undo existing notes or Python effects.

## Local development and test workflow

Bootstrap is in [Development](../docs/development.md). The current checkout has `.venv` and `node_modules`; a fresh task should check rather than assume them. Never use the user's server on 8888. The deterministic Playwright harness owns 8897 and uses a real kernel with temporary notebooks/configuration/fake credentials.

```bash
uv run --no-sync pytest
uv run --no-sync ruff check nbinlineai tests scripts
uv run --no-sync jlpm test:unit
uv run --no-sync jlpm build:prod
uv run --no-sync jupyter-builder develop . --overwrite
uv run --no-sync jlpm test:e2e
```

Focused browser example: `uv run --no-sync jlpm playwright test tests/e2e/inherited-tools.spec.ts`. Install Chromium using `uv run --no-sync jlpm playwright install chromium` if missing. The default suite makes no paid API requests; `NBINLINEAI_E2E_LIVE=1` explicitly opts into live checks. The fake provider lives only in `tests/support/e2e_server.py`, not runtime code.

Version 0.1.8 evidence: **140 Python tests, 44 frontend unit tests, an uninterrupted 57/57 browser run**, plus production build, lint, examples in real kernels, archive checks and clean installation. Later patch checks are recorded below and in the release record; do not imply unchanged backend tests were rerun for a frontend-only patch.

Known practical pitfalls:

- Rebuild and relink after frontend changes; otherwise tests may exercise an old prebuilt bundle. Do not run `uv build` concurrently with browser checks because the build hook rebuilds those assets.
- Browser tests share one temporary settings store. Reset custom style/settings dependencies in each test; avoid order-dependent assumptions.
- Shift+Enter can append/move focus to a blank cell; avoid a shifting `.last()` locator. Use stable IDs or deliberately fixed fixture positions.
- An AI answer fixture requires `isOutputCell`, a linked `promptCellId`, and appropriate status. Markdown text alone does not make an answer.
- After cancellation, wait for final `Cancelled` plus disabled Cancel before retrying; `Cancelling…` is not completion.
- Notebook virtualization makes rendered DOM an incomplete inventory. Derive selection from `model.cells`, and attach controls only to live widgets with disposal/reattachment support.
- Context preview introspection itself makes the kernel busy briefly. Do not invalidate and automatically re-preview on every busy/idle transition; that creates a request loop. Restart/dead/kernel replacement invalidate estimates; Details → Check context handles changed live values.
- Keep cell-control geometry stable before the first AI question is selected. Showing a previously hidden Context row during Run's pointer-down can move the button before pointer-up and swallow the click. Cover direct first-click execution while a code cell is busy.
- In 0.1.9, editing a Markdown cell can trigger JupyterLab's notebook mouse-down handler to switch back to command mode and render that cell before mouse-up. The resulting vertical shift can lose the first click on a later AI action button in WebKit. The frontend prevents primary mouse-down on its AI action buttons, using JupyterLab's `defaultPrevented` guard; keyboard activation and select inputs remain native. The focused WebKit geometry/reload and lower-cell Context/Tools/Keep first-click checks passed; Chromium equivalents passed. The earlier full Chromium run was 58/59 before its test interaction was corrected, so do not describe it as an uninterrupted all-pass run.
- AI Prompt insertion activates a blank Markdown cell before tagging it as an AI question. Notify the context controller after tagging so the new active question becomes the preview target, including immediately after a checkbox interaction.
- Browser request assertions must use the versioned `notebook_cells` snapshot. `preceding_cells` is supported only for legacy clients.
- JupyterLab itself may normalize native notebook metadata on first load. Read-only preview tests should compare AI metadata and saved contents, then test dirty state after native initialization settles.
- `insert_tools` is intentionally skipped only in the explicitly tagged optional headless example cell; all example tool declarations are validated against real imports/definitions.
- Screenshot helper: `tests/support/capture_docs.mjs`. Use isolated fake-provider examples; captions identify simulations. Do not capture personal data/keys. README has a two-image limit.
- Since 0.1.9, target caption, check button and check status live inside **Details**, not beside the mode selector. Browser tests must expand Details before interacting with them. Native disclosure markers differ across browsers; keep both standard and WebKit marker suppression when drawing the custom triangle.

## Release/docs workflow and deferred work

Keep versions aligned in `pyproject.toml`, `package.json`, `nbinlineai/__init__.py`, lockfiles and rebuilt extension metadata. Use a separate artifact directory per version; strict Twine, archive/credential checks, fresh wheel installation, both extension discovery checks, and public hashes are documented in [releasing](releasing.md). Do not modify immutable uploaded releases. Generated `lib/`, `dist/`, and prebuilt assets are ignored; build them, do not hand-edit them.

GitHub Pages builds `main:/docs` with Jekyll Minimal and the project's existing `rahuldave.com` domain. Source Markdown and images also ship in the Python package; `internal_docs/` does not. Public docs must clearly distinguish published-release behavior from unreleased source features. A documentation-only handoff does not need a new PyPI version.

Deferred: exact model-token capacity and output/reasoning reserves, richer outputs/images, model-driven execution of live notebook cells, durable action replay, other-notebook live operations, and ChatGPT subscription login. The 0.1.11 source adds ordinary live-cell edit/delete tools and separate subprocess execution. See the research index; do not interpret historical proposals as existing APIs.

## Context selection in version 0.1.8

Seven Context modes and cell inclusion controls are implemented. The target question stays in transient panel state; execution snapshots its own stable prompt ID at its queued turn. Custom mode persists the notebook policy and per-cell text choices in shared metadata without overwriting unrelated keys. Default checks come from the shared backend preview; explicit-mode checks represent candidates with separate partial/omitted feedback.

New requests send versioned full ordered snapshots; legacy preceding-only requests remain supported. Authenticated context preview needs an existing idle kernel and no API key. It returns first-round IDs and accounting without provider calls, offered tool calls or document mutation. All modes preserve fixed-material-first character budgeting and per-round tool-group retention. Both existing mutation transports remain unchanged.

Following the user's implementation-time refinement, declaring ordinary Markdown/AI question cells have separate saved Tools toggles (`toolsInclude`, default true). The seventh Context mode, Current question only, excludes optional source while retaining these choices. Duplicate enabled declarations still offer a tool. Below declarations never register merely through text selection.

The illustrated user guide, FAQ, architecture and `examples/context-selection.ipynb` document the 0.1.8 behavior. Packaging and publication are tracked separately in [releasing](releasing.md).

Verification on 2026-09-23:

- **140 Python tests**, Ruff, and **44 frontend unit tests** passed. Production assets were rebuilt and relinked before browser checks.
- The final uninterrupted isolated JupyterLab run passed **57/57 browser tests** in 5.2 minutes, with a real Python kernel and deterministic provider. Coverage includes all seven modes, saved text/tool choices, preview/run parity, stale responses, below-question AI source, active targets and new question insertion, first-click Run while Python is busy, answer editing, native Run All, Keep, both insertion protocols, and save/reload.
- The capture helper refreshed eleven guide screenshots, including new `context-selection.png` and `context-details.png`; tool browser tests refreshed their own illustrations. The compact controls, expanded explanations and example were visually reviewed. Local documentation/image links resolve.
- `uv build --out-dir dist/context-selection-check`, strict Twine, archive checks and a credential-pattern scan passed. The source archive has 126 files and the wheel 62. A disposable uv environment with JupyterLab 4.6.4 installed the checked wheel, found both extensions enabled/OK, imported all seven modes, and contained the new example and illustrations.

All owned test/capture servers were stopped. Port 8888 was untouched, and no paid provider call was made. These results are the original **pre-bump source verification**, run while version metadata still read 0.1.7. The 0.1.8 release packaging and publication are separate gates; this test record does not itself confirm a PyPI upload.

## Context controls in version 0.1.9

This patch changes presentation and check feedback, preserving selection and execution semantics. The collapsed row contains only Context mode and Details. Details contains the transient target caption, optional Check context action, help and report. The target comes from clicking an AI question or linked answer; it is not a separate toolbar choice. Before any target exists, cell Context controls remain disabled but no longer repeat an instruction beside every cell. The single instruction inside Details reads from live cell metadata so it distinguishes an existing question from a notebook with none.

Per-cell controls now render above their owning cell's source or rendered content, aligned with the editor/text, including an AI answer's Context control. Answers do not have a Tools switch. An AI question's Run/Cancel/Keep/Override row follows its Context line, both above its question text. The targeted question displays **Current question · always included** as plain text instead of an empty Context checkbox. This fixes the visual ownership ambiguity from 0.1.8's bottom-placed controls. When testing widget reuse or virtualization, assert a control stays with its model ID rather than the nearest visible source below it.

Check context displays Checking while pending, then current-generation included-cell/tool counts and a transient last-checked time. Same-count checks still visibly complete. Busy, failed, invalidated and stale replies cannot show a successful check or leave an old success timestamp. The live status is polite and atomic; it does not write notebook metadata. Running an AI question continues to inspect fresh state without requiring a manual check. Do not auto-check on every kernel busy/idle transition.

The summary has one custom triangle, with both native standard and WebKit markers suppressed. The browser regression covers collapsed/expanded visibility, no repeated cell instruction, delayed-check feedback, same-count rechecks, and a failed check after success. The final verification and publication record is in [releasing](releasing.md).

## Version 0.1.10 implementation

This section describes the current source; consult the release record for its publication status.

- **Appearance:** AI questions have a blue outer tint/border and answers a green one, using theme variables in Light and Dark. Editors and fenced-code backgrounds retain native Jupyter styling. The controls stay above their own cell's text. A later rule preserves the tint when Jupyter marks the cell active/selected.
- **Editable starters:** four buttons appear only when the question source is empty/whitespace: Explain cell above, Explain code above, Explain section above, Write code. Clicking inserts ordinary editable source, activates that exact question by stable ID, and focuses the cursor at its end. Displaying the buttons does not dirty the notebook or submit a request; buttons hide when text exists. Preserve the mousedown guard for first-click behavior after editing earlier Markdown.
- **Intent:** shared instructions distinguish the latest question's target from wider background. `prompt_focus.py` maps the immediate predecessor, nearest code/ordinary Markdown, and nearest preceding ATX heading cell from the ordered snapshot. Section is heading-cell through question predecessor, not a new context mode. Setext headings are not recognized. Landmarks contain IDs/types/positions and selected FULL/PART/OMIT/EXCL status, never excluded source or heading text. Fixed-width serialization keeps their budget cost constant through later tool rounds; history-pair landmarks identify the selected exchange and role without changing raw history. Preview and execution share the same builder. These instructions guide a model; they do not guarantee interpretation or override user context exclusions.
- **Code insertion:** `insert_code` is the eleventh bundled tool and fifth browser-handled stub. It uses the existing SSE action/reply protocol, optional stable anchor and shared mixed Markdown/code insertion tail. It inserts ordinary code with empty outputs/null execution count and no AI metadata. The browser rejects an `execute` argument. Code inserted during a native Run All is outside that batch; a later Run All can execute it. Direct Python calls raise the same explanatory stub error as `insert_markdown`. Aliases are recognized by callable identity. Learning guidance applies its snippet limit to inserted content too.
- **Coexistence/examples:** read the pinned [Jupyter AI investigation](jupyter_ai_compatibility.md) and [actual Codex ACP run](codex_acp_example_run.md). Default Jupyter AI Run Cell executes explicit code directly and is a no-op for Markdown AI questions; its Run All uses the native path. The new pollinator and Codex revenue notebooks demonstrate agent chat plus inline tutoring. They are unrun templates; the Codex draft intentionally fails its diagnostic until repaired. All ten example notebook files (including the data fixture) are covered by headless checks, with only the established UI helper cell skipped.

Browser tests now include `question-starters.spec.ts` (empty display, first click, editing, keyboard/undo, persistence) and `theme-colors.spec.ts` (Light/Dark tint, text readability, native editors, Copy and top-control geometry). `frontend-actions.spec.ts` covers inserted code through real Jupyter and save/reload, including the current Run All non-execution guarantee. The screenshot helper also captures a starter row and an illustrative unexecuted code draft; captions distinguish illustrative fixtures from actual provider runs. See the release record for exact pass counts and any corrected harness failures.

## Historical first fastcore tools and documentation split

Source work on **2026-09-23**, after 0.1.10; **PyPI is unchanged**.

- `nbinlineai/fastcore_tools.py` adds eight synchronous kernel tools: `show_doc`, `path_info`, `list_files`, `view_file`, `create_file`, `file_str_replace`, `file_insert_line`, and `file_replace_lines`. `tools.py` re-exports them and includes them in the nineteen-tool source registry. The default declaration helper now lists nineteen; the existing twenty-distinct-tool/variable cap still applies, so docs recommend selecting needed tools. No browser protocol changed.
- `show_doc(name, module="")` uses fastcore's `MarkdownRenderer` for comments/NumPy-style parameter documentation. Its returned string is bounded Markdown and supports the same rich Markdown for direct notebook display. Existing live names need no new import; an explicit installed-module name imports in the kernel, with empty `name` showing module docs. Imports execute initialization; the documented function is not called. A no-import source-file documentation tool remains proposed.
- Generic files use kernel cwd/absolute paths, bounded UTF-8 reads, a capped directory walk, no-clobber creation and explicit edits. Mutations reject supplied/resolved `.ipynb` paths. Match/range validation precedes writes; edits preserve permissions and use a staged file plus `os.replace`, with a stat-change check before staging. This is not a lock or atomic compare-and-swap against another writer. Existing live notebook cells still belong to JupyterLab.
- Shared `_bounded`, `_text`, `_limit` and static live-name resolution moved unchanged to `_tool_helpers.py`, avoiding a registry/module import cycle. Fastcore is now a direct `>=2.2.30,<3` dependency; the lock retains installed 2.2.30. No dialoghelper, remold, rgapi, exhash, or nbdev dependency was added.
- Public docs now separate [Tools reference](../docs/tools.md) from [Examples](../docs/examples.md), with updated page navigation and crosslinks. The reference contains the available-tool contracts plus a clearly proposed candidate table. [Pinned research](fastcore_tool_candidates.md) resurfaces AST search/rewrite, project search, source/API outlines, richer inspection, tracing and live-cell integration. `examples/fastcore-tools.ipynb` demonstrates both documentation styles and a disposable text-file workspace, without stored outputs or keys.

Verification:

- **171 Python tests passed**, including fourteen new focused tool tests, actual isolated-kernel schemas/calls, and all eleven example notebook files. Ruff, TypeScript checking, `uv lock --check`, and `git diff --check` passed.
- **45 frontend unit tests passed**. There are no frontend runtime source changes, so no asset rebuild/relink was needed for this work.
- **Seven inherited-tool browser regressions passed** on the isolated 8897 harness. The new fastcore test passed separately after correcting two test-harness mistakes: waiting for notebook/kernel readiness before setup, and exercising Keep with native Shift+Enter instead of clicking its correctly disabled Run button. It verifies actual kernel file effects, inherited schemas, rich rendered docs both directly and through the deterministic provider, and no repeat request/effects under Keep. This is eight passing focused tests across runs, not an uninterrupted full-suite browser run.
- Public local documentation links/anchors were checked. The existing inherited-tools screenshot regenerated during regression testing was restored; no new illustration was claimed. Owned browser servers shut down, port 8888 was untouched, and no paid provider call occurred.

Release work remains: choose/bump the next version, rebuild/check wheel and source archive, clean-install verification, PyPI publication, pushed source/tag, and verification of public artifacts/site. No commit, source push, package upload, or site deployment was performed in this implementation task.

Follow-up inventory: the fastcore candidate research now distinguishes every direct provider in dialoghelper's pinned `stdtools.py`, additional dialoghelper modules, and the wider discoverable skill ecosystem. Newly surfaced candidates include pyskills API listing/documentation search and skill discovery, ipykernel-helper selector-based page extraction, batch replacement, and aidialog move/split/merge operations. These remain proposals. The repository environment imports nbinlineai through an editable source install; its installed distribution metadata still reports 0.1.0, so metadata alone is not a reliable indication of the source being imported here. The new Python module is importable without reinstalling in this environment. Already-running kernels may cache old imports, and separately installed notebook kernels need their own update. No user kernel or server was restarted or reinstalled during this check.

## Version 0.1.11 tool collection

The user subsequently requested implementation and a full release, superseding the implementation-only stopping point above. The current registry contains **55 tools**, including **15 browser-dispatched functions**. Public tools reference and examples are separate pages. Version metadata is 0.1.11; publication evidence belongs in the release record.

- Tool groups: `starter` (the previous nineteen source tools), `files`, `code`, `inspect`, `notebook`, `saved_notebooks`, `web`, and `execution`. `tool_catalog()` is a declaration-free setup reference. `tools_markdown(group=...)` and `insert_tools(group=...)` select one group; explicit `names` remain supported. Helpers reject more than twenty selected names rather than generating an unusable declaration. This is our own combined tool/variable-reference guard, not a provider-imposed limit. The separate 64,000-character estimate remains.
- Source tools use bounded rgapi search, remold/ast-grep Python syntax search and rewrite, static AST/token documentation without imports, saved-notebook outlines, exhash document sections, validated batch replacements and whole-file SHA-256 checked edits. Filesystem searches default to the kernel cwd and descendants; explicit paths may point elsewhere. This is not a sandbox or a promise that cwd equals the notebook folder.
- Live tools search, replace, insert/range-edit, delete, move, copy, split and merge ordinary cells through the existing authenticated action bridge. AI question/answer cells are protected. Structural edits retain stable IDs when appropriate, preserve metadata/Markdown attachments and reject incompatible merge fields before mutation. Edited code clears stale execution counts/outputs. Copies and split-off cells get new IDs and no results. No operation executes or saves a cell.
- Inspection adds static public API listings, bounded documentation search and common-container slices/search, source-file discovery, and static installed pyskill discovery/instructions. Explicit `module=` imports execute module initialization; source docs and skill descriptions do not import their targets. Tracing uses scoped standard-library tracing on supported Python 3.12+, calls the selected function once, bounds recorded events and restores the previous trace hook. It is execution, not a static read or a hard timeout.
- `run_python` and `run_shell` execute separate processes with explicit working directories, a 1–20 second timeout and 64 KB output capture limit; the final model response remains 4,000 characters. Python uses the kernel interpreter but does not share its live namespace. These run with the kernel user's permissions and are not a sandbox. Local tmux inventory/read tools require tmux and do not address JupyterLab's terminal service.
- `read_url_section` adds CSS-selector or fragment extraction within the existing bounded public-URL fetch. Ordinary `read_url` and URL notes retain their whole-page behavior.
- New direct dependencies are fastcore, rgapi, remold, exhash, pyskills and Beautiful Soup. No dialoghelper/Solveit runtime is imported. Existing notebooks still discover declarations before context trimming; current `&` references and the shared-model/kernel distinction are unchanged.

The full 0.1.11 release changes both Python and frontend assets: installed users need an upgrade in the server and selected kernel environments as appropriate, then a whole JupyterLab server restart/page refresh and fresh kernel imports. The earlier Python-only editable-install observation does not replace that release-upgrade instruction. Port 8888 must remain untouched by automation.

Release verification: **207 Python tests**, **49 frontend unit tests**, and **67 distinct Chromium scenarios** passed across the full browser run and focused reruns. The final live-edit rerun passed 3/3 after fixing the move acknowledgement and test rendering assumptions. Strict artifact checks, a fresh Python 3.12 wheel install, both extension discoveries, an isolated installed-package quickstart UI check, and reinstalling 0.1.11 from public PyPI passed. The two public downloads match local SHA-256 hashes. GitHub Pages run `35917740174` succeeded and live Tools/Examples pages contain the new release. Owned servers are stopped; port 8888 was untouched. Installed users must upgrade and restart their whole JupyterLab server and selected kernels as described above.

## Follow-up: reported Extension Manager update hang

A 2026-09-23 report described the PyPI manager's animated blue bar and a stalled
Discover catalogue during the 0.1.10→0.1.11 update. Actual isolated upgrade and
post-restart coexistence with Jupyter AI 3.2.0 passed, as did initial SIGINT checks
with/without Jupyter AI and while catalogue requests were pending. The actual
course environment was subsequently identified as Python **3.14.0**, launched
with `uv run jupyter lab .`. A disposable clone of its 183 published package
versions exposed the new **rgapi/exhash Rust source builds**: neither dependency
had a macOS ARM CPython 3.14 wheel. Pip installation succeeded in **106.9 seconds**;
the installed tool smoke and dependency compatibility checks passed. A second
matched environment's real UI upgrade succeeded in **3.891 seconds** after those
wheels were cached. This establishes a hidden first-install delay introduced by
0.1.11. A controlled 14-second installer wait reproduced delayed process exit
after two accepted terminal Ctrl-C presses; the HTTP server remained responsive
before shutdown. This demonstrates an executor shutdown delay, not proof of the
reported native-build freeze. The exact user Ctrl-C failure remains unconfirmed. Read
[the detailed evidence and limitations](jupyter_ai_compatibility.md#0111-extension-manager-update-investigation).
The user authorized read-only inspection of home/Jupyter configuration and
explicitly prohibited removing anything. Preserve that constraint; no personal
configuration, package environment or notebook was changed. Do not remove the
nbdev save hooks or clear caches speculatively. User port 8888 remains off limits.

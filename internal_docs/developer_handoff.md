# Developer handoff

Reviewed **2026-09-23**. Latest published package: **0.1.8**, source commit `9f1aa11b813bf7a343cf5b9c2214e8dab0950c2b`, tag `v0.1.8`. This release adds [context selection](context_selection_next_feature.md); the final wheel/source checks, clean installation and public PyPI hashes have been verified. See [releasing](releasing.md) for hashes and verification, and the 0.1.8 implementation and source-verification section below.

## Product and environment

- Public repo: https://github.com/rahuldave/nbinlineai; website: https://rahuldave.com/nbinlineai/; PyPI package: `nbinlineai`.
- GPL-3.0-only, matching ai-jup. Runtime Python >=3.11; development uses Python 3.12, uv, JupyterLab >=4.2,<5, Node 22.12+ or 20.19+.
- A prebuilt Python wheel contains frontend assets and the auto-enabled Jupyter Server extension. Students install through JupyterLab's PyPI Extension Manager or their environment's uv/pip. Restart the **whole server** after installation/update, then refresh the page. Reloading only the frontend can leave new server routes unavailable.
- API backends: OpenAI and Anthropic via pinned `python-fastllm==0.0.63`. ChatGPT subscription/Codex mode is research only. Never treat a subscription as an API key.
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
| Live namespace introspection and callable execution | `nbinlineai/kernel.py` |
| Flat FastLLM schema translation, API request | `nbinlineai/tool_schema.py`, `nbinlineai/providers.py` |
| Tool registry/formatting, bounded web reads | `nbinlineai/tools.py`, `nbinlineai/web_tools.py` |
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

Last release evidence: **114 Python tests, 36 frontend unit tests, 45 distinct browser checks**, plus production build, lint, examples in real kernels, archive checks and clean installation. The full browser pass initially had two fixture failures; their corrected focused reruns passed. Do not describe that as a single uninterrupted 45/45 run. Details are in the release record.

Known practical pitfalls:

- Rebuild and relink after frontend changes; otherwise tests may exercise an old prebuilt bundle. Do not run `uv build` concurrently with browser checks because the build hook rebuilds those assets.
- Browser tests share one temporary settings store. Reset custom style/settings dependencies in each test; avoid order-dependent assumptions.
- Shift+Enter can append/move focus to a blank cell; avoid a shifting `.last()` locator. Use stable IDs or deliberately fixed fixture positions.
- An AI answer fixture requires `isOutputCell`, a linked `promptCellId`, and appropriate status. Markdown text alone does not make an answer.
- After cancellation, wait for final `Cancelled` plus disabled Cancel before retrying; `Cancelling…` is not completion.
- Notebook virtualization makes rendered DOM an incomplete inventory. Derive selection from `model.cells`, and attach controls only to live widgets with disposal/reattachment support.
- Context preview introspection itself makes the kernel busy briefly. Do not invalidate and automatically re-preview on every busy/idle transition; that creates a request loop. Restart/dead/kernel replacement invalidate estimates; Refresh preview handles changed live values.
- Keep cell-control geometry stable before the first AI question is selected. Showing a previously hidden Context row during Run's pointer-down can move the button before pointer-up and swallow the click. Cover direct first-click execution while a code cell is busy.
- AI Prompt insertion activates a blank Markdown cell before tagging it as an AI question. Notify the context controller after tagging so the new active question becomes the preview target, including immediately after a checkbox interaction.
- Browser request assertions must use the versioned `notebook_cells` snapshot. `preceding_cells` is supported only for legacy clients.
- JupyterLab itself may normalize native notebook metadata on first load. Read-only preview tests should compare AI metadata and saved contents, then test dirty state after native initialization settles.
- `insert_tools` is intentionally skipped only in the explicitly tagged optional headless example cell; all example tool declarations are validated against real imports/definitions.
- Screenshot helper: `tests/support/capture_docs.mjs`. Use isolated fake-provider examples; captions identify simulations. Do not capture personal data/keys. README has a two-image limit.

## Release/docs workflow and deferred work

Keep versions aligned in `pyproject.toml`, `package.json`, `nbinlineai/__init__.py`, lockfiles and rebuilt extension metadata. Use a separate artifact directory per version; strict Twine, archive/credential checks, fresh wheel installation, both extension discovery checks, and public hashes are documented in [releasing](releasing.md). Do not modify immutable uploaded releases. Generated `lib/`, `dist/`, and prebuilt assets are ignored; build them, do not hand-edit them.

GitHub Pages builds `main:/docs` with Jekyll Minimal and the project's existing `rahuldave.com` domain. Source Markdown and images also ship in the Python package; `internal_docs/` does not. Public docs must clearly distinguish published-release behavior from unreleased source features. A documentation-only handoff does not need a new PyPI version.

Deferred: exact model-token capacity and output/reasoning reserves, richer outputs/images, broad edit/delete/execute tools, durable action replay, other-notebook live operations, and ChatGPT subscription login. See the research index; do not interpret historical “proposed” sections as existing APIs.

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

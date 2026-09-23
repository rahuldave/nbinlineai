# Bundled tools and frontend interface

Implementation design introduced in **0.1.6**, with tool inheritance in **0.1.7**, context/tool selection in **0.1.8**, and unexecuted code insertion in **0.1.10**. Public instructions are in [Tools and examples](../docs/tools.md). The [dialoghelper catalog](dialoghelper_tool_catalog.md) and [ipylab assessment](ipylab_frontend_bridge_assessment.md) record the research and deferred capabilities.

## Who owns what?

| Data or action | Owner / execution location | Consequence |
| --- | --- | --- |
| Cell order, IDs, source, metadata | JupyterLab document model | Includes unsaved/offscreen cells; no DOM scraping or execution-history inference. |
| Python variables, functions, object documentation | Connected Python kernel | Live values can differ from source and depend on out-of-order execution. |
| Saved `.ipynb` files | Kernel filesystem | Explicit paths; unsaved edits are absent. Renaming the notebook need not change kernel cwd. |
| Provider request and tool loop | Jupyter Server | FastLLM handles API transport; SSE carries browser action requests. |
| Web fetch for `read_url` | Kernel | Ordinary synchronous function, also usable directly in Python. |
| Web fetch for `url_to_note` | Server worker thread | Fetched Markdown goes to the original browser model for insertion. |
| Persisting notes | Normal Jupyter document save | Action acknowledgement means live-model mutation, never disk persistence. |

Default context is a bounded source snapshot above the prompt plus completed earlier AI exchanges. Since 0.1.8, whole-notebook, nearby-cell, individual Custom and current-question-only choices are available. Explicit tools can obtain additional context independently of those source choices.

## Tool surface and registration

The explicit `TOOL_FUNCTIONS` registry contains eleven tools:

- Kernel dispatch: `search_kernel_names`, `list_notebooks`, `find_notebook_cells`, `read_notebook_cell`, `inspect_python`, `read_url`.
- Special frontend dispatch: `list_cells`, `read_cell`, `insert_markdown`, `insert_code`, `url_to_note`.
- Separate user helper: `tools_markdown(names=None, custom=None)`. Returns removable Markdown references, optionally including explicit alias-to-callable mappings; it is not itself listed as a tool.
- Separate user helper in 0.1.7: `insert_tools(names=None, custom=None)`. Uses the same formatting, then requests an ordinary Markdown declaration below the calling code cell through an execution-bound Jupyter comm. It is not a model tool and requires no provider key.

Formatting is not registration. Users import functions, print references, and paste desired lines into ordinary Markdown notes or AI questions. In 0.1.7, the server scans all ordinary Markdown and AI question cells above plus the current question for `&` declarations before context trimming. It unions/deduplicates names and inspects the current kernel on each run. AI answers, code/raw cells, and printed output do not declare tools. `$` references still resolve only in the current question. The existing regex scans quotations and fences too. Several declarations can accumulate through a notebook; an omitted declaration's schema remains available. No metadata flag or execution of the declaration cell is required. See [context selection](cell_kernel_model_and_context_selection.md) for the shared budget and discovery boundary.

All schemas still come from kernel signature/docstring introspection and translation into FastLLM's flat function schema. Names sent to the provider are user-referenced identifiers, including aliases. No callable objects are shipped to the provider.

Special functions are recognized by object identity against `SPECIAL_TOOL_FUNCTIONS`, not by name or user-controlled attributes. Thus `read_cell as read_live` works, while a custom function named `read_cell` follows ordinary dispatch. Special routing information stays internal. Direct calls to the five Python stubs raise an explanatory error; this is not a general Python-to-browser API. Registry discovery tolerates an absent nbinlineai package so existing custom tools continue working in separate kernel environments. Bundled imports require installation there.

## Request/reply protocol

The current implementation has **two transports**, reviewed against source on 2026-09-23:

| Caller | Request / reply | Wait behavior | Main implementation |
| --- | --- | --- | --- |
| Model calls `list_cells`, `read_cell`, `insert_markdown`, `insert_code` (or composed `url_to_note`) | Server SSE `frontend_action`; authenticated browser POST `nbinlineai/action-reply` | Server awaits up to 45 seconds; no waiting Python tool body | `frontend_bridge.py`, `handlers.py`, `src/frontendActions.ts`, sequential `src/sse.ts` |
| Python code cell calls `insert_tools` | Jupyter comm target `nbinlineai.insert_tools.v1`; browser comm acknowledgement | Returns a mutable receipt immediately; 30-second acknowledgement timeout | `kernel_insert_tools.py`, `src/insertTools.ts`, `src/insertToolsProtocol.ts` |

These transports do not grant general arbitrary JavaScript access or execute cells on the model's behalf. Both bind mutations to original identities and acknowledge the live model only. Context selection itself needs a model snapshot/preview extension, not a third general-purpose mutation bridge. The authenticated `nbinlineai/context-preview` route now shares the snapshot/selection pipeline with execution. It performs bounded introspection on an existing idle kernel and returns stable included/omitted/partial IDs, with no provider request, offered tool call or notebook mutation.

The model-driven interface below is distinct from the direct Python `insert_tools` helper. The latter uses comm target `nbinlineai.insert_tools.v1` with the current execute-request ID, source code-cell ID, and bounded generated Markdown. `src/insertTools.ts` tracks the actual outgoing request from native cell execution, then validates the comm's parent and the original panel/model/kernel before insertion. Multiple helper calls share an insertion tail for their execution; redelivery of the same comm ID does not create another note. Python receives asynchronous acknowledgement in `InsertToolsReceipt`; it does not run or block an event loop to wait. Save normally after insertion. Headless clients cannot perform the browser mutation; `tools_markdown()` remains usable for plain text. See [`nbinlineai/kernel_insert_tools.py`](../nbinlineai/kernel_insert_tools.py) and [`src/insertToolsProtocol.ts`](../src/insertToolsProtocol.ts).

`FrontendBridge` is a server-local registry shared by prompt and reply handlers. After normal Jupyter authentication/execute authorization and session resolution, a run binds an unpredictable `run_id` to session ID, prompt cell ID, kernel ID, and kernel manager identity. It can hold one pending action ID and asynchronous future.

The direct helper requires explicit `comm>=0.2,<1` and `ipykernel>=6.18` dependencies. JupyterLab's broader transitive ipykernel minimum alone does not guarantee the separate comm package is connected to the running kernel. [ipykernel 6.18.0](https://github.com/ipython/ipykernel/releases/tag/v6.18.0) introduced the extracted comm package; its [kernel source](https://github.com/ipython/ipykernel/blob/v6.18.0/ipykernel/ipkernel.py) wires `comm.create_comm`. A separately selected kernel environment must meet this requirement too.

The direct helper's receipt is mutable, but its immediate notebook text output is a rendered snapshot and can continue to say `requested` after insertion succeeds. Use `receipt = insert_tools(...)`, then inspect `receipt.status`, `receipt.cell_id`, or `receipt.error` in a later code cell for the updated state. Do not use a synchronous wait loop inside the calling cell: that can prevent acknowledgement processing. On timeout or reply failure with either transport, inspect the live notebook for an already-inserted note before retrying.

The context event announces the run ID before any action. The browser binds the first ID and rejects changed or missing bindings. Each special call yields:

```json
{
  "type": "frontend_action",
  "run_id": "unpredictable-run-id",
  "request_id": "unique-action-id",
  "name": "read_cell",
  "arguments": {"cell_id": "stable-cell-id", "start_line": 1, "end_line": 40}
}
```

The browser verifies its captured panel/model/session/kernel/prompt/answer, performs the operation, then POSTs to the base-URL-relative `nbinlineai/action-reply`:

```json
{
  "run_id": "unpredictable-run-id",
  "request_id": "unique-action-id",
  "session_id": "original-session",
  "prompt_cell_id": "original-prompt",
  "ok": true,
  "text": "1: source text"
}
```

Insertion uses `cell_id` instead of `text`; errors use `ok: false` with bounded `text`. The server constructs insertion-success wording, explicitly acknowledging the live model rather than a saved file. Normal Jupyter authentication/XSRF and execute authorization apply. The registry validates bindings, fields, bounds, duplicate completion, and current kernel identity before completing the future.

The provider loop waits for the result before continuing. SSE callbacks run sequentially and await reply delivery. Independent notebooks retain independent queues/runs. No Python execute request waits for the browser, avoiding a kernel event-loop deadlock.

## Actions and bounds

| Action | Model operation |
| --- | --- |
| `list_cells(start=0, limit=20)` | Zero-based cell order, up to 50 requested cells, stable IDs/types/source previews and useful AI roles. Pagination reports omitted cells. |
| `read_cell(cell_id, start_line=1, end_line=40)` | Exact ID, inclusive one-based source lines, at most 80 lines, bounded text with truncation notice. |
| `insert_markdown(content, after_cell_id="")` | Up to 8,000 characters; ordinary Markdown inserted in one shared-model transaction. |
| `insert_code(content, after_cell_id="")` | Up to 8,000 characters; ordinary code with empty outputs, null execution count and no AI metadata. No execution option. |

An empty insertion anchor selects the paired answer. Repeated insertions after an anchor in the same run retain order. Explicit IDs refer to those cells. Deleted anchors, missing prompt/answer, replaced models, closed panels, and changed sessions fail instead of using current focus. No execution, replacement/deletion, explicit save, or deliberate focus change is offered.

The code and Markdown actions share the same insertion-tail map, so mixed calls preserve their order. The AI question and paired answer remain in place. The Python stub is registered by identity and the model sees ordinary parameter/docstring schemas; generic special-tool dispatch handles it through the same authenticated action/reply transport. An insertion acknowledgement means live model change, never execution. The user can edit and run inserted code through ordinary Jupyter actions later.

Replies fit 4,000 characters; errors fit 500. Actions expire after 45 seconds; at most 64 prompt runs are held. IDs also expire on completion, cancellation, or disconnect. The registry is ephemeral, not a durable job queue.

`url_to_note` composes a bounded public-page fetch on a server worker with `insert_markdown`. Session/kernel validation occurs before emitting insertion and on reply. Cancellation stops awaiting the worker; a read-only worker may finish later but cannot emit an insertion afterward.

## Delivery, cancellation, and persistence

The browser deduplicates action IDs for one run using canonical payloads. Identical duplicate delivery does not mutate again; changed payload with the same ID fails. Server replies are accepted once. No reconnect replay or cross-run idempotency is promised.

Mutation can succeed before acknowledgement delivery fails. Cancel cannot roll back a note, earlier Python side effects, or data already sent to the provider. A fresh run may insert another note; the FAQ tells users to inspect the notebook before retrying after a failed connection.

Keep answer skips the whole completed request, including tools. It does not recreate Python state. Notes are ordinary Markdown, not AI-output metadata or a tool transcript. Later prompts snapshot when reached, so preceding inserted notes can enter context. Regenerating an answer does not replace its separate notes. Save normally to persist them; ordinary Jupyter autosave behavior still applies.

## Web retrieval and Python inspection

`inspect_python` resolves a public root from IPython's namespace or Python builtins, followed by up to three public attribute segments using static lookup. It does not evaluate expressions or access properties to resolve a dotted name. Sections are `help`, `signature`, `source`; unavailable source/signatures produce useful text. `$` remains the direct value mechanism.

The shared web helper permits HTTP(S) without URL credentials. It validates public addresses at each redirect and pins the resolved IP, preserving TLS verification of the hostname. It bounds bytes (1 MB), redirects (3), socket inactivity (8 seconds), output (8,000 characters), and checks a shared 20-second elapsed deadline between blocking operations. DNS and some HTTP operations are blocking; server waiting is separately bounded and ordinary kernel calls have the dispatcher timeout. This is not a browser, crawler, PDF reader, or authenticated importer.

HTML conversion retains text/headings/lists/code and omits scripts/media; the source URL accompanies the excerpt. Provider keys, cookies, and notebook context are not included in fetches. Imported text remains outside material; Jupyter's ordinary Markdown renderer/sanitization handles inserted notes.

## Upstream and deferred scope

Reviewed [dialoghelper at 118fff2](https://github.com/AnswerDotAI/dialoghelper/tree/118fff2cfba024381a693d20a5612aedec54cf5b). Its package is Apache-2.0; nbinlineai remains GPL-3.0-only. These analogous functions are independently implemented without Solveit services or copied implementation.

Namespace/file tools correspond to `names_containing`, `list_dialogs`, `find_msgs`, and `read_msgid`/`view_msg`; the formatter corresponds to `mk_toollist`. The frontend supplies the missing model reads and limited insertion for `url2note`-style behavior. No ipylab dependency is needed: our extension already owns the panel/model, and acknowledged stable-ID actions fit better than current-widget command dispatch.

Still deferred: editing/deleting existing cells, AI-triggered code execution, images/screenshots, shell tools, AST rewriting, tracing, other-notebook live operations, and model-aware token budgeting. See [cell/kernel model](cell_kernel_model_and_context_selection.md) before expanding those contracts.

## Verification

- Unit: reference scope, callable identity/aliases, bounded inputs/results, web validation/conversion, object lookup, authenticated replies, mismatched/duplicate/expired IDs, timeout/cancel.
- Real kernel: callable introspection/dispatch, aliases and shadowed names, example setup cells without API keys.
- Frontend: unsaved/below-prompt source, pagination, exact anchors/order, deduplication, missing cells, sequential SSE.
- Isolated JupyterLab: real kernel and browser with a fake provider, observable reads/insertions, tab switches, save behavior, Keep and native Run All regressions.
- Artifacts: wheel/source include runtime, public docs/screenshots, examples/fixtures; exclude credentials and private internal docs.

## Context selection integration (current source, after 0.1.7)

Context mode and cell checkboxes select notebook text independently of tool declarations. Enabled earlier ordinary Markdown and AI questions still declare tools even when unchecked for Context or budget-omitted. The separate per-cell Tools checkbox defaults true and can withdraw that cell's declarations; duplicate enabled declarations remain effective. Current question only removes optional notebook text but preserves Tools choices. Including below-question text never registers its tools. The header exposes tools separately. Preview and each actual queued run use the full live ordered snapshot; only the current question resolves `$` values. Newly inserted notes inherit Custom inclusion when eligible, and later queued questions see them through fresh snapshots. Neither existing mutation transport changed.

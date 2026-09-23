# Bundled tools and frontend interface

Implementation design for **0.1.6**, following approval to build the interface, the tools it enables, and examples. Public instructions are in [Tools and examples](../docs/tools.md). The [dialoghelper catalog](dialoghelper_tool_catalog.md) and [ipylab assessment](ipylab_frontend_bridge_assessment.md) record the research and deferred capabilities.

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

Automatic context remains a bounded source snapshot above the prompt plus completed earlier AI exchanges. Explicit tools obtain additional context. Whole-notebook, nearby-cell, and individual context-selection controls remain deferred.

## Tool surface and registration

The explicit `TOOL_FUNCTIONS` registry contains ten tools:

- Kernel dispatch: `search_kernel_names`, `list_notebooks`, `find_notebook_cells`, `read_notebook_cell`, `inspect_python`, `read_url`.
- Special frontend dispatch: `list_cells`, `read_cell`, `insert_markdown`, `url_to_note`.
- Separate user helper: `tools_markdown(names=None, custom=None)`. Returns removable Markdown references, optionally including explicit alias-to-callable mappings; it is not itself listed as a tool.

Formatting is not registration. Users import functions, print references, and paste desired lines into the current AI question. Only that question's `&` references define its allowlist. Earlier Markdown and AI exchanges contribute text without granting access. Printed code outputs are not automatic context. The same scope applies to `$` references; the existing regex scans quotations and fences too.

All schemas still come from kernel signature/docstring introspection and translation into FastLLM's flat function schema. Names sent to the provider are user-referenced identifiers, including aliases. No callable objects are shipped to the provider.

Special functions are recognized by object identity against `SPECIAL_TOOL_FUNCTIONS`, not by name or user-controlled attributes. Thus `read_cell as read_live` works, while a custom function named `read_cell` follows ordinary dispatch. Special routing information stays internal. Direct calls to the four Python stubs raise an explanatory error; this is not a general Python-to-browser API. Registry discovery tolerates an absent nbinlineai package so existing custom tools continue working in separate kernel environments. Bundled imports require installation there.

## Request/reply protocol

`FrontendBridge` is a server-local registry shared by prompt and reply handlers. After normal Jupyter authentication/execute authorization and session resolution, a run binds an unpredictable `run_id` to session ID, prompt cell ID, kernel ID, and kernel manager identity. It can hold one pending action ID and asynchronous future.

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

An empty insertion anchor selects the paired answer. Repeated insertions after an anchor in the same run retain order. Explicit IDs refer to those cells. Deleted anchors, missing prompt/answer, replaced models, closed panels, and changed sessions fail instead of using current focus. No execution, replacement/deletion, explicit save, or deliberate focus change is offered.

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

Still deferred: editing/deleting existing cells, AI-triggered code execution, images/screenshots, shell tools, AST rewriting, tracing, other-notebook live operations, and automatic context selectors. See [cell/kernel model](cell_kernel_model_and_context_selection.md) before expanding those contracts.

## Verification

- Unit: reference scope, callable identity/aliases, bounded inputs/results, web validation/conversion, object lookup, authenticated replies, mismatched/duplicate/expired IDs, timeout/cancel.
- Real kernel: callable introspection/dispatch, aliases and shadowed names, example setup cells without API keys.
- Frontend: unsaved/below-prompt source, pagination, exact anchors/order, deduplication, missing cells, sequential SSE.
- Isolated JupyterLab: real kernel and browser with a fake provider, observable reads/insertions, tab switches, save behavior, Keep and native Run All regressions.
- Artifacts: wheel/source include runtime, public docs/screenshots, examples/fixtures; exclude credentials and private internal docs.

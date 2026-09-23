---
title: Architecture
---

# Architecture

This describes the API-based implementation in nbinlineai 0.1.7. For everyday use and screenshots, see the [user guide](user-guide.md).

## Three parts, plus the provider

```text
Browser: JupyterLab + nbinlineai frontend
    | authenticated HTTP: prompt, preceding cells, choices
    v
Jupyter Server + nbinlineai Python extension
    |-- FastLLM asynchronous client --> OpenAI / Anthropic API
    |-- Jupyter kernel messages -----> notebook's Python kernel
    |
    +-- streamed events -------------> paired Markdown answer
    +-- frontend_action -------------> original notebook model
    <--- authenticated action-reply -- browser acknowledgement
```

| Component | Responsibilities |
| --- | --- |
| JupyterLab frontend | Add prompt controls, read the notebook model, resolve settings, intercept AI execution, update the answer cell, and perform bounded live-cell actions. |
| Python server extension | Authenticate requests, validate inputs, construct context, read credentials, call the provider, coordinate tool rounds, and correlate browser action replies. |
| Notebook kernel | Retrieve explicitly referenced live values, inspect function signatures, and execute allowed functions. |
| FastLLM | Adapt a common message/tool representation to provider APIs and stream their responses. |

The frontend is a prebuilt JupyterLab 4.2+ extension bundled in the Python package. Students do not need Node.js. The same package registers a Jupyter Server extension; this is why installation and upgrades require a **whole-server restart**.

## An AI cell is a Markdown cell

There is no new notebook cell type or cell magic. A prompt is a standard Markdown cell with `metadata.nbinlineai.isPromptCell`. Its answer is another Markdown cell with `isOutputCell`, `promptCellId`, and run status. The answer text lives in `source`, not in a code cell's `outputs` array.

This keeps the notebook readable without the extension. The stored link lets a rerun replace the paired answer. Copy buttons are frontend decoration and do not alter the saved Markdown. The notebook does not contain a separate structured transcript of tool calls.

Editing a completed answer changes the source that later requests use as history. Keep answer prevents regenerating that answer; it does not exclude it from context. The extension does not maintain a dependency graph, automatically invalidate answers below an edit, or mark them stale.

## One prompt request

1. The frontend resolves **Keep answer** from an explicit cell value, then the notebook default, then `true`. A completed, nonempty paired answer is protected when this is on; protected execution makes no API request.
2. It resolves cell overrides over notebook defaults over user preferences. It snapshots the current prompt, cells above it, the notebook session ID, and the effective settings.
3. The server validates the request and resolves the session to its existing Python kernel.
4. Tool declarations in ordinary Markdown and AI questions above are combined with those in the current question, before context selection. The kernel inspects those functions afresh. Variable references are read and substituted only in the current question.
5. The server accounts for tools, the expanded question, and instructions, then fills the remaining character budget with nearest preceding source and complete AI pairs. It sends selected material in chronological order.
6. FastLLM calls the selected provider. Text events stream back to the answer cell. If the model requests a tool, the server validates it and dispatches an ordinary function to the same kernel or a recognized live notebook tool to the browser. It appends the result, budgets again with the same notebook snapshot, and continues the conversation without replaying completed tools.
7. The frontend marks the answer completed, failed, or cancelled. Saving the notebook preserves the text and metadata.

The server disables automatic provider retries: silently repeating a request that can call functions could repeat a side effect. A user-initiated rerun is a new request.

## Context and live state

### What the frontend knows

JupyterLab owns the notebook document model: an ordered list of cells, each with an ID, type, source text, and metadata. The extension reads this model, including unsaved edits. It does not scrape the rendered page; cells scrolled out of view or not currently rendered are still in the model.

For an individual Run command, the active notebook and selected cell identify the target. During Run All, JupyterLab hands the executor each target cell. The extension captures that **prompt cell's ID**. A later selection change does not make a different cell the target of the request.

`precedingCells(model, promptCellId)` in `src/context.ts` walks the ordered model from the start and stops when it reaches that ID. Everything visited is above the prompt; the remaining cells are below it. The boundary comes from document position, not screen coordinates, scroll position, a cell's execution count, or the kernel's history.

```text
Frontend document model                 Kernel process
  cell A: Markdown notes                  user_ns["scores"]
  cell B: Python source                   user_ns["add_bonus"]
  cell C: AI prompt  <-- target ID         other live Python objects
  cell D: paired answer
  cell E: later code

Request source context: cells A and B
Explicit live references: selected names from the kernel namespace
```

The browser sends a snapshot of the preceding cells with their IDs, types, current source, metadata, and code execution counts, along with the prompt text and notebook session ID. The server then enforces the cell-count and source/history limits. Code execution counts are descriptive; they do not decide inclusion. A range execution snapshots each AI prompt when it reaches its turn, so earlier updated answers can enter later requests.

### What the kernel knows

The kernel holds live Python variables, imported modules, functions, and execution state. It is not the source of truth for the notebook's Markdown, unexecuted source, cell order, or selected cell. Its executed-code history cannot reconstruct the current notebook: cells may be edited, moved, deleted, or never executed.

The server uses the frontend's session ID to find the session's Python kernel. A `$` reference asks that kernel for a named object's bounded representation. An `&` reference asks for the named callable's signature/docstring and permits subsequent calls. This uses Jupyter execution messages; it does not require the kernel to know which cells are visually above the prompt.

| Information | Source of truth |
| --- | --- |
| Current target prompt | The cell ID supplied by the frontend command or executor. |
| Above/below and notebook order | The frontend's notebook cell list. |
| Unsaved code/Markdown edits | Current frontend shared-model source. |
| Saved answers and their pairing | Markdown source and cell metadata in the notebook model. |
| Actual Python value or callable | The running kernel namespace. |
| Which kernel belongs to the notebook | Jupyter Server's session/kernel managers. |
| Context limits and source/history separation | The server's prompt builder. |

These sources can disagree without either being broken. Editing `score = 10` to `score = 20` changes the source context immediately, but the live value remains 10 until that code executes. Moving its cell below a prompt removes its source from that prompt's default context; it does not remove `score` from the kernel.

### What the server includes

The browser sends cells **above the prompt in notebook order**. The server selects nearest preceding code, ordinary Markdown, and completed AI pairs within one shared budget, then restores the selected material's chronological order. Source appears in the system context; AI pairs become conversational messages, rather than being duplicated as ordinary Markdown.

The source snapshot excludes later cells, code outputs, raw-cell content, image pixels, and automatic file contents. Linked pages are not fetched. The [user guide](user-guide.md#9-troubleshooting-and-limits) lists all size and round limits.

Live state is separate. A variable can come from a cell executed below the prompt or out of order. The extension reads `get_ipython().user_ns` in the running kernel, not a value inferred from the displayed source. A variable reference sends a bounded `repr` string; arbitrary objects are not serialized to the provider.

### Selection budgets and provider overflow

The current algorithm in `nbinlineai/prompt.py` is deterministic and uses **characters**, not model tokens:

1. `validate_request` permits up to 10,000 preceding cells, a current question of up to 16,000 characters, and custom style instructions of up to 8,000 characters. The snapshot includes all cell types; the transport cap is not a context-selection rule.
2. Discover tool names in all eligible Markdown/AI questions above plus the current question. Exclude AI answers, code/raw cells, and anything below. Deduplicate before fresh kernel introspection. `$` discovery stays limited to the current question.
3. Count serialized tool definitions first, then messages containing system/style instructions, the expanded current question, and any ongoing tool conversation. This fixed material must fit the shared 64,000-character budget. The expanded question is counted even though its separate 16,000-character validation happened before substitution.
4. Walk optional source and complete AI pairs from nearest to farthest above the question, adding what fits. Ordinary boundary source can retain only its ending, with a partial-source marker. AI pairs remain whole; stop rather than skip a non-fitting pair to select smaller older ones.
5. Restore selected source and history to chronological order. Send source with system instructions, completed pairs as user/assistant messages, then the current question and its tool conversation. These two representations are still separate; the selection budget is shared.
6. Before each subsequent provider call, include all accumulated tool calls/results in the fixed material and select again from the **original snapshot**. This can remove more old context. Tools already called are not executed again by this selection pass.

For example, if tools and the current request leave 30,000 characters, a nearby 20,000-character code cell takes priority over a much older 40,000-character note. The remaining allowance can retain the end of that note after accounting for serialization and labels. A tool declared at the note's beginning remains available even when that text is omitted.

This is an application-level character estimate, **not a model-aware token budget**. Serialized messages include labels, substituted values, and tool traffic; tool schemas count separately. Provider-specific conversion and tokenization differ, so the extension cannot guarantee that every request fits the chosen model. It does not yet reserve context capacity for output and reasoning using that model's limits.

`nbinlineai/providers.py` sets an output ceiling of 16,384 tokens, 32,768 for effective `high` effort, or 65,536 for `xhigh`/`max`. This is a generation allowance, not the notebook context limit or an implemented reservation of room in it. Provider rules determine how input, output, and reasoning allowances interact.

If fixed material alone exceeds the application budget, the run stops before that provider call with a size error. Recognized provider context-overflow errors also receive an actionable message. There is no automatic summarization, continuation, or retry after provider rejection. A provider finish reason of `length` instead produces **“Model response exceeded the output limit”**. Both mark the answer failed; streamed partial text can remain, completed tool effects remain, and the failed exchange is not used as later history.

The server emits a context report before every provider round, with included/omitted/partial cell counts, source/history truncation, tool names, and counted characters. The frontend shows **Done · context trimmed** if any round shortened eligible context. Hover text explains the counts and explicitly labels them as character estimates. This report is transient browser state, not a persisted per-run transcript. See the [FAQ](faq.md#what-happens-if-the-request-exceeds-the-models-context-window) for user recovery steps.

### Future context selection

Per-cell inclusion switches, whole-notebook context, and a window around the prompt are **not implemented**. The frontend model makes those selections feasible, but the request contract and backend filtering currently assume preceding cells. Expanding the source selection would not expand the kernel's scope: live references already use the whole current namespace.

Before implementing selection modes, we need to define what a window counts, how moved cells affect the selection, how size limits are reported, and how later AI exchanges are treated. In particular, the current prompt's old paired answer must not accidentally become context for its own rerun, and future exchanges must not be presented as earlier conversation. Detailed feasibility notes are maintained in the repository's `internal_docs/cell_kernel_model_and_context_selection.md`.

## Turning Python functions into tools

A prompt containing ``&`add_bonus` `` explicitly makes that named kernel function available. The kernel inspects its signature and docstring. Parameters without defaults are required; parameters with defaults are optional. Simple Python annotations map to JSON Schema types such as `integer`, `number`, `string`, `boolean`, `array`, and `object`.

For example:

```python
score = 7

def add_bonus(value: int) -> int:
    """Return the score plus a bonus."""
    return score + value
```

The server constructs this FastLLM function description:

```json
{
  "type": "function",
  "name": "add_bonus",
  "description": "Return the score plus a bonus.",
  "parameters": {
    "type": "object",
    "properties": {
      "value": {"type": "integer", "description": "value"}
    },
    "required": ["value"]
  },
  "strict": false
}
```

FastLLM accepts this flat OpenAI Responses-style description and adapts it for Anthropic. `strict: false` preserves the optional-parameter behavior of Python functions with defaults. No Python callable is shipped to the provider.

When a tool call returns, the server checks the function name against the current request's allowlist, parses bounded JSON arguments, and verifies that the notebook still uses the same kernel. Inside the kernel, `inspect.signature(...).bind(**arguments)` checks argument names and required parameters before invoking the function. Type annotations describe the schema; Python annotations are not a runtime type-enforcement system.

The tool result combines captured standard output with the return value's representation, up to 4,000 characters. Ordinary synchronous functions with named parameters are supported. Positional-only arguments, `*args`, `**kwargs`, and async functions are not supported in this version. Functions run with the notebook kernel's permissions and can change state or perform whatever actions their implementations allow.

### Bundled tools

`nbinlineai.tools` supplies ten functions. Six use the ordinary kernel dispatch path: search names, inspect Python documentation/signatures/source, list saved notebooks, search/read saved cells, and read a public URL. Four describe live notebook operations: `list_cells`, `read_cell`, `insert_markdown`, and `url_to_note`. Importing the package does not register them. The separate `tools_markdown()` helper returns references from an explicit registry, optionally with custom callable aliases. Paste these into an ordinary Markdown note or AI question; questions below inherit its declarations. Printed code output and AI answers do not declare tools.

The saved-file tools accept an explicit `.ipynb` path relative to kernel cwd (or an absolute path). They read disk source, with size/result limits; they have no access to the frontend's unsaved document model. A tool can deliberately read below the prompt or another saved notebook when asked. That result becomes part of the current tool conversation, while automatic source/history context keeps its preceding-cell boundary. File tools run with kernel filesystem permissions, not a Jupyter Contents API sandbox. See [Tools and examples](tools.md).

### Creating a tool declaration from Python

`insert_tools(names=None, custom=None)` is a user helper, separate from the ten model tools. It formats the same declarations as `tools_markdown()` and requests an ordinary Markdown cell below its calling code cell. It makes no provider request and requires no API key.

The Python helper sends a bounded request through a Jupyter comm. The frontend's native execution wrapper binds the actual outgoing execute-request ID and cell ID to the original notebook model and kernel. A matching comm request can insert the note; later active-cell or tab changes do not redirect it. The frontend acknowledges the inserted cell ID after the live-model change. Several calls in one execution preserve their order. Reexecuting the code deliberately creates fresh notes; rendering saved outputs does not replay an insertion.

The helper returns an asynchronous receipt and does not wait inside the kernel's event loop. An immediate display can therefore say **requested** before the acknowledgement arrives. There is no nested event loop, provider tool loop, or automatic disk save. This bridge only inserts the generated Markdown; it does not expose arbitrary browser operations. Sources: `nbinlineai/kernel_insert_tools.py`, `src/insertTools.ts`, and `src/insertToolsProtocol.ts`.

### Frontend request/reply interface

The kernel describes all registered callables, including the four frontend stubs. During inspection, the bridge identifies a special tool by **callable identity** against an explicit registry, not its Python variable name. An imported alias therefore works; a user-defined function with the same name follows normal kernel dispatch. Directly calling a frontend stub in Python raises an explanatory error.

The server creates an unpredictable `run_id` bound to the original session, kernel, and prompt cell. Each action gets a fresh `request_id`. A `frontend_action` SSE event carries those IDs, an allowlisted action name, and bounded arguments. The browser acts on the `NotebookPanel` captured when the prompt started, then sends an authenticated `POST nbinlineai/action-reply` containing the IDs, session/prompt binding, and either a bounded result or an error. The server checks the pending action and current kernel binding before accepting one reply.

The browser supports only these operations:

| Action | Frontend model operation |
| --- | --- |
| `list_cells` | Traverse the ordered live cell model and return IDs, types, roles, and short source previews. |
| `read_cell` | Find an exact cell ID and read a bounded, numbered source range. |
| `insert_markdown` | Insert one ordinary Markdown cell in a shared-model transaction. |

`url_to_note` is a server-side composition: fetch a bounded public page as Markdown, then request `insert_markdown`. Its network work runs outside the server's event loop. The provider receives insertion success only after the browser acknowledges the new cell ID. This acknowledges a change to the **live model**, not a save to disk.

Actions never use the currently focused tab or cell. The browser validates the original panel, document model, session, prompt, and answer before acting. Stable cell IDs allow reading unsaved cells above or below the prompt, including offscreen cells. A missing target or changed binding fails instead of falling back to the active cell.

By default insertion follows the paired answer; repeated default insertions in that run retain their request order. An explicit `after_cell_id` chooses another existing cell. Notes do not carry AI prompt/output metadata, so later prompts treat them as ordinary Markdown. Insertion does not autofocus, execute, replace/delete source, or explicitly save the document.

SSE callbacks run sequentially and await reply delivery. The browser deduplicates a request ID within its run, rejecting reuse with changed arguments; the server accepts a reply only once. Timeout, cancellation, disconnect, and completion expire pending action IDs. A disconnected client cannot resume that run. An insertion already applied remains even if its acknowledgement or the rest of the answer is lost; a new prompt run can insert again. There is no rollback or cross-run deduplication.

The interface does not provide general browser execution, arbitrary Jupyter command dispatch, cross-notebook edits, or a Python-to-browser blocking RPC. Future context selectors can use the existing frontend snapshot builder independently of this bridge; see the repository's `internal_docs/cell_kernel_model_and_context_selection.md` for feasibility notes.

## Settings and credentials

| Data | Stored where |
| --- | --- |
| Prompt and answer text | Cell `source` in the `.ipynb`. |
| Notebook provider, model, style, effort, Keep AI answers | Notebook `metadata.nbinlineai.defaults`. |
| Cell overrides and Keep answer | Prompt-cell `metadata.nbinlineai`. |
| Initial user preferences and custom style wording | JupyterLab user settings. |
| API keys saved through Configure AI | Private per-user configuration file on the machine running Jupyter Server. |

Effective notebook defaults are captured on first AI use, once a provider is configured. Merely opening an ordinary notebook does not create AI settings. Later cells inherit notebook defaults; legacy explicit cell choices remain overrides until reset.

For Keep answer, a missing cell value means inheritance; an explicit `true` or `false` remains an override even if the notebook default changes. Existing explicit choices from 0.1.4 are preserved. Resetting model/style overrides does not reset the Keep answer choice.

## Native notebook execution

Version 0.1.5 supplies a JupyterLab `INotebookCellExecutor` provider. It recognizes AI prompt Markdown cells and delegates ordinary cells to JupyterLab's exported executor. This connects AI prompts to native Run All, range execution, and keyboard execution without replacing command IDs or maintaining a separate Shift+Enter interception path.

JupyterLab schedules multiple cell-executor calls concurrently. nbinlineai queues them per notebook so that code, AI responses, and function calls finish in order. A failed or cancelled cell stops later queued work in the same batch; a later batch can run after the previous one drains. Different notebooks have independent queues.

Each AI request snapshots context when its turn executes, so it sees completed or edited earlier answers and the kernel state created by earlier work. Kept answers skip provider calls and do not replay earlier tool side effects. Headless notebook execution does not load this browser plugin and treats these cells as Markdown.

The server publishes the bundled style instructions and known model effort capabilities. The frontend sends any chosen custom style wording with a request; the server validates its size and keeps notebook-context instructions separate. FastLLM maps effort to OpenAI `reasoning.effort` or Anthropic `output_config.effort` with adaptive thinking where supported. Unknown models use their provider's default rather than an inferred effort schema.

Saved API keys take precedence over server environment keys. On macOS/Linux, the default file is `~/.config/nbinlineai/credentials.json`; an absolute `XDG_CONFIG_HOME` changes the configuration root. The browser receives availability and key-source information, never the saved key value. Project environments under the same OS account can share the file. See [key storage](user-guide.md#7-where-keys-are-stored) for details.

## Processes, event loops, and cancellation

Provider networking and HTTP streaming use the existing asynchronous Jupyter Server loop. Kernel work travels through Jupyter's normal kernel channels to a separate kernel process. The extension does not call `asyncio.run()` inside the notebook or patch the notebook event loop. No separate AI daemon, Codex CLI, or Codex app server is required for the API mode.

Frontend actions wait on an asynchronous server future while JupyterLab performs the model operation and posts its reply. They do not send a Python execute request that waits for the browser, so the kernel is free during that wait. Ordinary synchronous tools, including `read_url`, occupy the kernel while running; the server-side fetch for `url_to_note` uses a worker thread with bounded network work.

A per-kernel lock serializes the extension's own inspection and tool calls. It does not freeze normal notebook activity for the duration of a model response. Users should avoid changing the relevant kernel state while a tool-using prompt is running.

Closing or cancelling a request cancels the server task and cleans up provider/kernel channels. If an extension operation is actively executing in the kernel, cancellation or timeout can interrupt it. Cancellation cannot undo side effects that already occurred.

ChatGPT subscription sign-in is a future transport/authentication feature, not implemented through these API-key routes.

## Source map

Paths below are relative to the [source repository](https://github.com/rahuldave/nbinlineai).

| Path | Purpose |
| --- | --- |
| `src/index.ts` | JupyterLab plugin, notebook controls, settings dialog, request lifecycle. |
| `src/context.ts` | Cell-model traversal and the boundary before the target prompt ID. |
| `src/frontendActions.ts` | Bounded live notebook operations, insertion order, and action deduplication. |
| `src/sse.ts` | Sequential parsing and awaiting of streamed event callbacks. |
| `src/defaults.ts`, `src/keepAnswer.ts` | Setting inheritance and rerun protection. |
| `src/executionQueue.ts` | Ordered per-notebook execution, batch failure handling, and recovery. |
| `src/codeCopy.ts` | Clipboard controls on rendered code blocks. |
| `schema/plugin.json` | JupyterLab user-settings schema. |
| `nbinlineai/handlers.py` | Authenticated HTTP endpoints and server-sent events. |
| `nbinlineai/prompt.py` | Validation, context, style instructions, provider/tool loop. |
| `nbinlineai/providers.py` | FastLLM API adapter. |
| `nbinlineai/kernel.py` | Session-bound kernel inspection and execution. |
| `nbinlineai/frontend_bridge.py` | Bound run/action registry, argument/reply validation, and expiring asynchronous waiters. |
| `nbinlineai/tool_schema.py` | Signature-to-tool-schema translation. |
| `nbinlineai/tools.py` | Opt-in tools, frontend callable registry, and Markdown reference helper. |
| `nbinlineai/web_tools.py` | Bounded public-page retrieval and text/Markdown conversion. |
| `nbinlineai/config.py`, `nbinlineai/credentials.py` | Model capabilities, configuration, and key storage. |

Endpoints are relative to the Jupyter Server base URL: `GET nbinlineai/status`, `POST nbinlineai/prompt`, `POST nbinlineai/action-reply`, `GET/POST nbinlineai/settings/keys`, and `DELETE nbinlineai/settings/keys/{backend}`. These use Jupyter authentication and kernel-execution authorization.

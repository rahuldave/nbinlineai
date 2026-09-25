---
title: Architecture
---

# Architecture

This describes version 0.1.14's API and ChatGPT subscription connections, including context selection, prompt focus, and the expanded tool interface. For everyday use and screenshots, see the [user guide](user-guide.md).

## Notebook host and connection routes

```text
Browser: JupyterLab + nbinlineai frontend
    | authenticated HTTP: prompt, ordered snapshot, choices / preview
    v
Jupyter Server + nbinlineai Python extension
    |-- FastLLM asynchronous client --> OpenAI / Anthropic API
    |-- owned native runtime ----------> ChatGPT account allowance
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
| FastLLM | Adapt a common message/tool representation to the two API providers. |
| ChatGPT runtime | Own account login and internal model work; return an answer or proposed declared notebook-tool group to the host. |

The frontend is a prebuilt JupyterLab 4.2+ extension bundled in the Python package. Students do not need Node.js. The same package registers a Jupyter Server extension; this is why installation and upgrades require a **whole-server restart**.

## An AI cell is a Markdown cell

There is no new notebook cell type or cell magic. A prompt is a standard Markdown cell with `metadata.nbinlineai.isPromptCell`. Its answer is another Markdown cell with `isOutputCell`, `promptCellId`, and run status. The answer text lives in `source`, not in a code cell's `outputs` array.

This keeps the notebook readable without the extension. The stored link lets a rerun replace the paired answer. While an answer waits for its first streamed text, its empty source stays empty and the frontend hides JupyterLab's rendered Markdown placeholder. Copy buttons are frontend decoration and do not alter the saved Markdown. The notebook does not contain a separate structured transcript of tool calls.

Editing a completed answer changes the source that later requests use as history. Keep answer prevents regenerating that answer; it does not exclude it from context. The extension does not maintain a dependency graph, automatically invalidate answers below an edit, or mark them stale.

## One prompt request

1. The frontend resolves **Keep answer** from an explicit cell value, then the notebook default, then `true`. A completed, nonempty paired answer is protected when this is on; protected execution makes no model request.
2. It resolves cell overrides over notebook defaults over user preferences. An absent cell provider follows the notebook provider even when that cell has a model override; an explicit legacy cell provider stays pinned until reset. When its queued turn starts, it snapshots the actual prompt ID, all live cell models in order, the context policy, notebook session ID and effective settings.
3. The server validates the request and resolves the session to its existing Python kernel.
4. Tool declarations in ordinary Markdown and AI questions above are combined with those in the current question, before context selection. The kernel inspects those functions afresh. Variable references are read and substituted only in the current question.
5. The server accounts for tools, the expanded question, instructions and bounded cell landmarks, then fills the remaining character budget from selected eligible source and complete earlier AI pairs, nearest first. It sends selected material in chronological order.
6. The selected connection sends one host-built round: FastLLM for an API provider, or the owned ChatGPT runtime. The ChatGPT runtime may make internal inference or recovery requests within that round, but native file, shell, browser, and ambient project-instruction tools are disabled. It returns an answer or a proposed group of declared notebook-tool calls. The host validates and dispatches ordinary functions to the same kernel or recognized live notebook tools to the originating browser. It appends completed results, budgets a new host round against the same snapshot, and continues without replaying tool effects.
7. The frontend marks the answer completed, failed, or cancelled. Saving the notebook preserves the text and metadata.

The server does not automatically repeat a completed notebook-tool action. A user-initiated rerun is a new request. **Maximum tool steps** counts host-executed groups of declared notebook tools, not internal ChatGPT inference requests; a group can contain several calls.

## Context and live state

### What the frontend knows

JupyterLab owns the notebook document model: an ordered list of cells, each with an ID, type, source text, and metadata. The extension reads this model, including unsaved edits. It does not scrape the rendered page; cells scrolled out of view or not currently rendered are still in the model.

For an individual Run command, the active notebook and selected cell identify the target. During Run All, JupyterLab hands the executor each target cell. The extension captures that **prompt cell's ID**. A later selection change does not make a different cell the target of the request.

The snapshot builder in `src/context.ts` walks every live cell model in order and includes the target question ID. The server derives above/below from this order. Legacy `preceding_cells` requests retain their older above-only contract. The boundary comes from document position, not screen coordinates, scroll position, a cell's execution count, or the kernel's history.

```text
Frontend document model                 Kernel process
  cell A: Markdown notes                  user_ns["scores"]
  cell B: Python source                   user_ns["add_bonus"]
  cell C: AI prompt  <-- target ID         other live Python objects
  cell D: paired answer
  cell E: later code

Default source candidates: cells A and B
Full notebook also considers E; D is always excluded for C
Explicit live references: selected names from the kernel namespace
```

The browser sends a versioned ordered snapshot with IDs, types, current source, relevant metadata, explicit Custom choices and code execution counts, along with the prompt text and notebook session ID. The server then enforces the cell-count and source/history limits. Code execution counts are descriptive; they do not decide inclusion. A range execution snapshots each AI prompt when it reaches its turn, so earlier updated answers can enter later requests.

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

Selection uses the shared backend path for both preview and execution. Default preserves nearest-above ordinary source and complete history pairs. Full notebook, All above, both ten-cell windows, Custom and Current question only resolve candidates before budgeting. The ten-cell windows count physical positions after removing the current question and all its linked answers; ineligible cells still count toward the window.

The current question and every linked answer are excluded by ID everywhere. Earlier completed pairs become history only when both cells are selected and above; deterministic duplicate handling chooses one completed answer. Independently selected AI cells and AI material below or straddling the question are explicitly labeled source with role, link and position. Running, failed, cancelled and orphaned answers remain ineligible. Default retains its legacy pair-only eligibility.

Source appears with system instructions; complete earlier pairs become user/assistant messages. Each representation preserves notebook order. Code outputs, raw-cell content, image pixels and automatic file contents are absent, and linked pages are not fetched. [Troubleshooting and limits](manual/troubleshooting.md) lists limits.

Live state is separate. A variable can come from a cell executed below the prompt or out of order. The extension reads the running kernel namespace, not a value inferred from source. Only current-question `$` references retrieve bounded representations. Enabled earlier ordinary Markdown/AI-question tool declarations remain in scope independently of selected prose; selected below-question declarations never register tools.

### The question's focus and its background

Shared instructions distinguish the current task from the selected notebook background. A request to explain the nearest code cell should use earlier definitions to explain that cell, rather than summarize all available source. The instructions apply alongside Compact, Full, Learning, and any user-edited style wording; no separate intent-classification request is made.

`nbinlineai/prompt_focus.py` derives a bounded set of landmarks from the frozen, complete notebook snapshot: the current question's position, immediate physical predecessor, nearest earlier code cell, nearest earlier ordinary Markdown cell, and nearest ordinary Markdown heading cell. Positions are one-based. Section detection recognizes `#` through `######` headings outside backtick/tilde fences, excluding four-space-indented code. Setext underline headings are not section anchors in this version. A section extends from its heading cell through the cell immediately before the question.

After each budget pass, each landmark reports full, partial, omitted-by-budget, excluded/ineligible, or absent source. IDs, positions and availability are sent without copying excluded source or heading text. For a landmark retained as part of earlier chat history, the payload identifies the conversation pair and question/answer role; original history text is preserved. Context choices stay authoritative: naming the nearest code cell does not silently reinclude unchecked code.

Landmark status fields have a constant serialized size, so updating availability after selection does not change the reserved character cost. The same builder serves preview and provider rounds. The shared instructions ask the model to disclose missing material or clarify an ambiguous target, and to apply the chosen response style to tool-created content too. These are model instructions, not a guarantee about every generated answer.

The four empty-question starters are frontend controls. Accepting one writes ordinary editable prompt source; simply displaying them writes no source or metadata and makes no provider request. They create no additional cell type or response mode.

### Selection budgets and provider overflow

The current algorithm in `nbinlineai/prompt.py` is deterministic and uses **characters**, not model tokens:

1. `validate_request` permits up to 10,000 ordered snapshot cells, a current question of up to 16,000 characters, and custom style instructions of up to 8,000 characters. The snapshot includes all cell types; the transport cap is not a context-selection rule.
2. Discover tool names in all enabled eligible Markdown/AI questions above plus the enabled current-question declarations. Exclude AI answers, code/raw cells, and anything below. Deduplicate before fresh kernel introspection. `$` discovery stays limited to the current question.
3. Count serialized tool definitions first, then messages containing system/style instructions, bounded cell landmarks, the expanded current question, and any ongoing notebook-tool conversation. This fixed material must fit the 64,000-character **host-submitted round** budget. The expanded question is counted even though its separate 16,000-character validation happened before substitution.
4. Walk selected source and complete earlier AI pairs by distance, above winning ties. A pair is anchored at its answer. Boundary source can retain its ending above or beginning below, with an explicit partial-source marker. AI pairs remain whole; stop rather than skip a non-fitting pair to select smaller older ones.
5. Restore selected source and history to chronological order. Send source with system instructions, completed pairs as user/assistant messages, then the current question and its tool conversation. These two representations are still separate; the selection budget is shared.
6. Before each subsequent host round, include all accumulated declared tool calls/results in the fixed material and select again from the **original snapshot**. This can remove more old context. Tools already called are not executed again by this selection pass.

For example, if tools and the current request leave 30,000 characters, a nearby 20,000-character code cell takes priority over a much older 40,000-character note. The remaining allowance can retain the end of that note after accounting for serialization and labels. A tool declared at the note's beginning remains available even when that text is omitted.

OpenAI API and Claude API use the same normalized-message JSON plus tool-schema character estimate in `build_context`, so identical host material generally produces the same candidate fit. ChatGPT calls the runtime's `round_wire_cost` for the fixed part and every optional candidate; that cost includes its escaped payload, structured schema and a fixed protocol metadata reserve, and the host adds authenticated notebook-folder context to its instructions. The actual RPC envelopes are checked before submission. All three paths share `select_context`, candidate order, pair handling, and the 64,000-character boundary. A provider-specific budget estimate may change which candidates fit without changing their saved `contextInclude` flags. In Default, computed checkbox states mirror first-round inclusion; explicit modes show saved or mode-selected candidates and report budget omission separately. See the [user-facing example](manual/context-selection.md#why-a-selected-cell-may-be-missing).

This is an application-level character estimate, **not a model-aware token budget**. Serialized messages include labels, substituted values, and tool traffic; tool schemas count separately. Provider-specific conversion and tokenization differ, so the extension cannot guarantee that every request fits the chosen model. It does not yet reserve context capacity for output and reasoning using that model's limits. ChatGPT can make internal inference or recovery calls within one host round; those internal requests are outside this submitted-payload estimate. The host still controls which notebook content and declared tool groups it submits and executes.

`nbinlineai/providers.py` sets an output ceiling of 16,384 tokens, 32,768 for effective `high` effort, or 65,536 for `xhigh`/`max`. This is a generation allowance, not the notebook context limit or an implemented reservation of room in it. Provider rules determine how input, output, and reasoning allowances interact.

If fixed material alone exceeds the application budget, the run stops before that provider call with a size error. Recognized provider context-overflow errors also receive an actionable message. There is no automatic summarization, continuation, or retry after provider rejection. A provider finish reason of `length` instead produces **“Model response exceeded the output limit”**. Both mark the answer failed; streamed partial text can remain, completed tool effects remain, and the failed exchange is not used as later history.

The server emits a context report before every provider round, with selected, eligible, excluded, included/omitted/partial cell IDs and counts, ineligibility reasons, above/below counts, partial regions, source/history truncation, tool names and counted characters. The frontend shows **Done · context trimmed** if any round shortened eligible context. Hover text explains the counts and explicitly labels them as character estimates. This report is transient browser state, not a persisted per-run transcript. See the [FAQ](faq.md#what-happens-if-the-request-exceeds-the-models-context-window) for user recovery steps.

### Preview and saved choices

The authenticated `POST nbinlineai/context-preview` route uses the same normalization, reference inspection and context builder as execution. It requires kernel-execution authorization, a bound existing idle Python kernel and no provider key. It makes no provider request, calls no offered tool body and does not mutate the notebook. Live inspection may invoke user-defined Python representation/introspection; it is not intrinsically free of arbitrary user-code effects.

The frontend retains a transient question target per notebook. Selecting a question or its linked answer updates it; clicking other inclusion controls retains it. A generation ties responses to the panel, model, kernel, target, snapshot and effective settings. Edits and binding changes invalidate old responses, requests are coalesced, and **Details → Check context** permits explicit inspection after live-state changes. The collapsed toolbar contains only the notebook-wide mode and Details; target information and check status are inside Details. Pending checks show Checking, successful current-generation replies show counts and a transient completion time, and unavailable/busy kernels or unresolved references show the failure reason. Actual execution always snapshots and inspects again; inspecting context is not a prerequisite.

Notebook metadata stores `nbinlineai.defaults.contextMode`; cell metadata stores `nbinlineai.contextInclude` for Custom text and independent `nbinlineai.toolsInclude` for declaration eligibility. Missing Tools flags inherit true. The wire carries `tools_include`; disabled declaration cells are filtered before name deduplication and introspection, so missing disabled functions do not fail the request. Duplicate enabled declarations still offer their names. Current question only resolves no optional text candidates while retaining these tool choices. Initializing Custom writes choices for every existing cell in a shared-model transaction and records initialization. Existing ineligible cells retain their choices after becoming eligible; newly added cells and imported Custom cells without flags inherit true, subject to eligibility. Presets retain stored Custom choices. Changing a preset checkbox seeds from its displayed selection, including any partially fitted Default cell, then applies the change.

Default computes checks from authoritative inclusion; explicit modes show candidate checks plus separate budget feedback. Preview reports, targets and computed checks are never persisted. Merely opening, rendering, selecting or previewing a notebook does not dirty it. Lightweight controls attach above each owning cell's content, aligned with the editor, and reattach through notebook lifecycle signals; the linked AI answer's controls sit above that answer. The current question shows an always-included label in place of an empty context checkbox. Selection still reads the complete model including offscreen cells.

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

Version 0.1.14 exposes **51** explicitly curated functions through `nbinlineai.tools`. The original eleven, eight fastcore file/documentation tools, and new source, inspection, live-cell, web-section, and execution tools share the same named-argument tool loop. `TOOL_FUNCTIONS` is the only built-in registry; importing the package does not offer the functions to a model. `TOOL_GROUPS` groups names for setup helpers. `tool_catalog(group="")` is a plain listing with no `&` declarations. `tools_markdown(names=None, custom=None, group="starter")` and `insert_tools(names=None, custom=None, group="starter")` select the 19-tool starter group by default; explicit names override the group. The 20 combined tool/variable reference limit still applies. See the [tools reference](tools.md) for all exact signatures and bounds.

Kernel-side tools inspect live Python state or saved files, search source, parse documents, make checked text edits, or start bounded subprocesses. Saved-notebook tools require a `.ipynb` file on disk and cannot see unsaved frontend edits. Relative file paths use the **selected kernel's cwd**, which may differ from both the notebook folder and the Jupyter server cwd. Paths are locations, not a sandbox. `search_files` and `search_notebooks` use bounded Python source matching with nested `.gitignore`, `.ignore`, and `.rgignore` rules; regex matching has a hard timeout. `document_outline` reads Markdown headings or Python definitions and issues SHA-256-bound section addresses, which become stale after any file change. Other language outlines are deferred. `source_doc` parses `.py` source without import; `show_doc` with an explicit module imports and runs module initialization. `trace_function` invokes a live function; `run_python` and `run_shell` start separate processes, run with kernel-user permissions, and have 1–20 second timeouts. Their effects are real and are not undone on cancellation. The source and document parsers apply result, file-size, traversal, and time bounds.

Live notebook operations use the original browser document model. In addition to listing, reading, and insertion, 0.1.11 can find and edit ordinary cells by stable ID. Source edits and deletion require an exact expected source or counted match; code edits clear stale outputs. Copy and split create new IDs; existing unrelated metadata is preserved. These actions do not execute cells, save files, or edit paired AI question/answer cells. See [the live interface below](#frontend-requestreply-interface).

### Creating a tool declaration from Python

`insert_tools(names=None, custom=None, group="starter")` is a user helper, separate from the model tools. It formats the same declarations as `tools_markdown()` and requests an ordinary Markdown cell below its calling code cell. It makes no provider request and requires no API key.

The Python helper sends a bounded request through a Jupyter comm. The frontend's native execution wrapper binds the actual outgoing execute-request ID and cell ID to the original notebook model and kernel. A matching comm request can insert the note; later active-cell or tab changes do not redirect it. The frontend acknowledges the inserted cell ID after the live-model change. Several calls in one execution preserve their order. Reexecuting the code deliberately creates fresh notes; rendering saved outputs does not replay an insertion.

The helper returns an asynchronous receipt and does not wait inside the kernel's event loop. An immediate display can therefore say **requested** before the acknowledgement arrives. There is no nested event loop, provider tool loop, or automatic disk save. This bridge only inserts the generated Markdown; it does not expose arbitrary browser operations. Sources: `nbinlineai/kernel_insert_tools.py`, `src/insertTools.ts`, and `src/insertToolsProtocol.ts`.

### Frontend request/reply interface

The kernel describes all registered callables, including the frontend stubs. During inspection, the bridge identifies a special tool by **callable identity** against an explicit registry, not its Python variable name. An imported alias therefore works; a user-defined function with the same name follows normal kernel dispatch. Directly calling a frontend stub in Python raises an explanatory error.

The server creates an unpredictable `run_id` bound to the original session, kernel, and prompt cell. Each action gets a fresh `request_id`. A `frontend_action` SSE event carries those IDs, an allowlisted action name, and bounded arguments. The browser acts on the `NotebookPanel` captured when the prompt started, then sends an authenticated `POST nbinlineai/action-reply` containing the IDs, session/prompt binding, and either a bounded result or an error. The server checks the pending action and current kernel binding before accepting one reply.

The browser supports an allowlist of document operations. Reading operations are `list_cells`, `read_cell`, and `find_cells`. Insertion operations are `insert_markdown` and `insert_code`. The new edit operations are `replace_cell`, `cell_str_replace`, `cell_insert_line`, `cell_replace_lines`, `delete_cell`, `move_cell`, `copy_cell`, `split_cell`, and `merge_cells`. These act on ordinary cells through shared-model transactions with stable IDs and expected-source or match-count checks where relevant. Code-source edits clear outputs and execution count; the model never executes the resulting code.

`url_to_note` is a server-side composition: fetch a bounded public page as Markdown, then request `insert_markdown`. Its network work runs outside the server's event loop. The provider receives insertion success only after the browser acknowledges the new cell ID. This acknowledges a change to the **live model**, not a save to disk.

Actions never use the currently focused tab or cell. The browser validates the original panel, document model, session, prompt, and answer before acting. Stable cell IDs allow reading unsaved cells above or below the prompt, including offscreen cells. A missing target or changed binding fails instead of falling back to the active cell.

By default insertion follows the paired answer; repeated default insertions in that run retain their request order. An explicit `after_cell_id` chooses another existing cell. Notes do not carry AI prompt/output metadata, so later prompts treat them as ordinary Markdown. Insertion does not autofocus, execute, or explicitly save the document. Separate edit actions can replace or delete ordinary cells after their checks pass.

SSE callbacks run sequentially and await reply delivery. The browser deduplicates a request ID within its run, rejecting reuse with changed arguments; the server accepts a reply only once. Timeout, cancellation, disconnect, and completion expire pending action IDs. A disconnected client cannot resume that run. An insertion already applied remains even if its acknowledgement or the rest of the answer is lost; a new prompt run can insert again. There is no rollback or cross-run deduplication.

The interface does not provide general browser execution, arbitrary Jupyter command dispatch, cross-notebook edits, or a Python-to-browser blocking RPC. Context selection and preview use the snapshot builder independently of these mutation transports.

## Settings and credentials

| Data | Stored where |
| --- | --- |
| Prompt and answer text | Cell `source` in the `.ipynb`. |
| Notebook provider, model, style, effort, Keep AI answers | Notebook `metadata.nbinlineai.defaults`. |
| Cell overrides and Keep answer | Prompt-cell `metadata.nbinlineai`. |
| Initial user preferences and custom style wording | JupyterLab user settings. |
| API keys saved through Configure AI | Private per-user configuration file on the machine running Jupyter Server. |
| ChatGPT sign-in | Runtime-owned per-user account state, separate from API keys and notebook metadata. |
| ChatGPT file-access preference | Private per-user extension settings; no browser-supplied filesystem root. Direct native file actions are disabled in this release. |

Effective notebook defaults are captured on first AI use, once a provider is configured. Merely opening an ordinary notebook does not create AI settings. In current Git source, Configure AI's **Defaults** tab holds **Default connection for new notebooks** and the user response style; **Connections & models** holds provider setup, keys, and ChatGPT model and effort. PyPI 0.1.14 has the same controls in one dialog. The setup picker only changes the setup view. An existing notebook's **AI defaults** row or ChatGPT's **Use for this notebook** changes that notebook. Later cells inherit notebook defaults; legacy explicit cell choices remain overrides until reset. A cell's **Notebook default** provider option clears its provider, model, and effort overrides, while **Use notebook defaults** also clears its style override.

For Keep answer, a missing cell value means inheritance; an explicit `true` or `false` remains an override even if the notebook default changes. Existing explicit choices from 0.1.4 are preserved. Resetting model/style overrides does not reset the Keep answer choice.

## Native notebook execution

Version 0.1.5 supplies a JupyterLab `INotebookCellExecutor` provider. It recognizes AI prompt Markdown cells and delegates ordinary cells to JupyterLab's exported executor. This connects AI prompts to native Run All, range execution, and keyboard execution without replacing command IDs or maintaining a separate Shift+Enter interception path.

JupyterLab schedules multiple cell-executor calls concurrently. nbinlineai queues them per notebook so that code, AI responses, and function calls finish in order. A failed or cancelled cell stops later queued work in the same batch; a later batch can run after the previous one drains. Different notebooks have independent queues.

Each AI request snapshots context when its turn executes, so it sees completed or edited earlier answers and the kernel state created by earlier work. Kept answers skip provider calls and do not replay earlier tool side effects. Headless notebook execution does not load this browser plugin and treats these cells as Markdown.

The server publishes the bundled style instructions and model effort capabilities. The frontend sends any chosen custom style wording with a request; the server validates its size and keeps notebook-context instructions separate. FastLLM maps effort to OpenAI `reasoning.effort` or Anthropic `output_config.effort` with adaptive thinking where supported. ChatGPT lists the runtime-supported models available to the connected account and their efforts. An unavailable saved ChatGPT model or effort remains selected and blocks a run rather than silently choosing another.

Saved API keys take precedence over server environment keys. On macOS/Linux, the default file is `~/.config/nbinlineai/credentials.json`; an absolute `XDG_CONFIG_HOME` changes the configuration root. The browser receives availability and key-source information, never the saved key value. Project environments under the same OS account can share the file. See [key storage](manual/saving-and-privacy.md#where-keys-are-stored) for details.

## Processes, event loops, and cancellation

Provider networking and HTTP streaming use the existing asynchronous Jupyter Server loop. API mode uses FastLLM; ChatGPT mode owns a native child process supplied by the installed Python dependency, without requiring a separate student-installed app or CLI. Kernel work travels through Jupyter's normal kernel channels to a separate kernel process. The extension does not call `asyncio.run()` inside the notebook or patch the notebook event loop.

Frontend actions wait on an asynchronous server future while JupyterLab performs the model operation and posts its reply. They do not send a Python execute request that waits for the browser, so the kernel is free during that wait. Ordinary synchronous tools, including `read_url`, occupy the kernel while running; the server-side fetch for `url_to_note` uses a worker thread with bounded network work.

A per-kernel lock serializes the extension's own inspection and tool calls. It does not freeze normal notebook activity for the duration of a model response. Users should avoid changing the relevant kernel state while a tool-using prompt is running.

Closing or cancelling a request cancels the server task and cleans up provider/kernel channels. If an extension operation is actively executing in the kernel, cancellation or timeout can interrupt it. Cancellation cannot undo side effects that already occurred.

The account connection is shared within one Jupyter server, while notebook runs, context, tool allowlists, Keep settings, and execution queues are independent. The original authenticated notebook session supplies its parent folder as **logical location context**. The native engine uses a private working directory; it does not inherit project instructions or gain built-in file, shell, or browser tools. The selected **ChatGPT file access** preference is dormant while those native actions are disabled. Enabled notebook tools still execute through the existing browser/kernel paths with their ordinary Python user permissions and kernel cwd; the preference does not sandbox the kernel. The server resolves the notebook path from its authenticated session and effective ContentsManager root, never a root supplied by notebook metadata or the browser.

## Source map

Paths below are relative to the [source repository](https://github.com/rahuldave/nbinlineai).

| Path | Purpose |
| --- | --- |
| `src/index.ts`, `src/configureAI.ts`, `src/subscriptionSetup.ts` | JupyterLab plugin, compact connection setup, notebook controls, and request lifecycle. |
| `src/context.ts` | Ordered live-model snapshots, including unsaved/offscreen cells. |
| `src/context.ts`, `src/contextControls.ts` | Context policy, saved choices, per-cell controls and authoritative preview lifecycle. |
| `src/frontendActions.ts` | Bounded live notebook operations, insertion order, and action deduplication. |
| `src/sse.ts` | Sequential parsing and awaiting of streamed event callbacks. |
| `src/defaults.ts`, `src/keepAnswer.ts` | Setting inheritance and rerun protection. |
| `src/executionQueue.ts` | Ordered per-notebook execution, batch failure handling, and recovery. |
| `src/codeCopy.ts` | Clipboard controls on rendered code blocks. |
| `schema/plugin.json` | JupyterLab user-settings schema. |
| `nbinlineai/handlers.py` | Authenticated HTTP endpoints and server-sent events. |
| `nbinlineai/prompt.py` | Shared execution/preview preparation, validation, style instructions and provider/tool loop. |
| `nbinlineai/context_selection.py`, `nbinlineai/context_budget.py` | Candidate eligibility/history, below-source labels and shared character accounting. |
| `nbinlineai/providers.py` | FastLLM API adapter. |
| `nbinlineai/backend_registry.py`, `nbinlineai/subscription_runtime.py` | Explicit connection routes and the owned ChatGPT runtime adapter. |
| `nbinlineai/notebook_scope.py`, `nbinlineai/subscription_settings.py` | Authenticated notebook-folder resolution and per-user direct-file preference. |
| `nbinlineai/kernel.py` | Session-bound kernel inspection and execution. |
| `nbinlineai/frontend_bridge.py` | Bound run/action registry, argument/reply validation, and expiring asynchronous waiters. |
| `nbinlineai/tool_schema.py` | Signature-to-tool-schema translation. |
| `nbinlineai/tools.py` | Opt-in tools, frontend callable registry, and Markdown reference helper. |
| `nbinlineai/web_tools.py` | Bounded public-page retrieval and text/Markdown conversion. |
| `nbinlineai/config.py`, `nbinlineai/credentials.py` | Model capabilities, configuration, and key storage. |

Endpoints are relative to the Jupyter Server base URL: `GET nbinlineai/status`, `POST nbinlineai/context-preview`, `POST nbinlineai/prompt`, `POST nbinlineai/action-reply`, `GET/POST nbinlineai/settings/keys`, `DELETE nbinlineai/settings/keys/{backend}`, and the separate authenticated `nbinlineai/subscription/{status,login,login/cancel,disconnect,usage,file-access}` routes. These use Jupyter authentication and kernel-execution authorization; mutating requests also use normal XSRF checks.

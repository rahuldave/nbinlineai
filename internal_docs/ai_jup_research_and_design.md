# AI notebook cells: `ai-jup` research and design notes

Research date: 2026-09-22. Source snapshots: [`ai-jup` `2ac432b`](https://github.com/AnswerDotAI/ai-jup/tree/2ac432b6c7662da0e894272831be9f7f18182901) and [`lisette` `17a9204`](https://github.com/AnswerDotAI/lisette/tree/17a920422782594b9e91201cc6b3f0de7cd7ffbe). This is a design reference for our own implementation, not copied source code.

**Current implementation decision:** [FastLLM and ChatGPT subscription design](fastllm_and_chatgpt_subscription.md) supersedes the Lisette provider proposal below. The ai-jup behavior analysis here remains the reference for notebook semantics.

## Executive findings

- `ai-jup` is a JupyterLab 4 frontend extension plus a Jupyter Server extension. It stores prompt and response cells as ordinary notebook **markdown cells with metadata**, not as a new nbformat cell type.
- It sends the **source of every preceding code cell** to Claude, regardless of whether that cell ran. It also collects preceding images and chart specs, and previous prompt/response pairs. It does **not** send all preceding markdown text, all cell outputs, or the whole kernel namespace. Kernel values are fetched only for variables explicitly named with the <code>$&#96;name&#96;</code> syntax.
- <code>&amp;&#96;name&#96;</code> function references trigger silent introspection in the live Python kernel. The server converts signatures and docstrings into Anthropic tool schemas. If Claude calls a tool, the server executes the named callable in the kernel, returns a result, and calls Claude again.
- The current code uses `anthropic.AsyncAnthropic` directly, **not `claudette`**. Its settings and model list are Claude-specific.
- `lisette` offers a provider-neutral `Chat`/`AsyncChat` interface for API-key models, including OpenAI. Its current repo also has `chatgpt/` models that use Codex cached login through LiteLLM, but its README says Lisette is no longer maintained and recommends `fastllm`. Treat the `chatgpt/` path as an experimental integration point, not a stable authentication contract.
- A ChatGPT Plus/Pro subscription does not turn into a normal OpenAI API key. Official OpenAI documentation supports subscription access through Codex login and documents the Codex SDK/App Server for applications. This requires a **separate backend mode** from OpenAI API-key calls. [Authentication](https://learn.chatgpt.com/docs/auth), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [pricing and plan limits](https://learn.chatgpt.com/docs/pricing).

## Current `ai-jup` execution path

```text
Prompt markdown cell + ai_jup.isPromptCell metadata
  -> JupyterLab command catches Shift+Enter
  -> parse $`name` / &`name`
  -> collect preceding notebook cell models
  -> silently query the live Python kernel for named values/functions
  -> substitute value reprs in prompt; build context object
  -> POST /ai-jup/prompt (model, context, kernel_id, max_steps)
  -> server builds Anthropic system blocks, history, and tool schemas
  -> Anthropic streaming messages -> SSE to frontend
  -> optional tool calls -> same kernel -> tool results -> another Claude call
  -> stream text into a new markdown response cell
```

The frontend request and SSE handling live in [`src/promptModel.ts`](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptModel.ts#L64-L224); the server orchestration is in [`ai_jup/handlers.py`](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L109-L327).

### How it gets cells above the current cell

`PromptCellManager._gatherContext()` takes `activeCellIndex`, then iterates `notebook.model.cells` from index zero up to, but excluding, the active index. Using models instead of rendered widgets matters because JupyterLab may virtualize cell widgets. It concatenates **code cell source** in notebook order with blank lines. For code cells it also reads output MIME bundles for PNG/JPEG/GIF and Vega-Lite/Plotly chart JSON; for markdown cells it checks image attachments. The server adds code and chart specs as text and images as Anthropic image blocks in the system prompt. See [`promptCell.ts` context loop](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptCell.ts#L220-L286), [image/chart extraction](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptCell.ts#L348-L461), and [system prompt assembly](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L446-L561).

Previous AI prompt/response pairs are gathered separately by scanning preceding **widgets** for CSS classes and adjacent output cells, then sent as alternating user/assistant messages. This part is more fragile under windowing than the code-source scan; persistent metadata would be a better source of truth. The previous prompt text is taken from its saved cell source, so `$` references there are not re-resolved when history is rebuilt. See [conversation history scan](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptCell.ts#L289-L346) and [message assembly](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L563-L584).

**Important semantic distinction:** notebook position describes intended context; the running kernel describes actual state. A code cell above the prompt may be unexecuted or stale, while a variable can exist from a cell below it or a deleted cell. `ai-jup` does not reconcile these. Our UI should say what context is being sent and distinguish notebook source from live kernel values.

### How it gets variable values

The parser recognizes only Python identifier tokens in the form <code>$&#96;name&#96;</code> and <code>&amp;&#96;name&#96;</code>. Each name is deduplicated. For every variable name, the frontend sends a silent `kernel.requestExecute` request with `store_history: false`, evaluates the name, and prints JSON containing `type` and **`repr(value)[:500]`**. It captures stdout or `text/plain`, parses the JSON, and substitutes that `repr` into the prompt. The variable metadata is also sent in the context, so its representation appears again in the system prompt. Failed lookups are logged and return `null`; the unresolved reference remains in the prompt. This is a representation, not a lossless serialized value. See [parser/substitution](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptParser.ts#L16-L91), [kernel execution](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/kernelConnector.ts#L35-L88), and [variable introspection](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/kernelConnector.ts#L90-L124).

### How it turns Python functions into tools

For each named function reference, the frontend silently evaluates the callable in the kernel and uses `inspect.signature` and `inspect.getdoc`. It extracts parameters, annotations, defaults, return annotation, and best-effort Google/NumPy-style parameter descriptions. The server maps common Python types (`int`, `float`, `str`, `bool`, `list`, `dict`) to JSON Schema primitive types; unknown annotations fall back to string. Parameters without defaults become required. It passes the resulting `name`, `description`, and `input_schema` to Claude. See [function introspection](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/kernelConnector.ts#L126-L256) and [tool schema conversion](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L586-L634).

On a tool call, the server validates identifier-shaped tool/argument names and checks the tool name against the request's `functions` map. It obtains the Jupyter kernel by `kernel_id`, executes generated Python that looks up `globals()[name]` and invokes it with decoded JSON kwargs, and captures a JSON result from kernel stdout. It can return text, HTML, or an image; the **model** receives text or a placeholder for HTML/image, while the frontend receives the richer result. The server appends Claude `tool_use` and `tool_result` messages and repeats until no call or `max_steps` is reached. The default UI setting is five tool iterations. See [tool execution code](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L21-L106), [tool loop](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L230-L325), and [kernel IOPub collection](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L352-L444).

This is an intentionally narrow, explicit tool surface: a function is exposed only when the prompt mentions it. It is still powerful because the function runs with the user's kernel privileges and can have side effects. The request-supplied allowlist and kernel ID should not be treated as sufficient authorization in our implementation.

### How it calls Claude

The handler checks `ANTHROPIC_API_KEY`, creates `anthropic.AsyncAnthropic`, and calls `client.messages.stream(model=..., max_tokens=4096, system=..., messages=..., tools=...)`. Static base instructions are one Anthropic system text block with an `ephemeral` cache marker; dynamic notebook context is appended in later blocks. The handler forwards text and tool argument deltas as SSE, then streams results after executing tools. See [client and stream call](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L133-L228) and [caching/context blocks](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L463-L561).

`claudette` is absent from the package dependencies and call path; [`pyproject.toml`](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/pyproject.toml#L25-L29) lists `anthropic` and `fastcore`.

### How AI cells and the Jupyter extension are defined

A prompt cell is a normal markdown cell with `metadata.ai_jup.isPromptCell: true`; an output is markdown with `metadata.ai_jup.isOutputCell: true`. Insertion initially creates a cell, converts it to markdown via the shared notebook model, adds an `**AI Prompt:**` prefix, and applies a CSS class. Execution inserts a new markdown output cell and streams text into its source. A “Convert to Cells” button can split fenced code blocks into ordinary code cells. See [prompt metadata/insertion](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptCell.ts#L31-L165), [execution/output](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptCell.ts#L167-L216), and [output cell creation](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptCell.ts#L464-L566).

The JupyterLab extension registers frontend plugins, commands, keyboard bindings (`Shift+Enter`, insert shortcut), toolbar button, palette/menu entries, notebook tracker hook, and a custom cell-type dropdown with “Prompt”. See [`src/index.ts`](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/index.ts#L31-L262) and [dropdown conversion](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/cellTypeSwitcher.tsx#L59-L140). The Python package declares both `_jupyter_labextension_paths()` and `_jupyter_server_extension_points()`, with an auto-enabled server config; the server registers `/ai-jup/prompt`, `/tool-execute`, and `/models`. Hatch/Jupyter builder packages the prebuilt frontend into the Python wheel. See [extension hooks](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/__init__.py#L7-L22), [routes](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L801-L824), [package metadata](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/package.json#L90-L120), and [wheel layout](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/pyproject.toml#L63-L88).

## Design for our implementation

### Keep notebook semantics independent of the model provider

Build one notebook layer that produces a typed snapshot, and pass that snapshot to a backend adapter. Do not put Anthropic/OpenAI message shapes in the notebook layer.

```text
NotebookSnapshot = {
  notebook_id, prompt_cell_id, kernel_id,
  preceding_cells: [{cell_id, index, kind, source, execution_count?}],
  selected_variables: [{name, type, display_text, truncated}],
  selected_tools: [{name, description, parameter_schema}],
  selected_media: [{cell_id, mime_type, payload}],
  conversation_turns: [{prompt_cell_id, response_cell_id, prompt, response}]
}

ExecutionConfig = {backend, auth_mode, model, max_tool_steps, context_limits}
BackendEvent = text_delta | tool_call | tool_result | usage | error | done
```

Use persistent metadata and stable cell IDs for AI prompt/response pairing. Define whether a re-run replaces an answer or adds a version. Keep the source/context snapshot associated with each response so changing earlier cells does not silently rewrite historical meaning. Before sending, show an inspectable summary (cell count, named variables/tools, media size) and enforce size limits. Prefer explicit missing-variable errors to silently passing an unresolved token. These are proposed improvements, not existing `ai-jup` behavior.

### Backend modes and configuration

| Mode | Engine | Authentication | Tool bridge | Status |
| --- | --- | --- | --- | --- |
| `anthropic_api` | FastLLM with Anthropic | `ANTHROPIC_API_KEY` | Our validated kernel tool dispatcher | Baseline parity |
| `openai_api` | FastLLM with OpenAI Responses | `OPENAI_API_KEY`; billed through Platform | Our validated kernel dispatcher | Main OpenAI API mode |
| `openai_codex_subscription` | Local Codex App Server, preferably behind its Python SDK if needed | User signs in to Codex with ChatGPT | Notebook functions via a narrow MCP bridge, or experimental App Server dynamic tools | Separate subscription mode; prototype first |

The current `ai-jup` setting schema has only a Claude model enum, max tool steps, and convert-button flag. Its insertion paths also hard-code a Claude model in cell metadata. We need separate **backend**, **auth mode**, and **model** fields, with models scoped to the selected mode; otherwise a saved Claude model can leak into an OpenAI request. Store secrets outside notebook files and frontend settings. Store a per-cell backend/model override only if the user chooses one; otherwise inherit the current defaults. Keep provider-specific options in a namespaced map and expose supported models/capabilities from the backend rather than a stale hard-coded list. See [existing settings](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/schema/plugin.json#L1-L40), [settings loader](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/settings.ts#L13-L103), and [per-cell model selection](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptCell.ts#L185-L216).

Suggested shape (illustrative, not a committed schema):

```json
{
  "defaultBackend": "openai_api",
  "backends": {
    "anthropic_api": {"model": "<configured Claude model>"},
    "openai_api": {"model": "<configured OpenAI API model>"},
    "openai_codex_subscription": {"model": "<Codex-supported model>"}
  },
  "maxToolSteps": 5,
  "context": {"maxCodeChars": 50000, "maxVariableChars": 2000, "maxImages": 10},
  "toolPolicy": "confirm_side_effects"
}
```

### Where FastLLM fits

FastLLM supplies API-provider completion and tool-call normalization, while our server owns the kernel execution loop. Its automatic chat tool loop would execute ordinary callables in the Jupyter Server process, so we will use the explicit completion/result loop described in [the FastLLM tool bridge](fastllm_and_chatgpt_subscription.md#tool-response-loop). FastLLM's own `codex` vendor reads cached tokens and is excluded from subscription mode.

### ChatGPT subscription mode

Official OpenAI documentation distinguishes **ChatGPT sign-in for subscription access** from **API key sign-in for usage-based billing**. It documents Codex CLI login (`codex login`), local Codex SDKs, and the App Server's account/login and streaming methods. Plus is listed at $20/month and Pro starts at $100/month as of this research date; limits depend on plan, model, and usage, so do not encode a promised number of prompt cells. [Authentication](https://learn.chatgpt.com/docs/auth), [pricing](https://learn.chatgpt.com/docs/pricing), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [App Server authentication](https://learn.chatgpt.com/docs/app-server#auth-endpoints).

Recommended supported path: a **local per-user Codex process/App Server adapter**. Let Codex own the browser/device-code login and credential refresh. The adapter checks account state, starts a thread/turn for a prompt, streams its events into `BackendEvent`, and routes only explicitly selected notebook functions through a limited tool bridge. The App Server documents MCP tools and **experimental** dynamic tools; prototype the dynamic-tool path because it maps closely to `&` functions, with MCP as a fallback if the experimental surface is not suitable. Never read or pass around `~/.codex/auth.json` ourselves. The user should see when Codex rather than API billing is active, and account/rate-limit errors should stay distinct from model errors. [App Server overview](https://learn.chatgpt.com/docs/app-server), [dynamic tools](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental), [authentication state](https://learn.chatgpt.com/docs/app-server#auth-endpoints).

This mode invokes a Codex agent, so prompt formatting, context handling, and tool behavior may differ from FastLLM's direct completion path. Measure that difference in a live notebook prototype before promising identical AI-cell behavior across modes.

Lisette's prior cached-login path is excluded because it reads and patches Codex token storage. The [official App Server sign-in design](fastllm_and_chatgpt_subscription.md#official-chatgpt-subscription-path) replaces it.

### Kernel execution and trust boundary

Implement a single `KernelToolDispatcher` independent of providers. At registration, bind each allowed tool to the authenticated notebook session and kernel, capture its schema, and assign a run-scoped ID. At call time, verify the authenticated user, notebook session, kernel, registered tool name, and JSON arguments **on the server**; do not trust a client-supplied `kernel_id` or `functions` map as authority. Execute kwargs via JSON decoding, not string-concatenated Python literals. Return typed text/HTML/image results with size limits; separate what is shown in the notebook from what is sent back to a model. Preserve cancellation, timeout, and parent Jupyter message IDs. Ask for user approval before functions marked as having side effects if that is our chosen tool policy. These are implementation requirements derived from the existing code path and its trust boundary, not claims that `ai-jup` already does them.

Use Python-kernel capability detection. The `ai-jup` introspection snippets and tool executor are Python-specific; a non-Python kernel should get a clear unsupported-kernel message rather than an opaque model error. Schema generation should handle optional/union/container annotations and signature edge cases more deliberately than `ai-jup`'s primitive mapping. The frontend should not render returned HTML without an explicit sanitization policy.

### Implementation sequence and acceptance checks

1. Build metadata-based prompt/output cells, commands, settings, and a typed snapshot. Verify saved notebooks reopen with the same prompt/output identity and conversation pairing.
2. Implement context collection with explicit source-vs-kernel semantics. Verify an unexecuted preceding code cell is labeled as source, a missing `$` name is reported, a cell below the prompt is excluded from source context, and windowed notebooks still retain history.
3. Implement Python introspection, schema generation, and a session-bound kernel dispatcher. Verify defaults/annotations, sequential multi-tool calls, malformed args, wrong kernel/user, timeouts, and rich outputs.
4. Implement `anthropic_api` and `openai_api` adapters that emit the same event stream. Use FastLLM behind each adapter and pin a known version. Verify streaming text, tool calls, images, cancel, errors, and per-cell model overrides.
5. Prototype `openai_codex_subscription` through the official Codex App Server/SDK. Verify ChatGPT login, a normal prompt, tool bridge behavior, streaming, usage-limit handling, and logout without reading stored tokens directly.
6. Confirm packaging as one installable Python/JupyterLab extension, then run a live JupyterLab notebook test across reload and kernel restart.

## Licensing boundary

The upstream [`ai-jup` README](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/README.md#L1-L8) and [`LICENSE`](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/LICENSE) identify GPL-3.0, while some package metadata still says MIT. Treat GPL-3.0 as the operative notice and get a licensing review before copying or adapting source. This document describes behavior and proposes an independent design. Lisette declares Apache-2.0 in its [package metadata](https://github.com/AnswerDotAI/lisette/blob/17a920422782594b9e91201cc6b3f0de7cd7ffbe/pyproject.toml#L5-L16).

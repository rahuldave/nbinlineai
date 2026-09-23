---
title: Architecture
---

# Architecture

This describes the API-based implementation in nbinlineai 0.1.4. For everyday use and screenshots, see the [user guide](user-guide.md).

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
```

| Component | Responsibilities |
| --- | --- |
| JupyterLab frontend | Add prompt controls, read the notebook model, resolve settings, intercept AI execution, and update the answer cell. |
| Python server extension | Authenticate requests, validate inputs, construct context, read credentials, call the provider, and coordinate tool rounds. |
| Notebook kernel | Retrieve explicitly referenced live values, inspect function signatures, and execute allowed functions. |
| FastLLM | Adapt a common message/tool representation to provider APIs and stream their responses. |

The frontend is a prebuilt JupyterLab 4 extension bundled in the Python package. Students do not need Node.js. The same package registers a Jupyter Server extension; this is why installation and upgrades require a **whole-server restart**.

## An AI cell is a Markdown cell

There is no new notebook cell type or cell magic. A prompt is a standard Markdown cell with `metadata.nbinlineai.isPromptCell`. Its answer is another Markdown cell with `isOutputCell`, `promptCellId`, and run status. The answer text lives in `source`, not in a code cell's `outputs` array.

This keeps the notebook readable without the extension. The stored link lets a rerun replace the paired answer. Copy buttons are frontend decoration and do not alter the saved Markdown. The notebook does not contain a separate structured transcript of tool calls.

## One prompt request

1. The frontend checks **Keep answer**. A completed, nonempty paired answer is protected unless the user has turned this off; protected Shift+Enter advances without an API request.
2. It resolves cell overrides over notebook defaults over user preferences. It snapshots the current prompt, cells above it, the notebook session ID, and the effective settings.
3. The server validates the request and resolves the session to its existing Python kernel.
4. Explicit variable references are read from the kernel and substituted into the current prompt. Explicit function references become the tool allowlist for this request.
5. The server assembles bounded notebook source, completed earlier conversations, the current question, and the selected style instructions.
6. FastLLM calls the selected provider. Text events stream back to the answer cell. If the model requests a tool, the server validates and runs it in the same kernel, appends its result, and continues the model conversation.
7. The frontend marks the answer completed, failed, or cancelled. Saving the notebook preserves the text and metadata.

The server disables automatic provider retries: silently repeating a request that can call functions could repeat a side effect. A user-initiated rerun is a new request.

## Context and live state

The browser sends cells **above the prompt in notebook order**. The server includes code and ordinary Markdown source in one bounded source context. Earlier completed AI prompt/answer pairs become conversational messages, rather than being duplicated as ordinary Markdown.

The source snapshot excludes later cells, code outputs, raw-cell content, image pixels, and automatic file contents. Linked pages are not fetched. The [user guide](user-guide.md#9-troubleshooting-and-limits) lists all size and round limits.

Live state is separate. A variable can come from a cell executed below the prompt or out of order. The extension reads `get_ipython().user_ns` in the running kernel, not a value inferred from the displayed source. A variable reference sends a bounded `repr` string; arbitrary objects are not serialized to the provider.

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

## Settings and credentials

| Data | Stored where |
| --- | --- |
| Prompt and answer text | Cell `source` in the `.ipynb`. |
| Notebook provider, model, style, effort | Notebook `metadata.nbinlineai.defaults`. |
| Cell overrides and Keep answer | Prompt-cell `metadata.nbinlineai`. |
| Initial user preferences and custom style wording | JupyterLab user settings. |
| API keys saved through Configure AI | Private per-user configuration file on the machine running Jupyter Server. |

Effective notebook defaults are captured on first AI use, once a provider is configured. Merely opening an ordinary notebook does not create AI settings. Later cells inherit notebook defaults; legacy explicit cell choices remain overrides until reset.

The server publishes the bundled style instructions and known model effort capabilities. The frontend sends any chosen custom style wording with a request; the server validates its size and keeps notebook-context instructions separate. FastLLM maps effort to OpenAI `reasoning.effort` or Anthropic `output_config.effort` with adaptive thinking where supported. Unknown models use their provider's default rather than an inferred effort schema.

Saved API keys take precedence over server environment keys. On macOS/Linux, the default file is `~/.config/nbinlineai/credentials.json`; an absolute `XDG_CONFIG_HOME` changes the configuration root. The browser receives availability and key-source information, never the saved key value. Project environments under the same OS account can share the file. See [key storage](user-guide.md#7-where-keys-are-stored) for details.

## Processes, event loops, and cancellation

Provider networking and HTTP streaming use the existing asynchronous Jupyter Server loop. Kernel work travels through Jupyter's normal kernel channels to a separate kernel process. The extension does not call `asyncio.run()` inside the notebook or patch the notebook event loop. No separate AI daemon, Codex CLI, or Codex app server is required for the API mode.

A per-kernel lock serializes the extension's own inspection and tool calls. It does not freeze normal notebook activity for the duration of a model response. Users should avoid changing the relevant kernel state while a tool-using prompt is running.

Closing or cancelling a request cancels the server task and cleans up provider/kernel channels. If an extension operation is actively executing in the kernel, cancellation or timeout can interrupt it. Cancellation cannot undo side effects that already occurred.

ChatGPT subscription sign-in is a future transport/authentication feature, not implemented through these API-key routes.

## Source map

Paths below are relative to the [source repository](https://github.com/rahuldave/nbinlineai).

| Path | Purpose |
| --- | --- |
| `src/index.ts` | JupyterLab plugin, notebook controls, settings dialog, request lifecycle. |
| `src/defaults.ts`, `src/keepAnswer.ts` | Setting inheritance and rerun protection. |
| `src/codeCopy.ts` | Clipboard controls on rendered code blocks. |
| `schema/plugin.json` | JupyterLab user-settings schema. |
| `nbinlineai/handlers.py` | Authenticated HTTP endpoints and server-sent events. |
| `nbinlineai/prompt.py` | Validation, context, style instructions, provider/tool loop. |
| `nbinlineai/providers.py` | FastLLM API adapter. |
| `nbinlineai/kernel.py` | Session-bound kernel inspection and execution. |
| `nbinlineai/tool_schema.py` | Signature-to-tool-schema translation. |
| `nbinlineai/config.py`, `nbinlineai/credentials.py` | Model capabilities, configuration, and key storage. |

Endpoints are relative to the Jupyter Server base URL: `GET nbinlineai/status`, `POST nbinlineai/prompt`, `GET/POST nbinlineai/settings/keys`, and `DELETE nbinlineai/settings/keys/{backend}`. These use Jupyter authentication and kernel-execution authorization.

# FastLLM tool bridge and ChatGPT subscription sign-in

Research date: 2026-09-22. Examined [`ai-jup` at `2ac432b`](https://github.com/AnswerDotAI/ai-jup/tree/2ac432b6c7662da0e894272831be9f7f18182901) and [`fastllm` at `78ca64c`](https://github.com/AnswerDotAI/fastllm/tree/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea). This note updates the provider choice in [the original ai-jup analysis](ai_jup_research_and_design.md): use FastLLM for API-backed Claude and OpenAI, not Lisette. The checked-in extension currently implements prompt-cell insertion and schema translation; it does **not** yet execute prompts or offer sign-in.

## Decision

Use three distinct backends:

| Backend | Engine | Credential source | Billing/access |
| --- | --- | --- | --- |
| `anthropic_api` | FastLLM, Anthropic vendor | `ANTHROPIC_API_KEY` | Anthropic API |
| `openai_api` | FastLLM, OpenAI Responses vendor | `OPENAI_API_KEY` | OpenAI Platform API |
| `openai_codex_subscription` | Official Codex App Server | Codex-managed ChatGPT login | Available ChatGPT/Codex plan entitlement |

FastLLM is appropriate for the first two rows because it normalizes model completions, messages and tool calls across providers. Its own `codex` vendor is **not** the subscription implementation we want: [`fastllm/acomplete.py`](https://github.com/AnswerDotAI/fastllm/blob/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea/fastllm/acomplete.py#L25-L94) points to `chatgpt.com/backend-api/codex` and reads `~/.codex/auth.json`; [`fastllm/codex.py`](https://github.com/AnswerDotAI/fastllm/blob/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea/fastllm/codex.py#L80-L88) also handles tokens itself. Do not select `codex/...` in our FastLLM adapter. Lisette's similar cached-login patch is excluded for the same reason.

OpenAI [distinguishes ChatGPT sign-in from API-key billing](https://learn.chatgpt.com/docs/auth). Subscription mode is a Codex agent integration, not a general ChatGPT model API. Model availability, plan limits and exact agent behavior must be verified in a live prototype.

## ai-jup's exact tool contract

1. Prompt text explicitly names tools as <code>&amp;&#96;function_name&#96;</code>. The parser does not expose the whole kernel namespace. [`promptParser.ts`](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/promptParser.ts#L16-L91)
2. The frontend sends a silent kernel request that calls `inspect.signature`/`inspect.getdoc` and returns `docstring` plus an ordered `parameters` map. Each parameter has a string type and description; a `default` key means it is optional. [`kernelConnector.ts`](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/src/kernelConnector.ts#L126-L256)
3. The server maps `int/float/str/bool/list/dict` and some typing forms to JSON Schema primitives. An unknown annotation becomes `string`. It emits Anthropic `{name, description, input_schema:{type:"object",properties,required}}`. A parameter is required exactly when the `default` key is absent. [`handlers.py`](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L586-L634)
4. On each Claude `tool_use`, the server checks the name against the prompt's selected functions, validates identifier-shaped argument names, calls the function in the Jupyter kernel with JSON-decoded kwargs, appends Anthropic `tool_result`, and calls Claude again. It executes multiple calls sequentially. [`handlers.py` tool loop](https://github.com/AnswerDotAI/ai-jup/blob/2ac432b6c7662da0e894272831be9f7f18182901/ai_jup/handlers.py#L230-L325)

Example introspection and translated tool:

```json
{
  "function_name": "revenue",
  "info": {
    "docstring": "Calculate revenue.",
    "parameters": {
      "units": {"type": "int", "description": "Number of units"},
      "price": {"type": "float", "description": "Unit price"},
      "discount": {"type": "float", "description": "Discount", "default": "0.0"}
    }
  },
  "fastllm_tool": {
    "type": "function",
    "name": "revenue",
    "description": "Calculate revenue.",
    "parameters": {
      "type": "object",
      "properties": {
        "units": {"type": "integer", "description": "Number of units"},
        "price": {"type": "number", "description": "Unit price"},
        "discount": {"type": "number", "description": "Discount"}
      },
      "required": ["units", "price"]
    },
    "strict": false
  }
}
```

The implementation is [`nbinlineai/tool_schema.py`](../nbinlineai/tool_schema.py). FastLLM's [`fn_schema`](https://github.com/AnswerDotAI/fastllm/blob/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea/fastllm/types.py#L96-L103) accepts this flat tool shape. Its [Anthropic adapter](https://github.com/AnswerDotAI/fastllm/blob/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea/fastllm/anthropic.py#L213-L221) converts `parameters` to `input_schema`; [OpenAI Chat](https://github.com/AnswerDotAI/fastllm/blob/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea/fastllm/openai_chat.py#L133-L144) nests the function and preserves `strict`; [OpenAI Responses](https://github.com/AnswerDotAI/fastllm/blob/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea/fastllm/openai_responses.py#L173-L183) passes this native flat shape through. FastLLM's README illustrates a nested Chat-style tool, which also works, but its Responses conversion drops top-level `strict` for that shape. The flat shape is intentional.

OpenAI [strict function calling](https://developers.openai.com/api/docs/guides/function-calling#strict-mode) requires `additionalProperties:false` and every property to appear in `required`; optional arguments need a different nullable representation. Setting `strict:false` preserves ai-jup's omitted-default semantics for now. The dispatcher must still validate the returned arguments before kernel execution. A later strict-schema redesign should explicitly handle defaults, unions, arbitrary kwargs, and nested types.

### Tool response loop

Use FastLLM `acomplete` with the selected tools, inspect `Completion.tool_calls` (`id`, `name`, `arguments`, `server`), and append `Completion.message` followed by `aidialog.msg_parts.mk_tool_res_msg(tool_calls, results)` before another `acomplete` call, as shown in the [FastLLM README](https://github.com/AnswerDotAI/fastllm/blob/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea/README.md). Preserve each call ID. The server must reject any tool not registered for this run, even if a model returns a well-formed name. Execute calls serially through the one kernel, cap rounds with `maxToolSteps`, and emit one frontend event format for both API providers. FastLLM `AsyncChat` can automatically invoke local Python callables in the **Jupyter Server process**, which is the wrong process for user notebook functions; use the explicit loop or a carefully bound kernel proxy. [`fastllm/chat.py`](https://github.com/AnswerDotAI/fastllm/blob/78ca64c3daed288e7d0bc6b6e5d3fab7d80852ea/fastllm/chat.py#L321-L325)

The live tool dispatcher also needs a server-owned run allowlist and notebook/kernel binding, JSON argument checks, cancellation, timeouts, result size limits and sanitized rich output. This is implementation work still to do; schema conversion alone does not provide an executable tool.

## Official ChatGPT subscription path

Use [Codex App Server](https://learn.chatgpt.com/docs/app-server) as a local per-user process reached through the Jupyter Server backend. The [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) is an alternative for basic thread/turn control, but the App Server protocol is likely needed for dynamic tools and sign-in UX.

1. Start App Server with user-specific state and initialize the protocol. The Jupyter UI should never see access or refresh tokens.
2. On **Sign in with ChatGPT**, call `account/login/start` with `type:"chatgpt"` and open the returned `authUrl`. Offer `type:"chatgptDeviceCode"` if a browser callback does not work; show `verificationUrl` and `userCode`. Wait for `account/login/completed`, then read `account/updated`/`account/read` to confirm `authMode:"chatgpt"`. Do not silently accept `authMode:"apikey"` as subscription billing. [Official auth flow](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
3. Start a thread and turn with the notebook snapshot rendered as bounded input; map streamed item/text/turn events into the same frontend response format as API mode. Read `account/rateLimits/read` for limit status. Do not promise a fixed number of prompt cells per plan. [Thread/turn protocol](https://learn.chatgpt.com/docs/app-server), [rate-limit fields](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
4. Prototype `dynamicTools` on `thread/start` for the explicitly named <code>&amp;&#96;function&#96;</code> set. This requires `capabilities.experimentalApi = true`; App Server sends `item/tool/call` to the client, which can invoke the same validated kernel dispatcher and return content. The API is [explicitly experimental](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental), so keep it behind the subscription adapter and test an MCP server bridge if it cannot meet our needs. This schema is a separate App Server mapping, not a FastLLM tool schema.
5. Provide account state, logout and clear failure states in the UI. Isolate Codex state by Jupyter user on multi-user deployments; a shared server-wide login would allow account crossover.

Do not call undocumented ChatGPT web endpoints, copy `auth.json`, patch an authenticator, or ask users for browser cookies. Codex owns credential storage and refresh. A live prototype must verify whether App Server dynamic tools can carry the full notebook function contract, whether a Codex agent is acceptable for solveit-like cells, and whether JupyterHub deployment can run one Codex process per user.

### Installing and running App Server

`codex app-server` is a mode of the **Codex CLI binary**, not a Python package inside `uv`. Official [Codex installation instructions](https://github.com/openai/codex/blob/main/README.md#quickstart) offer a standalone installer, `npm install -g @openai/codex`, and `brew install --cask codex`. Our `uv` environment should install the Jupyter/Python extension and FastLLM only. Document Codex CLI as an optional external prerequisite for `openai_codex_subscription`, detect the executable at runtime, check `codex --version`, and show an actionable missing/broken-binary message. Support an explicit `codexExecutable` server-side path for deployments whose Jupyter process has a different `PATH`; do not put this path in notebook metadata. Version-check against the App Server protocol used by the adapter and regenerate its JSON schema for the chosen CLI version (`codex app-server generate-json-schema`). Do not silently install or upgrade a global binary from the Jupyter UI.

Preferred topology:

```text
JupyterLab browser UI
    │ authenticated HTTP/SSE or WebSocket via Jupyter Server
    ▼
Jupyter Server Python process (one per user in JupyterHub)
    ├─ FastLLM API adapters (async network I/O)
    ├─ Jupyter kernel client ──► separate Python kernel process
    └─ async subprocess pipes ──► codex app-server (separate OS process)
                                    └─ Codex-managed ChatGPT login/state
```

Spawn **one App Server child per Jupyter Server user**, lazily on first subscription use, and multiplex notebook-specific threads through it. Use the default `stdio` JSONL transport, not an exposed localhost port: the [protocol documentation](https://learn.chatgpt.com/docs/app-server#protocol) calls stdio the default, while TCP WebSocket listening is experimental and unsupported. This also avoids assigning a port per notebook. On server shutdown, close pipes, wait briefly, then terminate the child; detect unexpected exits and restart only after invalidating pending request IDs. A multi-user deployment with one shared Jupyter Server process would need an explicit per-user process manager and separate Codex state directories before subscription mode can be offered safely.

The Jupyter Server extension should own an async protocol client with **one stdout reader task**, a request-ID-to-future map, a serialized stdin writer, and a notification queue partitioned by thread/turn. Dynamic tool calls arrive as server-initiated requests on that same reader; dispatch them to the bound kernel asynchronously and send the matching response ID. Bound queues, timeouts, disconnect cleanup, child health checks, and request cancellation keep one hung cell from exhausting the server. A single reader is essential: separate handlers reading stdout would race and misroute messages.

There is no inherent event-loop clash. Current Tornado, which Jupyter Server uses, [wraps the Python `asyncio` loop](https://www.tornadoweb.org/en/stable/ioloop.html); async Jupyter handlers can await `asyncio.create_subprocess_exec`, pipe reads, FastLLM network calls, and kernel-client futures on that running loop. The Codex child runs its **own** process and runtime; the browser runs JavaScript on its own event loop; the notebook kernel is also separate. Never call `asyncio.run()` or block with `subprocess.run()`, `readline()` on a synchronous pipe, or a CPU-heavy schema conversion inside an active request handler. Create the child and background reader from the running Jupyter Server loop, not during Python module import. Test clean shutdown and server restart, because those lifecycle edges are more likely to fail than loop interoperability. [App Server stdio example](https://learn.chatgpt.com/docs/app-server#getting-started)

For local JupyterLab, browser login can open App Server's `authUrl`. For a remote JupyterHub, the callback URL points to the server host's localhost and may be unreachable from the user's browser; start with the documented `chatgptDeviceCode` flow there. Check that the site's outbound auth endpoints and Codex process launch policy permit this mode. A JupyterHub spawner can install the CLI in the user image or container and use its normal per-user server/process isolation.

## Packaging and current milestone

This repository uses `uv` for Python dependency locking/building and JupyterLab's `jlpm` for the TypeScript bundle. The wheel includes a prebuilt frontend, settings schema, server auto-enable config, and Python extension entry points. `python-fastllm==0.0.63` is the current pinned-by-lock API dependency; the package requires Python 3.11 or newer through its transitive dependencies. Run the build/extension checks in the README when changing packaging.

The current UI inserts metadata-backed markdown prompt cells and displays a toolbar/palette command. It does not yet intercept Shift+Enter, collect notebook context, call models, execute tools or sign in. Those are the next runtime milestone, driven by the contract above.

# ChatGPT subscription runtime gate and implementation record

Checked 2026-09-24 against packaged `openai-codex==0.156.1` and
`openai-codex-cli-bin==0.156.1`. The [integration specification](chatgpt_subscription_integration.md)
was revised during implementation: Codex may make internal inference/recovery
requests inside a turn. The 64,000-character estimate applies to each
**host-assembled submitted notebook round**, and `maxToolSteps` counts only
notebook tool-plan groups. The notebook host still owns context selection,
declared tool execution, results, cancellation, and per-notebook binding.
Native Codex tools and ambient project instructions remain forbidden.
Version 0.1.13 archives were accepted by PyPI. Public project metadata and
both downloaded SHA-256 hashes match the locally audited artifacts; The packaged source and an unpackaged helper fix are pushed to main;
the annotated release tag and live documentation site were verified.

## Supported isolation and actual wire evidence

The public [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents `model_catalog_json`. The pinned
[config loader](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/src/config/mod.rs)
and [models manager](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/models-manager/src/manager.rs)
load that catalog as the authoritative descriptors. A one-model override was
returned by `model/list`. The pinned schema/source define descriptor fields
`apply_patch_tool_type`, `experimental_supported_tools`, `tool_mode`,
`multi_agent_version`, and `supports_search_tool`; the runtime pins them to
`null`, `[]`, `direct`, `null`, and `false`, respectively. Known feature/config
flags additionally disable shell, unified exec, apps, plugins, multi-agent,
plan, image, search, goals, skills, MCP, environment, permission, and other
automatic instruction sources. `environments:[]` and `dynamicTools:[]` close
the per-thread surfaces. `tool_mode="direct"` prevents code-mode `exec`/`wait`
metadata even when top-level tools are empty.

The [credential-free actual-wire probe](../scripts/subscription_tool_inventory_probe.py)
starts the packaged binary in isolated state, using a local synthetic Responses
server and dummy key. It asserts the first model request has top-level
`tools=[]`, an empty embedded code-mode tool namespace, exactly the expected
developer/developer/user inputs, no project instruction sources, and no
poisoned project configuration marker. Clean structured answer, refusal,
and tool-plan responses each returned one matching `agentMessage`. The six
currently offered compatible model slugs (`gpt-6-astra`, `gpt-6-sol`,
`gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`) passed this
inventory framing probe on macOS arm64. Other bundled models are excluded
until their distinct prompt framing is checked.

The structured `kind=refusal` case is a preserved notebook refusal. A separate
synthetic provider-native Responses `content.type="refusal"` item did **not**
produce an App Server assistant message or raw refusal notification in pinned
0.156.1; the adapter consequently reports a missing structured answer,
never success. If a future runtime exposes a raw refusal event, the adapter
maps an explicit bounded reason to a notebook refusal. This distinction was
tested without a harmful prompt or live subscription request.

An adversarial mock returned an undeclared `apply_patch` custom tool call
despite `tools=[]`. The runtime did **not** edit its synthetic file; it
recorded an unknown-tool error and made a second internal Responses request.
This was a blocker under the original one-request-per-round requirement.
Under the user's revised contract the extra internal request is accepted;
the production adapter still fails closed if a raw native-call event arrives.
The pinned request builder advertises `tool_choice:"auto"`; App Server has no
public client-acknowledged pause before internal continuation. The negative
probe therefore remains important regression evidence, not a guarantee that
the host can interrupt before an internal retry. It verifies no native tool
effect in this tested configuration. See the
[pinned turn loop](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/src/session/turn.rs#L537)
and [App Server interface](https://learn.chatgpt.com/docs/app-server).

## Production adapter boundary

[`subscription_runtime.py`](../nbinlineai/subscription_runtime.py) owns a
private per-user managed Codex state directory and a narrow stdio JSON-RPC
client for the packaged executable. It never reads or copies an existing
`auth.json`, never inherits API keys, access-token, workload-identity,
custom-endpoint, plugin, or desktop-host environment variables, and rejects
managed `config.toml`/`requirements.toml`. It selects official
`modelProvider="openai"` and requires public `account/read` mode `chatgpt`
before model turns. There is no API-key or ACP fallback. Browser/device sign-in
uses App Server's account methods and only returns public URL/code fields.
Disconnect detaches this Jupyter server in memory and closes **its own**
children without global logout; explicit successful sign-in reconnects.
Account, model, effort, usage, and run identity are rechecked for every round.
Provider payloads and credential contents are never sent to UI errors.
An `unauthorized` turn event changes this server's state to actionable
`expired` until fresh successful sign-in; a cached account record alone does
not silently restore execution.

The child process and ephemeral thread use the private managed directory as
their real cwd. This is deliberate: a notebook/project cwd would allow a
project `.codex/config.toml` to override the official provider or load hooks,
MCP, or instructions before a turn. The authenticated notebook parent and
selected file-access root are supplied only as budgeted, inert context to the
model. Direct native file operations remain disabled, so the UI truthfully
shows **Notebook tools only**. Existing notebook-declared Python/kernel tools
retain their existing live kernel cwd and user permissions; the runtime's cwd
does not move that kernel. No direct-file selector is claimed as active.

Each host round gets a fresh ephemeral thread and child. The host serializes
normalized messages and declared schemas into one JSON text input; App Server
receives a strict answer/refusal/one-tool-group output schema. Returned plans
are validated against the host-declared tool names, argument objects, unique
call IDs, count, and size. The host executes notebook tools and builds any
later round with results; the runtime never executes those tools. Server
approval requests are rejected. Raw native-call events fail closed.
Per-run cancellation closes only that round's child; concurrent cancellation,
disconnect, and final cleanup are serialized. Owned child processes have
bounded wait, terminate, and kill cleanup. The Jupyter extension's awaited
shutdown hook calls `close()`; it does not sign out other clients.
On Windows, Jupyter Server changes Tornado's loop to Selector, which cannot
spawn asyncio subprocesses. A private Proactor worker loop owns only this
subscription manager's child processes and RPC queues; Jupyter's global loop
policy is unchanged. Dispatch/close are synchronized; active rounds, including
ones canceled during preflight, finish their cleanup before worker shutdown.
The platform check applies Jupyter Server's actual loop-policy patch.

`round_wire_cost(messages, tools)` uses the exact shared JSON serializer for
instructions, normalized messages, tool schemas, and output schema, including
the second escaping layer. It adds a conservative 4,096-character reserve for
the two App Server JSON-RPC envelopes, runtime thread ID, model, effort, and
control metadata that the context builder cannot know at preview time. Before
`turn/start`, the adapter measures the actual combined `thread/start` and
`turn/start` envelopes and rejects a round above either the reserved estimate
or 64,000 characters. This is a character estimate of **host-submitted**
material, not a tokenizer bound or a limit on Codex-internal continuation
requests. The server-provided notebook folder is included in the budgeted
host system message; completed tool groups are reserialized, not re-executed.

## Verification and remaining acceptance

Deterministic runtime tests cover structured answer/refusal/tool plans and
invalid calls, poisoned inherited environment and project configuration,
strict private state, no-auth account/model/usage responses, official provider
and ephemeral no-environment thread request, sibling run cancellation,
simultaneous close, Disconnect persistence, login completion/cancel, usage
limit, and safe expired-auth notification mapping. These tests use a fake
stdio child and no credentials. Local focused result: **9/9 passed** across
runtime and Windows worker lifecycle tests; Ruff passed. The parent integration
run passed **260 Python tests**. A production no-auth smoke on fresh private
state started packaged 0.156.1, returned `signed_out` with no models, and
confirmed owned child shutdown. [`subscription_platform_check.py`](../scripts/subscription_platform_check.py)
repeats that smoke in a Tornado loop. The
[cross-platform workflow](../.github/workflows/subscription-runtime.yml)
adds credential-free packaged startup, fake-protocol tests, and actual
empty-inventory synthetic round on macOS/Linux/Windows x64/arm64 and Alpine
musl x64/arm64. The final main/tag code
[CI run 36033921756](https://github.com/rahuldave/nbinlineai/actions/runs/36033921756)
passed all 14 jobs at checked source commit `e389376`: six hosted OS/arch
combinations on both Python 3.12 and 3.14, plus two Alpine musl architectures
on Python 3.12. This exercised packaged startup/shutdown under Tornado,
deterministic RPC and Windows worker lifecycle tests, and actual empty
native-tool inventory. It did not launch a full Windows Jupyter Server with
a kernel; the Windows probe reproduces its Selector policy. The local
assistant-role refusal guard passed the 9 focused
tests but was not in this CI run. Python 3.12 and 3.14 wheel-only
dependency resolution passed all eight target environments independently.
The first CI run found the lock's `argon2-cffi-bindings==26.1.0` lacked a
macOS Intel wheel. A macOS Intel-only `<26.1.0` bound now selects 25.1.0
while other supported platforms keep 26.1.0; both releases vendor the same
Argon2 source commit according to the
[upstream changelog](https://github.com/hynek/argon2-cffi-bindings/blob/main/CHANGELOG.md).
A cold Python 3.14 macOS arm64 wheel-only dependency install also passed
(112 packages, SDK/runtime 0.156.1). The observed 12.67-second install time
depends on this machine and network and is not a support promise.

Two earlier small synthetic live turns used an existing public account
reported as `chatgpt`, before the sanitized-catalog production path. One
timed out in an event collector; the other demonstrated a native `fileChange`
under ordinary runtime settings and timed out waiting for completion. The
file was synthetic and temporary; owned processes were stopped and temporary
folders removed. Those attempts may have used subscription allowance. The
effective provider/billing route was not captured, so they are **not** a
verified subscription billing trace. No intentional paid API test occurred.
The corrected no-turn probe confirmed public account mode, official provider,
ephemeral thread, and no instruction sources but submitted no new model turn.
Our scripts did not open or copy auth JSON, browser tokens, or personal
notebooks; the packaged runtime used its ordinary account boundary.

The later [opt-in live acceptance harness](../scripts/subscription_live_smoke.py)
**passed** on local macOS arm64 using a fresh private store, the production
subscription manager, device-code sign-in completed in Safari, and a synthetic
notebook with a real isolated JupyterLab/kernel. Public status confirmed a
configured ChatGPT account with at least one discovered model. The browser
submitted exactly three subscription prompt requests, with a hard cap of one
notebook-tool group per question. The model used a declared `add_one` kernel
tool once; the kernel counter confirmed the effect occurred exactly once. A
`read_cell` result contained an unsaved live source line while the saved file
still held a different marker. Native Shift+Enter Keep did not replay the
completed question or change its kernel effect. A running third question was
cancelled and showed Cancelled. The harness rejected any API-backend browser
request and replaced the paid API completion function with a hard failure, so
this acceptance path had no API fallback. The driver exited successfully and
stopped its owned isolated server. It did not expose login codes, tokens, or
provider response contents in the recorded result.

This live run validates one local account, one available model, and the stated
notebook path; it does not establish every account quota state, every model,
cross-platform **account-backed** behavior, or provider-native refusal
delivery. Structured `kind=refusal` and native-refusal failure handling remain
deterministic tests as described above. The checked wheel and source archive
were built and accepted by PyPI. Strict Twine/archive checks, an isolated
Python 3.14 clean-wheel installation, both extension-discovery checks, and
packaged quickstart UI without a model turn passed. Public project metadata,
README rendering, and both download hashes were verified. The pushed annotated release tag and live site were verified; see
[the release record](releasing.md).

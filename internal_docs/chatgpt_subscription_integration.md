# Implementation spec: ChatGPT subscription access

Reviewed **2026-09-24**. **0.1.13 implementation in progress; not shipped.**
Version 0.1.12 is already published and must not be reused. PyPI remains 0.1.12
until the 0.1.13 release checklist succeeds. The
[implementation task prompt](chatgpt_subscription_task_prompt.md) records the
active contract and acceptance work. The earlier strict one-model-request gate
and its evidence remain in the [runtime gate record](chatgpt_subscription_gate.md),
but the user explicitly revised that contract: Codex internal inference and
recovery calls are allowed after each bounded host submission.
This document supersedes the subscription proposal in
[the earlier FastLLM note](fastllm_and_chatgpt_subscription.md), while retaining
its decision to keep API transport in FastLLM.

## Product decision

Add **ChatGPT subscription** as a separate connection alongside **OpenAI API**
and **Anthropic API**. Use the official Codex App Server behind Jupyter Server.
The user signs in with ChatGPT; nbinlineai never treats that login as an API key.
Use the official Python **`openai-codex` SDK**, whose published builds include
a pinned native runtime dependency. An owned App Server protocol client controls
the local runtime where the high-level SDK lacks the needed methods;
students do not separately install the Codex CLI or desktop app. This replaces
the earlier idea of building our own runtime downloader. See
[the current Python SDK documentation](https://learn.chatgpt.com/docs/codex-sdk#python-library).
The same notebook question/answer interface should work with each connection.
**nbinlineai/the notebook remains the harness. No ACP is used.** The SDK/App
Server supplies subscription-backed execution, not a replacement conversation
owner or an independent autonomous project agent. ACP appears in the research
only as Jupyter AI prior art.
Preserve existing API selections and credentials. Never silently fall back from
subscription access to a paid API request, including when only an API backend
is currently available.

This is access through Codex with ChatGPT entitlement, not a general API to the
ChatGPT website, its conversation history, or every model in its picker.
OpenAI documents subscription sign-in separately from API billing in
[Authentication](https://learn.chatgpt.com/docs/auth). Its current
[pricing page](https://learn.chatgpt.com/docs/pricing) lists Pro starting at
$100/month; included usage is limited, and available ChatGPT credits may cover
additional usage. Do not promise unlimited or always-free requests. Read actual
account/model availability; do not infer a plan or model from its price.

### Required outcome and non-goals

A student installs nbinlineai in the Jupyter Server environment, chooses
**ChatGPT subscription**, signs in on OpenAI's page and runs inline AI questions
using that account's Codex entitlement. Existing OpenAI/Anthropic API notebooks
continue working. No separate Codex install, desktop app, Node installation,
terminal command, API key or credential-file manipulation is required.

Do not add Claude subscription support, ChatGPT website automation, a generic
OAuth-to-API proxy, Jupyter AI/ACP as a required dependency, or a whole-kernel
sandbox in this release. Keep future backends possible through the provider
registry. The source integration is in progress; this document does not claim
the 0.1.13 package has shipped or passed every acceptance gate.

## Working directory and accessible project are separate

The user explicitly prefers project-level JupyterLab environments managed with
uv. A course-level server is equally valid: opening `course/` exposes its
notebooks, assignments, and data to ordinary declared notebook tools under the
kernel user's permissions. Opening `course/assignment-3/` selects a narrower
JupyterLab content root, but does not sandbox Python. The later discussion
separated a useful logical notebook folder from enforced native file access.
See the empirically checked
[Jupyter AI prior art](jupyter_ai_directory_and_permissions.md).

Distinguish these settings:

| Setting | Meaning |
| --- | --- |
| Logical notebook folder | The originating notebook's parent directory, resolved from its authenticated session path and supplied as inert, budgeted planning context. It does not change any process cwd. |
| Project access | The server's effective local content root, frozen at startup. A notebook-folder/project preference is stored for a future enforceable direct-file feature but currently grants no runtime operation. |
| Notebook Context | Source and earlier answers included in the initial question. It does not automatically attach the entire project. |
| Account | The user's ChatGPT/Codex sign-in, reusable across project servers where supported; each project has separate runs. |

Keep the original document/session/kernel binding for notebook operations.
Unsaved and offscreen cells come from the live JupyterLab model. Saved project
files can be read when needed. A directory scan or saved `.ipynb` file must never
replace live-model truth for the originating open notebook. Other open notebooks
remain outside our live-document bridge until an explicit multi-document feature
is built; their saved files can still be ordinary project context.

Resolve the local filesystem content root on Jupyter Server, with the configured
ContentsManager/ServerApp relationship checked at startup. Do not accept an
arbitrary absolute root from notebook metadata or the browser. Freeze the root
for the server/connection and show it in Configure AI. Resolve the notebook's
logical notebook folder beneath it from the authenticated session/document path;
handle rename/move before each new run. A remote/object-store ContentsManager
needs an explicit local workspace mapping before subscription runs are offered.
Neither the browser's current file-browser subfolder nor the kernel's mutable
cwd determines the server's local project root.

### Folder scope and sandboxing

The 0.1.13 runtime child and ephemeral thread use a **private runtime cwd** and
private `CODEX_HOME`, never the notebook/project folder: a project cwd can load
and trust `.codex/config.toml`, hooks and MCP settings before tool isolation.
The authenticated notebook parent is included only in the host-budgeted prompt
as location context. Native Codex file, shell, browser, plugin and other direct
tools are disabled; no direct-file scope is currently enforced or offered as an
active choice. The account status reports `native_files_capable: false`. The
stored notebook/project preference is dormant groundwork. Any future direct
file access must prove read/write/symlink containment separately; a cwd alone
is never a sandbox. Prior named-profile command probes in
[Jupyter AI prior art](jupyter_ai_directory_and_permissions.md) do not prove
this App Server path or the separately running kernel is contained.

The user has authorized project-wide availability; this does not require sending
all project files on every question or enabling every kind of action. Preserve
nbinlineai's explicit tool declarations. Project reads/edits use enabled notebook
tools. Do not enable a second set of native Codex filesystem, shell, browser,
MCP, plugin or subagent tools. No runtime filesystem profile currently grants
direct file access.

**The isolated Codex process does not sandbox the separately running notebook kernel.**
uv isolates dependencies, and Jupyter's root organizes content; neither confines
arbitrary Python. Current custom kernel functions, filesystem tools and
`run_shell` can operate with the kernel user's permissions. Full enforcement
across those paths requires sandboxing the kernel/server or a separate restricted
execution service. Path validation can constrain specific bundled tools but
cannot confine arbitrary Python callables. Do not label the whole notebook
environment “sandboxed to this folder” without that work. The user understands
and accepts ordinary local Python permissions; a new whole-kernel sandbox is
not a prerequisite for this feature. Label the read-only line “ChatGPT file
access: Notebook tools only” and explain the normal Python permissions briefly.

The earlier [Jupyter AI trial](codex_acp_example_run.md) demonstrated a Codex
ChatGPT login, project file reads and live notebook operations. It did not prove
a universal root restriction for Jupyter AI/ACP or Claude Code. Each integration
owns its process cwd, tools and permission policy; our displayed notebook folder
is location context, not a permission imposed on another extension.

## Configure AI

The repository includes an [interactive design preview](design/chatgpt-configure-ai.html)
and its [editable source](design/chatgpt-configure-ai.fragment.html). Open the
preview in a browser; all interactions are simulated and make no account or
notebook changes. These files travel with the specification, so another task
using this checkout can inspect the design without this conversation's storage.

**Student-facing terminology:** use **ChatGPT**, not **Codex**, throughout the
dialog, including setup/status/help/error messages. Keep technical Codex
SDK/runtime names in implementation documentation. The current read-only line
is **“ChatGPT file access: Notebook tools only”**. Explain that direct ChatGPT
file operations are disabled; declared notebook tools and Python keep their
normal kernel permissions. Do not show an active notebook/project scope selector
until a direct-file feature is actually implemented and enforced.

Use one compact connection selector, with a backend-specific detail area:

| Connection | Setup/status area |
| --- | --- |
| ChatGPT subscription | Connection state, Sign in with ChatGPT, available models, usage availability, project folder. |
| OpenAI API | Existing saved/environment key status and key management; API billing label. |
| Anthropic API | Existing saved/environment key status and key management; API billing label. |

For subscription setup:

1. Install the tested `openai-codex` dependency with nbinlineai on the **Jupyter
   Server host**; let its published package supply the pinned native runtime.
   No terminal, npm, Homebrew, or separately installed Codex app is required of
   students. Validate platform wheels and clean installations before adding it
   as a default dependency. An administrator executable override is optional.
2. Check account status through App Server. If an existing compatible ChatGPT
   connection can safely be reused, show it. Otherwise **Sign in with ChatGPT**
   opens the Codex-managed browser flow. Include cancellation and retry. App
   Server owns a local OAuth callback listener and supplies the full auth URL,
   including its callback port. This is a browser redirect, not a webhook to our
   Jupyter route. Do not guess/sniff/rewrite the callback port. The UI learns the
   result through the authenticated nbinlineai backend and login notifications.
3. Provide device-code sign-in when the callback cannot reach the server, notably
   remote JupyterLab/JupyterHub. This may depend on account/admin settings; report
   the actual failure instead of claiming every environment supports it.
4. Show connected account/workspace information only to the authenticated user.
   Show available models and reasoning options from the connection. A successful
   login is separate from successful model access. Preserve unavailable saved
   choices and explain them; never substitute silently.
5. **Use for this notebook** changes its default connection intentionally.
   Merely opening the panel, checking status or signing in does not dirty it.
   Cell overrides still inherit or select an explicit backend.

Suggested copy: “Uses your ChatGPT subscription allowance.” Display the
logical “Notebook folder: …/course/week2” as context and a read-only
**“ChatGPT file access: Notebook tools only”** line. A saved notebook/project
preference may remain in private configuration for future direct-file support,
but it has no effect on this release's tool permissions. Do not present it as
an active control or accept arbitrary path grants from notebook metadata.
The usage detail should explain shared account limits
and possible additional ChatGPT credits. Avoid a fixed number of notebook
questions and avoid translating unknown internal plan identifiers into prices.

On quota failure, keep the selected subscription connection and show the reset
time when supplied. The user may deliberately select an API connection. Do not
buy credits, redeem resets, enable automatic top-ups, or change billing settings.

States to design/test: not installed, installing, signed out, waiting for login,
connected, expired sign-in, login cancelled/failed, incompatible runtime,
unavailable model, unavailable usage information, usage limit reached, offline,
and server-process failure. Setup must be cancellable and must not freeze Lab.

## Process, account and installation ownership

### One notebook harness per document; shared authentication

Each notebook is a separate logical harness instance. Its conversation, current
snapshot, context preferences, declared tools, kernel/document binding, run
queue, cancellation and pending actions belong to that notebook. User
authentication is shared. An OS process is not the unit of notebook isolation.

Use a shared per-server account manager with a lazy control child and a separate
owned App Server child/ephemeral thread per host round. Bind notebook identity to the originating
document model and authenticated session/kernel, not just filename, active tab,
or cell IDs that another notebook might also contain. A fresh provider round
may use its own ephemeral Codex thread without changing notebook-level ownership.
Never resume another notebook's engine history, leak its tool declarations, or
let one notebook's cancellation interrupt another notebook's run. Kernel sharing,
if explicitly configured by Jupyter, needs normal kernel serialization rather
than an assumption that the two live namespaces are independent.

Across separate project-level Jupyter Server processes, account state may be
reused for the same OS user, but managers, runs and project scopes remain separate.
Test simultaneous notebook runs, identical cell IDs in different notebooks,
closing one notebook, and account expiry/change while other runs are active.

### Shared connection service

```text
JupyterLab (one project/course server)
  -> authenticated nbinlineai routes and SSE
     -> Jupyter Server connection/run manager
        -> existing FastLLM API adapters
        -> owned Codex App Server child over stdio
        -> originating kernel and live-document action bridge
```

Use one lazy account-control child per single-user Jupyter Server instance;
each notebook round gets an isolated child and run identity. Separate project
servers have separate managers and children,
even when they share a per-user login. The steady-state App Server transport
needs no extra listening port; browser login may use its transient callback port.
The child has one asynchronous stdout reader, serialized writes, bounded pending
requests, and explicit shutdown. Stop only owned processes. Handle child exit
and browser disconnect without retrying already executed actions.

The desktop binary examined here also exposes `app-server proxy`, forwarding
stdio to an existing daemon. Prefer a dedicated child for lifecycle and project
isolation; a proxy is not necessary for subscription billing. Never implement a
token-scraping ChatGPT-to-API proxy or select FastLLM's direct cached-token Codex
vendor. Keep the public App Server boundary.

Codex should own login storage and token refresh. Do not read/copy `auth.json`,
store OAuth tokens in nbinlineai's API-key file, or expose them to notebook
metadata, the browser, or logs. New account/setup routes use Jupyter auth, XSRF,
authorization, and the existing single-user-server topology guard. JupyterHub
must have one user-owned process/state context per user.

Explicitly select the official OpenAI provider with managed ChatGPT auth for
this backend. Do not pass the saved API keys into its SDK/configuration. Filter
inherited API-key, access-token, workload-identity and custom-provider overrides
that could select another credential path. Verify effective account mode before
starting a run and invalidate the connection if it changes. Use a supported
forced-ChatGPT setting only with understood auth-store effects; do not overwrite
the user's existing Codex login/configuration merely to check availability.

Proposed default for a managed installation: a dedicated nbinlineai Codex state
directory in per-user application storage, reusable by that user's project
servers, outside projects. Existing Codex sign-in reuse is an optional path only
after proving we can apply the intended configuration without inheriting
unrelated plugins, instructions or permissions. Never copy tokens to make reuse
work. Also test concurrent refresh and simultaneous browser-login callbacks
across project servers.

**Disconnect** detaches nbinlineai and stops only its owned children; it must not unexpectedly
log the user out of desktop Codex or another project. If a connection uses a
shared auth store, a separate sign-out action must explain the scope. Signing
out of a managed shared nbinlineai store affects its other project connections.

Use the SDK's pinned runtime distribution with a narrow owned async App Server
protocol client; its high-level wrapper does not expose all needed fields.
Verify public account/model RPCs, structured output, cancellation and native
tool suppression in the selected SDK/runtime version.
Lock and test the SDK/runtime together. Cross-platform installation/size/support
remain release gates. Do not depend on the user's global PATH or desktop bundle.
The native engine is still Codex internally; a library wrapper does not turn
ChatGPT subscription access into the ordinary billed OpenAI API. The user sees
“ChatGPT subscription” and ChatGPT sign-in, not a separate Codex product setup.

## Adapter design and the revised host boundary

Keep persisted backend IDs explicit: `openai_api`, `anthropic_api`, and proposed
`openai_codex_subscription`. The existing `backend` field already means a
connection route. Move availability and model capabilities into a registry so
future providers do not require more key-presence special cases. Keep API key
storage separate from account connection state.

The relevant [App Server protocol](https://learn.chatgpt.com/docs/app-server)
supports account login/status, model discovery, streamed turns and interruption.
Its host-supplied dynamic-tool interface is experimental. Generate and test
schemas from the executable version we ship rather than assuming a sample in
current web documentation matches a locally installed release.

Our source owns each host submission: build bounded context, submit a
completion, validate tool calls, execute serially, record completed tool groups,
and rebuild context before the next completion. `maxToolSteps` counts model
rounds containing tools, not individual calls; each completion has an additional
ten-call bound. Keep, cancellation and error-stop behavior surround the whole run.

**The user revised the earlier strict gate:** the 64,000-character estimate
applies to **each host-assembled submission** to the runtime, including fixed
instructions, exact serialized message input, output schema/framing, current
prompt, discovered tool schemas and completed notebook-tool groups before any
optional notebook context. The same `round_wire_cost(messages, tools)` serializer
drives preview and execution: it counts the exact double-serialized content and
adds a 4,096-character transport-metadata reserve. Before `turn/start`, the
adapter measures actual `thread/start` plus `turn/start` envelope lengths and
rejects any excess over the reserved estimate or 64,000 characters. Codex may make internal inference or recovery
requests after that bounded submission; those calls are not notebook-tool steps.
`maxToolSteps` counts validated notebook-tool plan groups returned to and
executed by nbinlineai, with at most ten calls per group. Never re-execute a
completed effect when the next host submission is re-budgeted.

Each host submission uses an isolated ephemeral thread and structured answer,
refusal or notebook-tool plan. The runtime advertises no native tools, starts in
private state/cwd, refuses App Server requests and rejects native tool items as
valid notebook plans. The host validates every returned plan against the run's
declared tools and bound session/kernel before dispatch. The prior
[gate record](chatgpt_subscription_gate.md) showed native tool suppression and
normal structured rounds succeeding, then an unexpected native call causing an
internal recovery request. That recovery no longer violates the revised
host-submission budget, but native tool execution remains forbidden. No ACP,
managed notebook-tool dispatch, API fallback or unbounded host payload is allowed.

Use the same run-scoped function allowlist and dispatcher for notebook
tools, original document/kernel IDs, serial kernel execution, bounded results,
and acknowledged browser edits. No native file editing may stand in for editing
the originating unsaved notebook. Keep executed effects on cancellation; do not
restart a failed turn automatically. Terminate unknown/cross-run tool calls and
dispose pending actions when the bound kernel or document changes.

### Unreleased source implementation as of 2026-09-24

The explicit backend registry keeps `openai_codex_subscription` separate from
`openai_api` and `anthropic_api`. `GET nbinlineai/status` includes
`subscription_capable` and discovered model/effort capabilities; a present
manager means the setup UI can open, while a ChatGPT account and compatible
discovered model are still required for `configured: true`. Account routes are
Jupyter-authenticated, execute-authorized and single-user guarded:
`GET subscription/status`, `POST subscription/login` (browser/device),
`POST subscription/login/cancel`, `POST subscription/disconnect`,
`GET subscription/usage` and `GET/POST subscription/file-access` under the
Jupyter base URL. Status and usage expose bounded typed presentation fields,
never raw account/RPC objects. The file-access routes return
`native_files_capable: false`; their named choice is dormant.

The server extension injects the owned runtime manager and uses Jupyter Server's
awaited `ExtensionApp.stop_extension()` hook to close only its child processes.
On Windows, Jupyter Server's Tornado startup switches to a Selector loop, which
cannot host asyncio subprocess pipes. A private Proactor worker loop owns only
subscription App Server children; Jupyter's process-wide loop policy stays
unchanged. Shutdown cancels and drains worker tasks, including preflight calls
that have not entered the per-run registry, then joins the worker and executor.
An authenticated session ID resolves and refreshes the notebook folder under a
frozen local content root. Prompt execution verifies the ChatGPT auth mode,
exact selected model and effort, then rechecks session path and bound kernel
before submissions and tool dispatch. Preview invokes the pure round serializer
without account/model RPC or a model call, even if signed out. Subscription
runtime errors become safe SSE errors. The API-key transport remains separate
and cannot serve a subscription request. Managed private-store sign-in and a
subscription-backed isolated JupyterLab/kernel acceptance run passed locally;
final artifact checks and publication remain.

## Concrete implementation seams

| Area | 0.1.13 source boundary |
| --- | --- |
| Provider selection | `src/providerChoice.ts`, `defaults.ts`, `schema/plugin.json`: explicit third backend and capability-driven choices without billing fallback. |
| Configure AI | `src/configureAI.ts` owns the connection dialog; notebook controls stay compact. |
| Status/config | `nbinlineai/config.py` and authenticated routes report runtime, account, model and effort availability separately from API-key presence. |
| Validation | `prompt.validate_request` uses the backend registry; discovered ChatGPT model/effort are checked again before each runtime round. |
| Run strategy | Host snapshot/introspection/selection, dispatch and SSE surround the API transport or isolated Codex structured-plan adapter; `round_wire_cost` includes serialization and transport reserve. |
| Lifecycle | An owned async App Server manager integrates with `handlers.py` cancellation and the Jupyter extension shutdown hook. |
| Credentials | `credentials.py` remains API-key-only; account routes/state are separate. |

## Verified Python SDK packaging and limits

A fresh disposable uv install obtained **`openai-codex==0.156.1`**, which depends
on **`openai-codex-cli-bin==0.156.1`**. Its bundled executable reported
`codex-cli 0.156.1`. The SDK resolves that runtime by default; overriding the
executable is optional. Python >=3.10 is supported by package metadata, below
nbinlineai's existing Python 3.12 minimum. That initial packaging check made
no model or login request.

Runtime 0.156.1 metadata lists wheels for macOS arm64/x86_64, manylinux and
musllinux aarch64/x86_64, and Windows arm64/amd64. The 0.1.13 lock resolves
the pinned dependency wheels for all eight supported platform combinations.
The final [credential-free CI run](https://github.com/rahuldave/nbinlineai/actions/runs/36029215455)
passed 14/14 jobs: packaged startup/shutdown in a Tornado loop, deterministic
RPC/lifecycle tests, and an actual empty native-tool inventory with a local
mock model on macOS, Linux and Windows x64/arm64 under Python 3.12 and 3.14,
plus Alpine musl x64/arm64 under Python 3.12. On Windows the probe applies
Jupyter Server's Selector-loop policy and uses the private Proactor worker.
This tests runtime execution without credentials; it is not a full Jupyter
Server/kernel or subscribed-account acceptance run. A macOS Intel-only
`argon2-cffi-bindings<26.1.0` bound selects the available 25.1.0 wheel;
other supported platforms retain 26.1.0. Clean installation of the **built
nbinlineai wheel** remains a release check. If a native runtime is unavailable,
account status must fail safely while API backends continue; do not make
students discover and manually install a Codex executable. Record wheel size
and cold-install behavior, given this project's prior Extension Manager issue.

Source inspection of the installed SDK found:

- `AsyncCodex` exposes account reads and browser/device-code login helpers.
- Its high-level thread creation does not expose dynamic-tool registration in
  the examined generated parameter model. A low-level request mechanism exists,
  but access through private members is not a stable production contract.
- High-level approval modes are `auto_review` and `deny_all`; the constructor
  does not expose a human-approval callback. The lower-level transport's default
  handler accepts command/file-change approval requests that reach it. This does
  not mean every action bypasses review, but we must not inherit that fallback
  unknowingly when promising restricted access.

**Implementation decision:** use the official packages for runtime distribution.
Use supported SDK methods where they satisfy the contract; otherwise start the
packaged App Server executable with our own narrow async protocol adapter. Do
not build a custom downloader or depend on the student's desktop app. Require
explicit handling/denial of permission escalation and unexpected tool requests;
never fall through to an accepting default. Test whether SDK `deny_all` supplies
the intended behavior; the name alone is not evidence of enforcement.

The selected runtime's actual schemas and effective policy must be checked. The
same direct-command sandbox probe was subsequently run against the SDK-bundled
**0.156.1** runtime and passed all six inside/outside/symlink checks on this Mac.
An isolated `AsyncCodex` startup and signed-out account read also passed.
That earlier sandbox check alone did not validate a model turn, all App Server
tools or other platforms; later actual-wire and CI evidence is in the
[runtime gate record](chatgpt_subscription_gate.md).
Sources: [official SDK](https://learn.chatgpt.com/docs/codex-sdk#python-library),
[SDK package metadata](https://pypi.org/pypi/openai-codex/0.156.1/json),
[runtime package metadata](https://pypi.org/pypi/openai-codex-cli-bin/0.156.1/json).

## Historical pre-implementation evidence

- Read current source/handoff and audited selection, key status, prompt/tool loop,
  cancellation and the single-user-server guard. No runtime source was changed.
- Retrieved the official auth, pricing, App Server, configuration and sandbox
  documentation on 2026-09-24. External details must be rechecked at implementation.
- The PATH `codex` launcher is present but fails because its packaged executable
  is missing. Detecting a command path alone is insufficient.
- The desktop-bundled executable reports `0.155.0-alpha.9.2`. A separately owned
  stdio child successfully initialized and returned a ChatGPT account from
  `account/read` with `refreshToken: false`. Only non-secret status was inspected;
  the child exited cleanly. No login/logout, model turn, API request, or Jupyter
  server was started by this check. This establishes local account reuse on this
  installation, not full inline-subscription functionality.
- Generated its experimental JSON schemas. This binary's dynamic function tool
  requires `type: "function"` alongside name/description/inputSchema. Its legacy
  `SandboxPolicy` schema does **not** include the restricted-read fields shown in
  current web docs. Named permission profiles passed the command probes; their
  per-run App Server integration still needs verification.
  Do not silently pass unsupported fields and claim folder containment.

## Acceptance evidence and release checks

The credential-free runtime and host integration tests cover account status,
model selection, structured answer/refusal/tool plans, cancellation, clean
shutdown, exact host-wire budgeting, and disabled native tools including an
unexpected call. The [opt-in live acceptance harness](../scripts/subscription_live_smoke.py)
then passed on local macOS arm64 with a fresh private store, device-code
ChatGPT sign-in in Safari, the production manager, an isolated JupyterLab and
real kernel, and a synthetic notebook. Across exactly three subscription
prompt requests it verified one declared kernel-tool effect exactly once,
an unsaved live `read_cell` result distinct from the saved file, Shift+Enter
Keep without replay, and cancellation of a running question. The driver
rejected API-backend requests and the server's paid API completion function
was replaced with a hard failure. This proves the bounded local path, not
all account states, models, cross-platform signed-in behavior, or a live
provider-native refusal. The [runtime gate record](chatgpt_subscription_gate.md)
separates structured refusal and native-refusal limitations.

The private runtime cwd and inert notebook-folder context must not be described
as project file confinement. Use deterministic protocol fixtures for regressions;
the completed live subscription trial used synthetic content and may have
consumed subscription allowance.

Required coverage includes existing API behavior; old notebook metadata;
no automatic billing fallback; per-project roots with nested notebooks;
cross-project isolation; absent/broken/incompatible runtime; auth cancellation
and reconnect; model availability; usage unavailable/limited; default/override
inheritance; source selection and below-cell exclusions; inherited declarations;
tool argument validation and budget limits; focus changes; stale kernels;
duplicate/late replies; partial effects and cancellation; server shutdown;
Keep, Shift+Enter and native Run All. A future direct-file feature needs real
folder enforcement tests on each supported OS before activating its selector.

After frontend changes, rebuild/relink before the isolated browser suite on
8897. Do not touch the user's 8888 server. Update public instructions/examples
when behavior ships. The source version is now 0.1.13, but PyPI remains
0.1.12. Remaining release work includes checked artifacts, clean wheel
install, PyPI publication, pushed release source/tag and publication
verification. A source checkpoint on the release branch is not publication.

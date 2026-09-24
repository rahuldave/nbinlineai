# Implementation task prompt: ChatGPT subscription integration

This is the historical task contract used for **0.1.13**. The 0.1.13 archives
were accepted by PyPI on 2026-09-24; consult the [release record](releasing.md)
for completed tag and public-site verification. The instructions below are
preserved for provenance, not as a statement that implementation is unfinished.

---

Implement ChatGPT subscription access in `/Users/rahul/Projects/nbinlineai`,
following `internal_docs/chatgpt_subscription_integration.md`. Read `AGENTS.md`,
`internal_docs/README.md`, `internal_docs/developer_handoff.md`, the integration
spec, `internal_docs/jupyter_ai_directory_and_permissions.md`, and the current
context/tool protocol documents before changing code. Use the repository's uv
environment. Use bounded gpt-6-sol coding subagents when useful, with explicit
file ownership and preservation of others' changes. Do not create extra
user-owned tasks.

Inspect the interactive design at `internal_docs/design/chatgpt-configure-ai.html`
and its editable source `internal_docs/design/chatgpt-configure-ai.fragment.html`.
They are repository files, not references to another task's private storage.
Use **ChatGPT**, not **Codex**, in the student-facing dialog. For this release,
show read-only **“ChatGPT file access: Notebook tools only”** and explain that
direct ChatGPT file operations are disabled while declared Python notebook
tools keep normal kernel permissions. Do not activate a notebook/project file
scope selector without an enforced native direct-file feature. Keep technical
SDK/runtime names in internal docs.

The user-facing goal is: install nbinlineai, choose **ChatGPT subscription** in
Configure AI, sign in with ChatGPT in a browser, return to JupyterLab, and run
ordinary inline AI questions using the account's Codex entitlement. Students
must not separately install Codex, its desktop app, Node or an API key. Existing
OpenAI and Anthropic API modes continue to work, with no automatic switch from
subscription to paid API billing. Keep the provider model extensible.

**No ACP. nbinlineai/the notebook is the harness.** Preserve notebook-owned
conversation/context, explicit tool selection, kernel execution, live-document
bindings, answer metadata, Keep, cancellation and native execution queues.
Do not replace that workflow with an autonomous Codex project agent.
Each notebook is its own logical harness instance; authentication is shared.
Keep per-notebook history, tool/context state, kernel/document bindings, queues
and cancellation separate. A shared manager/process may serve them, but must
never leak state or route a tool result/cancellation to another notebook. Cover
simultaneous notebooks and duplicate cell IDs across different documents.

Use the official Python `openai-codex` distribution and its pinned native runtime.
Version 0.156.1 and its matching runtime were installed and smoke-tested during
research; verify current compatibility rather than updating blindly. Its
high-level SDK lacks the complete tool/approval surface we need. Prefer supported
SDK methods; use a narrow owned async App Server protocol client against the
packaged runtime where necessary. Never use private cached-token endpoints,
copy `auth.json`, depend on a global Codex executable, or inherit the SDK's
accepting approval fallback unintentionally.

Preserve each host-assembled submission's 64,000-character estimate with the
runtime's `round_wire_cost(messages, tools)` serializer: exact serialized
content plus a bounded transport-metadata reserve, checked against the actual
combined App Server submission envelopes before `turn/start`. Count fixed
instructions, schema/framing, current prompt, discovered tool definitions and
completed notebook-tool groups before optional context; preview and execution
must use the same callback. Codex internal inference/recovery calls after a
bounded submission are permitted by the user's revised contract and do not
increment `maxToolSteps`. Count only validated notebook-tool plan groups
returned to and executed by the host, at most ten calls per group. Disable
native tools/instructions/history; use fresh ephemeral structured rounds.
Prove answer, refusal, tool results, cancellation and no replay of effects with
synthetic inputs. Never send notebook tool execution into the native loop or
silently fall back to API billing. Preserve the earlier strict-gate evidence as
history in `internal_docs/chatgpt_subscription_gate.md`.

Resolve the notebook parent from its authenticated session path as **inert
planning context**, and freeze the effective local ContentsManager root on the
server. Run the Codex child/thread from a private runtime directory with a
private `CODEX_HOME`, never from the notebook/project folder, which could load
trusted `.codex/config.toml`, hooks or MCP. Native direct file tools are disabled
and no direct-file folder scope is enforced. A stored named scope preference is
dormant until that feature exists. Ordinary notebook Python and declared kernel
tools retain normal cwd and user permissions; do not claim they are sandboxed.
Respect unsaved/offscreen live notebook content and never substitute file edits
for the original document bridge.

Build compact Configure AI states for installation/runtime errors, sign-in,
login cancellation, connected/expired accounts, model/effort selection, shared
usage limits, unavailable usage information and disconnect. App Server owns the
OAuth localhost callback and gives us its complete URL; do not sniff or guess
ports. Use device-code sign-in for remote servers where supported. Codex owns
tokens and refresh; expose only safe status to the browser. Preserve user and
project isolation, and do not sign out unrelated Codex clients on Disconnect.

Use deterministic protocol/provider tests by default, then the real isolated
JupyterLab/browser/kernel workflow on **8897**. Never use, stop, restart or test
against the user's **8888** server. Rebuild and relink frontend assets before
browser tests; do not build packages concurrently with browser tests. No paid API
tests by default. Any necessary live subscription smoke must be bounded, use
synthetic content, explicitly identify subscription usage, and never fall back
to an API key. Do not print or commit credentials, login tokens or personal data.

Cover both API regressions and subscription authentication, scope, tool/context
limits, cancellation/disconnect, changing focus/kernel, duplicate replies,
partial effects, server shutdown, notebook persistence, Keep and Run All. Update
public docs/examples when behavior changes and keep the internal handoff current.

Target **0.1.13**. After implementation and required checks pass, complete the
repository's full release checklist: aligned version bump/lockfiles, rebuilt
assets, checked wheel/source artifacts, clean-install verification, PyPI
publication, pushed source/tag and publication verification. Do not call a source
commit a release. If a real compatibility blocker prevents completion, clearly
record what remains and that PyPI is unchanged.

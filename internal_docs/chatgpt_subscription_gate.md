# ChatGPT subscription runtime compatibility gate

Checked 2026-09-24 against the official Python `openai-codex==0.156.1` and
`openai-codex-cli-bin==0.156.1` packages. This is a compatibility spike,
**not an implemented subscription backend**. The 0.1.13 execution gate
remains **failed** for the strict host-owned round contract. PyPI remains at
nbinlineai 0.1.12.

## Result

The [integration specification](chatgpt_subscription_integration.md) gives
nbinlineai ownership of each model round, its 64,000-character estimate, and
every declared notebook-tool group. A documented `model_catalog_json`
override, an empty environment list, and explicit feature controls **can**
make pinned App Server 0.156.1 offer no native tools or ambient instructions
in an actual local mock Responses request. A normal structured answer,
refusal, or tool plan then returns as one App Server message after one model
request. This refutes the earlier conclusion that native-tool suppression
itself is impossible on the pinned runtime.

The remaining failure is native-call handling **after** a provider returns
an unexpected call. The zero-tool mock request advertised `tool_choice:
"auto"`. When the mock returned an unrequested `apply_patch`
`custom_tool_call`, App Server did not edit the synthetic file, but it
appended that call and its error result to its own history and sent a
**second Responses request inside the same turn**. That bypasses the host's
one-request-per-round budget and tool-group validator. The packaged
[request builder](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/src/client.rs#L971)
hardcodes `tool_choice: "auto"`. The generated `turn/start` schema has no
tool-choice, fail-on-unknown-call, or maximum native-step field.

This negative test deliberately sends an invalid provider response. It does
not prove an ordinary ChatGPT model would emit a call when no tools are
advertised; it proves the packaged runtime does not enforce the required
host-owned boundary if one appears. The minimal unblock is a supported
fail-closed, one-completion/no-native-loop mode, or a continuation policy that
requires client acknowledgement before another model request (or equivalent
enforceable tool-choice control), followed by a fresh adversarial probe. Do not route
notebook questions through this runtime under the current contract.

## Supported suppression path and actual wire evidence

The public [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents `model_catalog_json`. The pinned
[config loader](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/src/config/mod.rs)
loads its model descriptors as a nonempty catalog, and the
[models manager](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/models-manager/src/manager.rs)
uses that catalog authoritatively for `model/list`. A no-turn test with one
sanitized `gpt-6-sol` descriptor returned exactly that model. The descriptor
sets `apply_patch_tool_type=null`, `experimental_supported_tools=[]`,
`tool_mode="direct"`, `multi_agent_version=null`, and
`supports_search_tool=false`. These fields are in the pinned package's model
schema and source; their exact behavior must be re-gated for each runtime
upgrade. Live account model discovery could happen separately on the official
provider, followed by a validated sanitized catalog of only known available
models. Unknown choices would be rejected.

The [deterministic probe](../scripts/subscription_tool_inventory_probe.py)
starts a fresh ephemeral thread with `environments:[]`, `dynamicTools:[]`,
synthetic instructions, deny-all approval replies, and a temporary isolated
`CODEX_HOME` and working directory. It disables shell, unified exec, apps,
plugins, multi-agent, plan, image, search, goal, skills, MCP, environment,
permissions, collaboration, and related automatic instructions through
supported settings. `tool_mode="direct"` matters: the pinned tool builder
otherwise registers code-mode `exec` and `wait` even when underlying tools
are empty. `features.goals=false` removes App Server goal tools embedded in
a developer tool namespace after the top-level Responses `tools` array was
empty. Explicit `skills.include_instructions=false` and related switches
remove ambient skills and environment blocks. The mock uses a minimal child
process environment and a dummy local provider; it is never a production
auth route.

Run all five deterministic scenarios using uv:

```sh
for scenario in inventory answer refusal tool_plan unexpected; do
  uv run --no-project --with openai-codex==0.156.1 \
    python scripts/subscription_tool_inventory_probe.py --scenario "$scenario"
done
```

The local fake Responses server prints counts, item types, and tool names,
never request contents or credentials. The script asserts both top-level
`tools=[]` and the embedded code-mode developer tool namespace are empty,
and only expected developer/developer/user items reach the first request.
The first wire input had three items and 425 JSON characters; the separate
structured output schema occupied 606 JSON characters. Those are synthetic
short-input figures, **not** a production notebook budget. Clean answer,
refusal, and tool-plan replies each produced one request and one matching
`agentMessage`. The unexpected-call scenario produced two requests, with
`custom_tool_call` and `custom_tool_call_output` added to the second input.
The synthetic `unexpected.txt` did not exist. This is an executable
pinned-runtime regression, not just source inspection.

The generated experimental App Server schema supports `thread/start.ephemeral`,
instruction overrides, `environments`, `dynamicTools`,
`experimentalRawEvents`, and `turn/start.outputSchema`. The Python SDK wrapper
does not expose all experimental fields, so a narrow protocol client would
be needed. The public [App Server documentation](https://learn.chatgpt.com/docs/app-server)
and [Python SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)
describe the supported product surface. With raw events enabled, the mock
emitted `rawResponseItem/completed` for the unexpected native call before the
second HTTP request. But this event is asynchronously forwarded by the App
Server listener while the core turn loop continues automatically on
`needs_follow_up` ([source](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/src/session/turn.rs#L537)).
No client acknowledgement or pause barrier exists. A subsequent public
`turn/interrupt` might win a race, but cannot guarantee the host sees and
rejects the call before another model request.

If a supported stop mechanism is added, the adapter should expose an exact
`round_wire_cost(messages, tools)` callback to the existing context builder.
Packing normalized host messages into App Server text causes a second JSON
escaping layer, so a fixed additive guess is insufficient. The callback
must count actual message serialization, explicit instructions, output
schema, and framing before optional notebook source, while preserving
completed tool groups without replay. Backend groundwork accepts this
callback but leaves subscription execution gated.

## Earlier live smoke and auth limits

Before the catalog suppression audit, two bounded synthetic live turn
attempts used an existing account reported as `chatgpt` by public
`account/read`. The first timed out in an initial notification collector
that discarded events. The second used a temporary synthetic folder and
disabled named shell flags; it emitted a `fileChange` item and created
`probe.txt` with native `apply_patch`, despite `approvalPolicy:"never"` and
explicit denial of server requests. The reporter timed out after 45 seconds
waiting for final status, but the file mutation was observed. Its
notification matcher was corrected without another live request. Those
attempts may have consumed subscription allowance. No paid API test was
intended, and neither used a personal notebook or Jupyter server. Owned child processes were waited
or terminated, and temporary folders were removed.

That live attempt did not record returned `modelProvider` or scrub every
inherited provider override. It proves native tool exposure in an ordinary
pinned runtime configuration, **not** a verified ChatGPT billing trace. The
revised [no-turn account probe](../scripts/subscription_runtime_probe.py)
selects `modelProvider="openai"`, removes known API endpoint/key overrides
by name, and confirmed package 0.156.1, account mode `chatgpt`, provider
`openai`, ephemeral thread, and zero project instruction sources. It did not
submit another model turn. Production would need a dedicated state/auth
boundary and official ChatGPT provider, with no API-key fallback. No auth
JSON, browser token, or private account material was read or copied.

## Release implications

This spike did not implement account status, model selection, usage
reporting, cancellation propagation, notebook tool-group replay, production
auth, or cross-platform folder enforcement. Clean structured mock replies
establish only local wire shape; they are not subscription acceptance tests.
Final integration-groundwork checks passed **245 Python tests** and Ruff,
**55 frontend unit tests** and TypeScript type checking, then a production
frontend rebuild/relink. A selected isolated JupyterLab browser regression
set passed **11/11** uninterrupted on port 8897, covering API provider keys,
availability, models, defaults, settings recovery, and a saved unavailable
ChatGPT selection. This was a focused browser subset, not the full browser
suite or a subscription acceptance test. Python 3.12
wheel-only dependency resolution passed eight macOS/Linux/Windows runtime
wheel platforms; it establishes package availability, not runtime policy
enforcement on each OS. The SDK wheel is about 0.09 MiB and native wheels
range 113.72–139.22 MiB. No version bump, distribution artifacts,
publication, source commit, push, or tag was made here. PyPI remains 0.1.12.

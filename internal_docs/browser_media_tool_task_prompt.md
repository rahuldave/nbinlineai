# Task prompt: implement browser, app and local-media tools

Copy the text below into a **new Codex task after specification PR #20 merges**.
The merged, independently reviewed specification is the implementation
authority; pasting this prompt authorizes the phases below without a new
scope-approval step. This document alone does not start runtime work. The API contract is
[browser_media_tool_spec.md](browser_media_tool_spec.md); the
[browser/media research](browser_media_tool_research.md) records evidence and
limits, not shipped functionality.

---

Implement the approved browser, app and local-media tools for nbinlineai in
coherent phases. Follow the public operations and schemas in
`internal_docs/browser_media_tool_spec.md`; do not infer additional operations
from the research candidate list or silently change the API to fit an existing
transport.

## Establish the documentation and code baselines

Before planning implementation, confirm that browser/media documentation PR
**#20** has merged into `main`. Read and pin the resulting **committed main
SHA**, exact spec bytes and recorded review finding dispositions. This is a
provenance check, not a request for another spec approval. If #20 is still
open, read its reviewed head only as a pending dependency and wait for its
integration before runtime edits. Record `docs.source_branch=main`,
`docs.source_commit`, the spec/research
paths and the reading location in the Gest task and runtime PR. Do not treat
uncommitted drafts as a merged specification.

Keep `/Users/rahul/Projects/nbinlineai` on `main` as the primary documentation
checkout. Check its branch, status and freshness. If it has local drafts, is
behind, or is unavailable, preserve it and read the selected committed main
snapshot with `git show` or another read-only main snapshot as described in
`internal_docs/workflow.md`. Never stash, reset, switch or edit the primary to
obtain docs. Read linked internal documents at the same recorded revision.

Read in this order:

1. The implementation checkout's `AGENTS.md` and main's canonical
   `AGENTS.md`, `internal_docs/README.md`, `internal_docs/developer_handoff.md`
   and `internal_docs/workflow.md`.
2. `internal_docs/browser_media_tool_spec.md`, then
   `internal_docs/browser_media_tool_research.md`.
3. `internal_docs/bundled_tools.md`,
   `internal_docs/cell_kernel_model_and_context_selection.md` and
   `docs/architecture.md` for the implemented browser bridge, server actions,
   live model and current transport boundaries.
4. `internal_docs/notebook_execution_handoff_spec.md` for the approved queued
   execution contract and the explicit boundary between media operations and
   later autonomous notebook continuation.

Main's internal docs are canonical for intent; inspect the actual runtime
checkout to establish shipped behavior and available commands. If the spec
changes during development, review and deliberately update the pinned docs
revision. Do not mirror internal docs onto the experimental branch.

## Workspace and tracking

The portable browser/media runtime targets a **new main-based topic**. Fetch
current refs and create an owned physical worktree from `origin/main` on a
temporary `codex/*` branch. Keep the primary checkout on `main`; do all runtime
edits, public docs/examples, builds and tests in the owned worktree. Record
its absolute path, owner, topic, start SHA and selected PR base. Preserve other
agents' edits and unrelated worktrees. Internal spec, research and handoff
updates use a separate owned main-based documentation topic/PR; identify the
runtime branch, commit and status rather than implying a release.

Use `.agents/skills/gtw/SKILL.md` and the project Gest store for implementation
planning and follow-on tasks. Serialize Gest operations. Break the approved API
into independently reviewable slices, define dependencies, and use bounded
gpt-6-sol subagents in separate owned worktrees when useful. Give each worker
explicit file ownership and require preservation of other agents' changes.
Centralize Gest, commits, PRs and integration. Do not create additional
user-owned Codex tasks unless requested.

## Implementation phases and boundaries

Implement **Phase A** of the spec first: capabilities, bounded operation IDs,
results and lifecycle; `list_outputs` discovery plus `export_output` so the
first phase can obtain the required output references; camera photos/video and
microphone recording; authenticated local Jupyter-server saving into the
user's configured folder. Direct Python helpers return a `BrowserReceipt`
immediately; model tools use the authenticated frontend action path. Neither
holds a Python cell waiting for a browser response. Return status and saved
file metadata, including exact server-relative path, MIME type, size and
relevant dimensions/duration, never media bytes in tool text. Saving is
complete only after the server confirms it.
Keep target binding to the originating notebook, model, session, kernel and
stable cell/output/artifact identities, including unsaved and offscreen cells.
Do not redirect an operation when focus changes. Default paths are unique files
under `media/` beside the initiating notebook; do not overwrite or escape the
server root, including through symlinks.

Complete Phase A's camera photo, camera video with **optional** microphone
audio, and microphone-only recording. Use browser capability and MIME/codec
detection, explicit permission and audio choices, finite duration/byte/pixel
limits, and clear stop/cancel/close behavior. Save through authenticated
Jupyter/server APIs, not a held Python cell. A local preview or saved file does
not transfer media to any model.

Implement **Phase B** screen capture/recording, the remaining notebook view and
`read_output` reads (output discovery already belongs to Phase A), and
supported rendered-region capture, local media preview/playback and bounded
frame/image derivatives, explicit file and clipboard UI, registered typed
JupyterLab/cooperating-app state/actions/events, and the scoped developer
bridge. Preserve the spec's `setup_share`, `start_share`, `capture_screen`,
`capture_tool` alias and `stop_share` names; screen recording uses
`start_recording` with the screen source. Screen operations are in scope with
capability detection, a real user gesture and chooser where required, and
explicit `unsupported` results on platforms that lack the needed API. Do not
claim system audio or arbitrary external-tab inspection. Keep camera/microphone
and output export usable where screen capture is unavailable.

Avoid a generic arbitrary JavaScript or cross-tab browser-control tool. Follow
dialoghelper's public API patterns where the spec identifies corresponding
operations, while independently implementing against nbinlineai's existing
bridge and preserving GPL-3.0-only. Do not copy Solveit private services or
require its Chrome/CDP extension, another browser extension, a browser-only
durable store, or a browser filesystem picker. Keep developer script/module
helpers in an isolated app surface with explicit opt-in; do not expose
model-generated arbitrary JavaScript as an enabled tool.

**Phase C model image attachment is a separate substantial implementation
phase within the approved main scope.** Implement `attach_media` for an exact
saved still image or extracted frame, with file hash, identified AI question,
visible confirmation, backend capability checks, genuine media transport,
payload size/pixel limits, preview and budget accounting. Recheck file bytes
and backend support when the question runs; opening or previewing never
attaches. Initial audio and full-video model input return
`provider_unsupported`. The current 64,000-character host-envelope estimate
is not an image-token budget, and text/base64 tool results are not a substitute
for a media transport. Phases A, B and C may proceed under the approved spec
without a new authorization gate after PR #20 merges; if infrastructure cannot
support a required operation, report the precise gap and a reviewed follow-up
rather than simulating success or silently dropping the operation.

Do not fold queued cell execution, run → capture → prompt, event-triggered
Python execution or autonomous continuation into the main browser/media
scope. Those compositions depend on the separately approved notebook handoff
contract and belong to a later experiment-based topic with its own render/event
adapter, lifecycle and review. No sidecar, nested kernel-loop wait, CDP or
extension is needed for the portable core.

## Verification and delivery

Add focused tests for schemas, binding, duplicate/expired operations, closed
tabs/surfaces, permission denial, cancellation, byte/time bounds, MIME choice,
save completion/failure and no implicit provider transfer. Verify with a real
isolated JupyterLab and kernel plus deterministic provider, including two
notebook tabs and focus changes. The support matrix includes current desktop
Chrome, Edge, Firefox and Safari; Android Chrome and Firefox; and iOS/iPadOS
Safari. Test other mobile browser brands as available, without inferring
behavior from their name or a desktop engine. Test real camera/microphone and
screen behavior on these platforms; report hardware, permission and screen API
gaps explicitly. Mobile camera/microphone access normally needs an HTTPS
Jupyter origin when the phone connects to the user's computer; document and
test secure access without weakening browser security. Automated Chromium
alone does not establish cross-browser or mobile compatibility. Verify that
media reaches only the local server until the explicit Phase C attachment
action is delivered.

Use uv and the worktree environment. Rebuild/relink frontend assets before
browser tests, never concurrently. Browser tests own port 8897 and temporary
config/notebooks/keys; never use, stop, restart or test against the user's
JupyterLab on 8888. Do not run paid or credentialed provider tests without
explicit authorization. Update public docs/examples with the runtime slice;
update internal notes through a separate main-based documentation PR.

At each coherent checkpoint, obtain independent adversarial review of the
exact base/head and record findings/dispositions. Commit and push verified
topics, open PRs to their selected base, require both actual CI gates, and
respect the user's merge decision unless a particular merge is already
authorized. Preserve the persistent experimental branch and keep Git-source
installation working. No version bump, tag, PyPI upload, website deployment
or promotion to another integration branch follows from this prompt. Retire
only clean, verified integrated worktrees owned by this task.

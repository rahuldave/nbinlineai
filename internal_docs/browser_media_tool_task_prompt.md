# Task prompt: Astra orchestrates browser and local-media tools

**Updated 2026-09-28 after approval of the six Sol-6 workstreams.**
The [API specification](browser_media_tool_spec.md) and
[research](browser_media_tool_research.md) merged through PR #20. The separate
JupyterLite documentation merged through PR #23; it adds no work to this task.
PR #24 clarified that implementation handoffs travel with their code.

Copy the task below into a new **Astra** task. Pasting it authorizes the full
approved implementation scope; this document's presence does not start work.
The spec controls API semantics. This prompt controls delegation and delivery.

---

Act as the **gpt-6-astra orchestrator** for implementing all approved browser
and local-media tools in nbinlineai. Use **gpt-6-sol subagents** for production
code, tests, examples, implementation documentation, integration fixes and CI
repairs. Keep those implementation responsibilities delegated. You own planning,
interface decisions, worker coordination, Gest tracking, integration order, PR
management and acceptance of the collected evidence.

**No apps:** do not develop an app specification, widget adapters, an app
registry, inline JavaScript apps or their developer helpers. Also exclude the
JupyterLite port, notebook execution handoffs, RLM, multi-kernel work and
automatic successor prompts. The deferred app note is background only.

Also complete the tools-page/example-notebook coverage described below for
**all existing tools and all new tools**, not only this feature's additions.

Follow `internal_docs/browser_media_tool_spec.md`. Do not add operations from
the research candidate list or silently weaken the API to fit today's bridge.

## Establish documentation and code baselines

The prerequisite spec PR #20 is already merged. Fetch and record a current
committed `main` revision containing it and the current documentation policy;
record `docs.source_branch`, `docs.source_commit`, paths and reading location.
If this revised task prompt was explicitly supplied from a reviewed but unmerged
documentation PR, record that prompt's separate exact commit and pending status.
That explicit selection does not turn a topic into main or authorize its merge;
the API spec must still come from committed main. Do not substitute unselected
working drafts for approved material.

Keep `/Users/rahul/Projects/nbinlineai` on `main`. It was clean and synchronized
when this prompt was prepared; inspect it again rather than assuming it stays
that way. Read approved pre-work docs there at the recorded revision. If dirty,
behind or unavailable, preserve it and use `git show` or a read-only committed
snapshot as described in `internal_docs/workflow.md`. Do not stash, reset,
switch or edit the primary checkout to obtain documentation.

Read:

1. Primary and implementation-checkout `AGENTS.md`; main's
   `internal_docs/README.md` and `internal_docs/workflow.md`.
2. Main's `internal_docs/browser_media_tool_spec.md`, this task prompt and
   `internal_docs/browser_media_tool_research.md`.
3. `internal_docs/bundled_tools.md` and
   `internal_docs/cell_kernel_model_and_context_selection.md` for protocol and
   ownership background, checking their claims against current source.
4. The implementation branch's `internal_docs/developer_handoff.md` and
   `docs/architecture.md` for actual behavior, source structure and test pitfalls.
5. Main's `internal_docs/notebook_execution_handoff_spec.md` only to understand
   the excluded execution/continuation boundary.

Pre-work specs, research and task prompts remain canonical on main.
Implementation handoffs, verification records, public docs, examples and code
travel together on the implementation branch and its PR. Record both reading
revisions where they differ. Review any later spec update deliberately; do not
mirror documents or merge main into the experimental branch merely to read them.

## Worktrees, tracking and shared ownership

The integration target is **main**, through temporary `codex/*` topics and
reviewed PRs. Keep the primary checkout on main. Give each concurrently writing
Sol worker a separate owned physical worktree and its own environment/build
outputs. Record owner, path, branch, start SHA, prerequisites and immediate PR
base. Tell every worker it is not alone and must preserve others' changes.
Never share a mutable environment or generated assets between active workers.

Use the installed `.agents/skills/gtw/SKILL.md` workflow and serialize Gest
operations through Astra. Track the feature under the notebook-agent initiative
and create bounded implementation leaves with acceptance criteria. The approved
research is already delivered; do not reopen it as if runtime code existed.
Maintain a checklist mapping **every spec API**, including aliases, to one
owner, delivery slice, tests, review evidence and remaining platform limitations.

Dependent workers may start from an explicitly recorded reviewed prerequisite
commit. Use temporary stacked topics if necessary; record their immediate PR
bases, integrate bottom-up and revalidate affected diffs/checks after retargeting
to main. No direct development pushes to main or the persistent experiment.
Do not create another persistent integration branch or user-owned Codex task.

Assign one Sol owner at a time for shared wiring such as `src/index.ts`,
`nbinlineai/handlers.py`, `nbinlineai/tools.py`, shared schemas, dependency files,
styles and shared test fixtures. Feature workers own separate modules and tests;
they submit registration/hook requirements to that owner. Worker 1 initially
owns common wiring; Astra explicitly transfers ownership when necessary. Give
integration conflicts and code/test fixes to a Sol agent instead of silently
taking over their implementation.

When spawning workers, explicitly select `gpt-6-sol`. Supply the bounded task,
its file ownership, pinned docs/commits and required context; use a spawn mode
that permits the model override. Report inability to obtain that model rather
than silently substituting another. Use available capacity: with four total
slots, Astra can run at most three Sol agents concurrently, including reviewers.
These six workstreams do not require six simultaneous agents. Reuse workers for
successive bounded slices and free a slot for independent review when needed.

## Six Sol-6 workstreams

Each owner implements both Python and frontend pieces as needed, its own tests,
public examples/docs, implementation handoff and fixes. Tool families are the
ownership boundary; do not split a family into separate Python and JS teams.
The proposed module boundaries below are responsibilities, not permission to
refactor unrelated code. Plan concrete file ownership before editing.

| Owner | API and implementation responsibility | Key verification responsibility |
| --- | --- | --- |
| **1. Shared infrastructure** | Operation/receipt/media/source contracts; browser-client/notebook binding; authenticated server registry, binary result delivery, memory retention, files and `save_to`; `browser_capabilities`, `operation_status`, `cancel_operation`, `save_media`, `release_media`; shared status UI and registration hooks. Other owners contribute capability facts through the agreed interface. | Both Python-comm and model-action entry points; busy-kernel receipt behavior, operations outliving a prompt, deduplication, leases/expiry, memory limits, file/hash/root checks, save failures and owner loss. |
| **2. Camera, microphone, screen and recording** | `list_media_sources`, `start_camera`, `start_microphone`, `capture_camera`, `stop_source`, `start_recording`, `pause_recording`, `resume_recording`, `stop_recording`, `record_camera`, `record_microphone`, `read_audio_levels`; `setup_share`, `start_share`, `capture_screen`, `capture_tool`, `stop_share`. Own permission/source controls and **one recorder** shared by device, screen and canvas sources. | Permission/chooser outcomes, actual track/codec selection, optional audio, explicit versus convenience source ownership, pause/stop/end races, time/size bounds, mobile interruption and unsupported screen behavior. |
| **3. Notebook views, outputs and canvas** | `read_notebook_view`, `read_selection`, `list_outputs`, `read_output`, `export_output`, `list_canvases`, `capture_canvas`, `export_canvas`, `start_canvas`, `capture_notebook_region`. Own output/view identity and supported-renderer adapters; register canvas sources with worker 2's recorder interface. | Unsaved/offscreen outputs, stale output/view revisions, focus changes, no-dirty reads, existing SVG fidelity, canvas origin/readback limits and replacement stopping an active source. |
| **4. Import, playback and clipboard** | `choose_file`, `open_media`, `play_media`, `pause_media`, `seek_media`, `set_media_volume`, `close_media`, `copy_text`, `paste_content`. Own previews and the bounded decoding interface shared with worker 5; consume worker 1's storage/result API. | Memory/file inputs, hash validation, file selection cancellation, autoplay/clipboard activation, actual codec support, preview ownership/cleanup and no implicit saving or model disclosure. |
| **5. Media transformations** | `extract_frames`, `crop_image`, `annotate_image`; derivative provenance and memory/file results using the shared `save_to` contract. | Real decoded frame/image fixtures, timestamps, pixel bounds, batch/memory limits, source preservation, redaction pixels, optional saves and decoding failures. |
| **6. Model image attachment** | `attach_media`; question metadata/confirmation UI, backend capability checks, genuine image payloads, preview/budgets and existing model-transport integration. | Exact question/hash binding, volatile media expiry, refusal on running questions, supported transport serialization, unsupported audio/video/models, no implicit attachment and no replay while re-budgeting. |

## Dependency order and acceptance gates

1. **Foundation first.** Astra and worker 1 fix the protocol/schema, source
   registration and ownership contracts before dependent runtime work. Choose
   the spec's remaining concrete lease/retention/upload decisions. Worker 1
   proves one real browser/server/kernel path with a deterministic image fixture:
   immediate Python receipt, later PIL result, model-visible bounded descriptor,
   optional authenticated save and cleanup. A collection of untested interfaces
   is not a completed foundation. Obtain independent Sol review of this boundary.
2. **Then parallel families.** Once the foundation is usable at a recorded
   reviewed commit, workers 2, 3 and 4 can proceed concurrently. Worker 2 starts
   with camera/microphone and the common recorder; worker 3 starts with
   `list_outputs`/`export_output`. These are required for the spec's Phase A.
   Worker 4 can use deterministic media fixtures without waiting for capture.
3. **Canvas and transformations.** Worker 3 adds canvas video after the shared
   source/recorder interface is available. Worker 5 starts after the bounded
   decoding/media interface is ready, using fixtures independently of device
   capture. Do not build a second recorder or a second storage system.
4. **Attachment.** Worker 6 may build against fixture images after the foundation
   exists, as capacity permits. Complete capture/export/transform-to-attachment
   integration after the producing families are available. Keep Phase C's
   provider and payload work a separately reviewed delivery slice.
5. **Combined verification.** Assign a Sol integration/verification task to test
   real cross-family flows: capture or export → preview → derivative → optional
   save → explicit image attachment, plus recording → frame extraction. Include
   cancellation, stale identities and limits across those boundaries. This
   supplements each owner's tests; it does not transfer testing out of families.

These workstreams preserve the spec's Phase A/B/C acceptance boundaries below.
Astra can schedule independent work early while delivering coherent incremental
PRs. Partial implementation is a checkpoint, not completion of the whole task.
Unsupported platform capabilities are explicit outcomes allowed by the spec;
an unimplemented required API must be reported as unfinished.

## Tools page and notebook demonstrations: existing and new tools

This is a required deliverable, including the previously shipped tools. The
current tools page already has short example questions, but lacks a systematic
per-tool link to a notebook demonstration. Preserve useful examples and fill
gaps; a general link to the examples directory is insufficient.

Assign a **Sol-6 documentation/catalog task** alongside the six implementation
workstreams. It owns the shared `docs/tools.md`, `docs/examples.md`,
`examples/README.md`, existing-tool notebook coverage and its automated coverage
check. It is a supporting assignment within the same capacity limit, not a
seventh runtime family. It can audit existing coverage while the foundation is
being developed. Astra schedules its writes/review without competing ownership
of shared files. Each new family still owns and tests its own notebooks, then
hands its tool entries and coverage mapping to the catalog owner.

For every existing and new public model tool, including public aliases:

- Keep an accurate entry on `docs/tools.md`: signature, purpose, usable example
  question or code appropriate to its actual calling convention, and a visible
  **Notebook example** link to a concrete `.ipynb` under `examples/`.
- The linked notebook must actually demonstrate that specific tool. Several
  related tools may share one notebook; give each demonstration a clear heading
  and stable cell identity. Link to a supported section anchor where reliable,
  or name the exact section beside the notebook link. An import, tool-name list
  or declaration alone does not demonstrate a tool.
- Include setup/imports, required tool declarations, realistic inputs, the call
  or AI question, expected observable behavior and cleanup. Obtain real IDs and
  hashes from discovery results rather than inventing values. Keep the existing
  tool-discovery/context rules and 20-name limit valid across the notebook.
- Explain whether an example is callable directly from Python, runs through an
  AI question, or needs live JupyterLab/browser interaction. Do not demonstrate
  old frontend-only Python stubs as ordinary direct calls. New asynchronous
  helpers show receipt inspection in a later cell, without blocking the kernel.
- Use disposable project files and deterministic sample media. Permission/device
  operations are explicit user steps; do not capture personal media or send it
  to providers as routine verification. AI sections explain the configured
  provider requirement and normal usage; automated runs use deterministic
  providers, not paid calls.
- Keep new notebook code outputs/AI answers clear of personal data and generated
  secrets. Document device, browser, network and optional-package prerequisites
  and unsupported cases instead of silently skipping a demonstration.

Audit the actual runtime registry (`TOOL_FUNCTIONS` and groups), public aliases
and tools page; do not hard-code the initial count of 51. Track setup helpers
such as `tool_catalog`, `tools_markdown` and `insert_tools` separately and link
their documented examples too, without counting them as model tools. Reuse or
extend existing notebooks where suitable, and add focused notebooks where an
existing one would become unwieldy. Preserve the intentional Codex ACP teaching
bug and its expected diagnostic.

Add a maintainable mapping/check across registered tools, tools-page entries
and notebook demonstrations. It must catch missing tool coverage, broken paths
and missing referenced sections/cell IDs. A text search that only finds a tool
name is insufficient. Pair structural coverage with meaningful execution tests
and review of the demonstrations; the mapping alone cannot prove behavior.

Extend existing example tests to validate all delivered notebooks and execute
safe setup/direct calls in an isolated kernel. Browser-only examples need
explicit, narrowly classified skips in headless tests and corresponding
JupyterLab tests with deterministic providers/fixtures where automatable. Do not
broaden `nbinlineai-ui-only` into an unverified blanket exemption. Report real
hardware/mobile checks separately. Ensure required notebooks and supporting
fixtures are included in packaged examples and linked from the example indexes.

The final acceptance checklist must show every current and new tool's notebook
and demonstration location, validation status and any real platform limitation.
Public docs must distinguish newly integrated source behavior from the latest
published package version until an actual release occurs.

## Test scheduling and independent review

Each Sol worker owns meaningful Python/frontend tests and real JupyterLab/kernel
integration tests for its changes, plus review/CI repairs. Use deterministic
providers by default. Keep test code with the implementation it verifies.

Astra grants **exclusive use of port 8897** for browser integration runs. Check
that it is free; an occupied port may belong to another task. Do not stop or
reuse that server. Coordinate or wait, and stop only processes this task owns.
Serialize browser build/relink/test sessions; do not build package assets while
any task-owned browser test is using them. Independent unit tests can run in
parallel in isolated environments. Never use the user's server on port 8888.

A different Sol agent reviews each author's changes adversarially. Reviewers
may be reused across groups but do not independently approve their own work.
Record exact base/head commits and finding dispositions. Re-review fixes and
integration changes; reconcile documentation and API checklist status. Astra
makes the final acceptance decision from this evidence, not from a worker's
self-report alone. PR approval count and independent agent evidence remain
separate from a second human GitHub account's approval.

## Implementation phases and boundaries

Implement **Phase A** of the spec first: capabilities, bounded operation IDs,
results and lifecycle; `list_outputs` discovery plus `export_output` so the
first phase can obtain required output references; camera photos/video and
microphone recording; bounded in-memory results; and authenticated local
Jupyter-server saving when selected. Direct Python helpers return a
`BrowserReceipt` immediately and receive their result later; model tools use
the authenticated frontend action path. Neither holds a Python cell waiting
for a browser response, and this spec does not promise an awaitable kernel API.
Raster stills may become PIL images in Python after receipt completion; short
recordings become encoded `MediaClip` bytes with actual MIME type, never PIL
video. Return only bounded status/reference metadata to model tools, never
media bytes in tool text. File success occurs only after server confirmation.
Keep target binding to the originating notebook, model, session, kernel and
stable cell/output/artifact identities, including unsaved and offscreen cells.
Do not redirect an operation when focus changes. Use one `save_to` argument:
`None` means a bounded ephemeral memory result, `"auto"` a generated local
file, and a nonempty server-relative string an explicit local path. Still
capture defaults to `None`; recordings default to `"auto"`, with memory allowed
only for bounded short clips. Default file paths are unique under `media/`
beside the initiating notebook; do not overwrite or escape the server root,
including through symlinks. Implement bounded result retention and explicit
`save_media`/`release_media`, without a durable browser artifact store.

Complete Phase A's camera photo, camera video with **optional** microphone
audio, and microphone-only recording. Use browser capability and MIME/codec
detection, explicit permission and audio choices, finite duration/byte/pixel
limits, and clear stop/cancel/close behavior. Save requested files through
authenticated Jupyter/server APIs, not a held Python cell. A memory result,
local preview or saved file does not transfer media to any model.

Implement **Phase B** screen capture/recording, the remaining notebook view and
`read_output` reads (output discovery already belongs to Phase A), and
supported rendered-region capture, local media preview/playback and bounded
frame/image derivatives, and explicit file and clipboard UI. Add passive
`list_canvases` discovery in supported existing output renderers, returning
`CanvasRef` identities bound to their output and rendered-view revision.
Rerender, canvas replacement or output invalidation stops a bound canvas source
and finalizes its recorder as `source_ended`; never follow the replacement. No
app registry or widget integration is required. Add `capture_canvas` for an
origin-clean canvas still; `export_canvas` remains its convenient save form.
A canvas `toBlob` still can be decoded to PIL; `captureStream()` feeds the bounded recorder for motion.
Canvas pixels do not recover vector primitives. Preserve existing SVG output
through `export_output(..., mime="image/svg+xml", save_to=None)`. App-native
SVG/scene exporters are deferred with apps. SVG returned to Python is text.
Neither canvas recording nor still capture adds microphone audio automatically.
Preserve the spec's `setup_share`, `start_share`, `capture_screen`,
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
durable store, or a browser filesystem picker. Developer script/module
helpers and widget/app state/actions/events are outside this task.

**Phase C model image attachment is a separate substantial implementation
phase within the approved main scope.** Implement `attach_media` for an exact
still image or extracted frame through the spec's `MediaRef` (owned `media_id`
or saved path plus SHA-256); memory media need not be saved first. Bind the
identified AI question, visible confirmation, backend capability checks,
genuine media transport,
payload size/pixel limits, preview and budget accounting. Recheck file bytes
and backend support when the question runs; opening or previewing never
attaches. Initial audio and full-video model input return
`provider_unsupported`. The current 64,000-character host-envelope estimate
is not an image-token budget, and text/base64 tool results are not a substitute
for a media transport. Phases A, B and C may proceed under this approved scope
without another phase-by-phase scope approval; if infrastructure cannot
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
save completion/failure, memory retention/release, `save_to` defaults and
explicit paths, PIL/SVG/encoded clip result types, and no implicit provider
transfer. Verify with a real
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
explicit authorization. Each Sol worker updates public docs/examples and
implementation handoff/verification notes with its code and PR. Changes to
approved pre-work specs or research use a separate main-based documentation PR.

At each coherent checkpoint, assign a different Sol-6 agent to independently
review the exact base/head and record findings/dispositions. The author fixes
findings; the reviewer rechecks those fixes. Astra aggregates the evidence. Commit and push verified
topics, open PRs to their selected base, require both actual CI gates, and
respect the user's merge decision unless a particular merge is already
authorized. Preserve the persistent experimental branch and keep Git-source
installation working. No version bump, tag, PyPI upload, website deployment
or promotion to another integration branch follows from this prompt. Completion requires the full new-tool inventory and the existing/new-tool
example coverage above, not just passing tests for a subset. Retire only clean,
verified integrated worktrees owned by this task.

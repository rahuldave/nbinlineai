# Browser, app and local-media tool candidates

**Research and recommendations, 2026-09-28. No feature implementation or release.**
Internal documentation belongs on main; the runtime targets below are separate
decisions. The user requested a fresh dialoghelper survey, local screenshot and
video possibilities, and explicit dependencies on the concurrently developed
notebook execution handoffs.

## Conclusion

Most browser capabilities can be implemented in main-based topics without the
new handoff primitives. A browser operation needs those primitives when its
contract includes executing an identified notebook cell after the current caller
finishes and optionally starting a successor AI question. Browser recording,
permission prompts and asynchronous replies need their own lifetimes, but that
alone does not make them notebook-execution handoffs.

Start with **browser-local artifacts, output export, local capture and download**.
Keep **sending an artifact to the model** as a separate operation. This gives
useful tools for material that must stay on the user's computer, while leaving
a clear path to later agent workflows.

## Evidence and scope

Reviewed nbinlineai main runtime at
[`481ba0d50d6582e7d69e4180415e337042c98029`](https://github.com/rahuldave/nbinlineai/tree/481ba0d50d6582e7d69e4180415e337042c98029).
The active task **Implement queued execution handoffs** uses an experimental
topic based on `f1304d3`; its implementation is in progress, not merged evidence.
Dependency judgments below use the [approved spec](notebook_execution_handoff_spec.md),
not uncommitted worker code. That spec transfers bounded textual execution
results; it does not implement image interpretation or a general event scheduler.

Upstream source was pinned during this survey:

| Repository | Revision | Relevant scope |
| --- | --- | --- |
| [dialoghelper](https://github.com/AnswerDotAI/dialoghelper/tree/99d2efa595239eaac76f727a7e574b6b9ea4b816) | `99d2efa595239eaac76f727a7e574b6b9ea4b816` | Version 0.2.45; Python/browser bridge, screen stills, JSON channels |
| [solvecdp](https://github.com/AnswerDotAI/solvecdp/tree/4d8d2f3fd4a3454b6c10aa1069f9b57b18f94eb7) | `4d8d2f3fd4a3454b6c10aa1069f9b57b18f94eb7` | Connects a CDP client through a dialoghelper channel |
| [fastcdp-chrome](https://github.com/AnswerDotAI/fastcdp-chrome/tree/ac469b36ba14f205f3de2d41af708bb0441ae5f1) | `ac469b36ba14f205f3de2d41af708bb0441ae5f1` | Separate Chrome extension providing tab/debugger access and directory picking |

This was source/documentation inspection. No user's screen, browser session,
camera, microphone or local files were captured. No live browser compatibility
test was performed. Browser support and permissions need capability detection
and later tests on the supported browsers. Dialoghelper declares
[Apache-2.0](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/pyproject.toml#L4-L12);
this survey copies no implementation. Any future reuse must preserve applicable
licenses and nbinlineai's GPL-3.0-only policy.

## What dialoghelper actually supplies

### Page interaction and messages

`add_html(_a)`, `add_scr`, `iife` and `add_mod` inject page content or scripts.
`fire_event(_a)` emits an event; `event_get(_a)` correlates one response by ID.
`js_run(_a)` provides a `done(data)` callback; `js_eval(_a)` runs an async
JavaScript body with an explicit `return` for its JSON result. `trigger_now`/`event_once(_a)` use transient output
scripts. `Channel.connect` supports ongoing JSON requests over a WebSocket relay.
`display_response` separates visible rendering from the tool return, and
`mermaid` is a diagram display helper. These are useful patterns for typed
JupyterLab actions and app messaging, not portable Jupyter APIs.
([Browser bridge](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L159-L343),
[Mermaid](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L790-L808).)

The bridge calls Solveit-specific services such as `add_html_`,
`pop_data_blocking_`, page `pushData` and `/wsx`. Synchronous wrappers block;
async wrappers await replies. Public client code does not reveal the private
gateway's complete lifecycle or security contract. A Python-side localhost URL
identifies the Solveit host, not necessarily the user's browser computer.
([Transport](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L112-L142).)

### Screen stills, not an implemented video recorder

`setup_share` installs a script; `start_share` requests sharing;
`capture_screen` returns a PIL image; `capture_tool` exposes it as a tool.
The public wrapper currently fails to forward its custom `timeout` argument to
the inner capture call. This is a reason to adapt the contract carefully rather
than copy the wrapper unchanged.
([Capture module](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/capture.py#L21-L46).)

The JavaScript uses `getDisplayMedia`, retains a video track, grabs one frame
with `ImageCapture`, scales it onto a canvas and returns a data URL. With no
track it returns without replying. The Python code receives the pixels through
Solveit's reply path: this is not browser-only retention. These files implement
neither `MediaRecorder` nor webcam/microphone capture, and do not establish how
an outer model runtime serializes the returned image. HTML media display could
be built with the generic page bridge, but no named video playback/recording or
iframe-app helper was found in the inspected modules and notebook sources.
([Screenshot script](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/screenshot.js#L1-L23).)

### Other browser tabs: a separate installed component

`solvecdp.JsCDP.connect` passes a dialoghelper channel to a CDP client. The
Chrome extension supplies tab creation/selection/attachment/closure and forwards
CDP commands and events. Its examples cover navigation, accessibility inspection,
JavaScript, screenshots, typing and clicks. This is a distinct route from screen
sharing, with a separate extension and debugger permission. Ordinary JupyterLab
page JavaScript cannot inspect arbitrary signed-in tabs simply because a user
has shared their pixels.
([Client](https://github.com/AnswerDotAI/solvecdp/blob/4d8d2f3fd4a3454b6c10aa1069f9b57b18f94eb7/solvecdp/core.py#L16-L25),
[extension commands](https://github.com/AnswerDotAI/fastcdp-chrome/blob/ac469b36ba14f205f3de2d41af708bb0441ae5f1/background.js#L13-L45),
[examples](https://github.com/AnswerDotAI/fastcdp-chrome/blob/ac469b36ba14f205f3de2d41af708bb0441ae5f1/README.md),
[Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger).)

The extension also has a user-picked directory flow: a browser file handle is
kept in IndexedDB and a read operation returns text through Solveit's page reply
path (`pushData`/`event_get_a`), separate from the CDP WebSocket relay. The handle
can be browser-local while the file contents subsequently leave the browser.
This is not a general binary upload API.
([Directory/file bridge](https://github.com/AnswerDotAI/fastcdp-chrome/blob/ac469b36ba14f205f3de2d41af708bb0441ae5f1/content.js#L27-L68).)

## Candidate tools and implementation targets

Names are illustrative, not approved API signatures. **Main** means a new
main-based topic and reviewed PR that could enter a later stable release; it
does not mean the capability exists now or authorizes a release.

| Candidate interaction | Practical use and proposed boundary | Handoff dependency | Suggested runtime target |
| --- | --- | --- | --- |
| `read_notebook_view`, `read_selection` | Read selected text/cell IDs, visible range and compact UI state from the originating notebook, not whichever tab later gains focus | None; new bounded frontend actions | Main |
| `read_output(cell_id, output_ref)` | Inspect existing text/HTML/table output with explicit MIME filtering and a source/run reference; never imply that it executes code | None for an existing output snapshot | Main |
| `export_output`, `export_canvas` | Save an existing plot/image/SVG or origin-clean canvas; preserve original image data where available | None; browser artifact support | Main |
| `capture_notebook_region` | Capture a rendered cell/output or visible notebook region; bind model/cell/render state and report offscreen or unsupported content | None; renderer or user-approved display capture | Main |
| `request_screen_share`, `capture_frame`, `stop_share` | User chooses a tab, window or screen; capture locally and expose a visible stop control | None; permission UI and capture lifecycle | Main |
| `record_start`, `record_stop`, `record_status` | Bounded screen/canvas video recording, optional audio; return an operation ID rather than holding one tool call open | None for manual start/stop/retrieval; new persistent operation owner | Main |
| `camera_preview`, `camera_snapshot`, `record_camera`, `record_microphone` | User-authorized local preview, camera stills/video or bounded microphone recording | None; device permission/lifecycle support | Main, optional later slices |
| `extract_frames`, `crop_artifact`, `annotate_artifact` | Locally select timestamps, crop/redact stills, or annotate before saving/sharing; create a derivative and retain source provenance | None; local media processing and bounds | Main |
| `choose_local_file`, `save_local_artifact` | Pick files into browser storage and save/download captures on the user's computer; explicit server upload is a different action | None; file UI and artifact store | Main |
| `read_clipboard`, `copy_artifact` | Explicit paste/copy of selected text or supported images; bounded content with browser permission checks | None; separate user action where required | Main, optional |
| `open_app_panel`, `read_app_state`, `call_app` | Registered visualization/form/app inside JupyterLab; typed state/actions through an owned widget or cooperating iframe | None for state and browser-only actions; new app registry/channel | Main foundation |
| `subscribe_app_events`, `read_events` | Bounded event queue for selections, slider changes, capture completion or app results; poll/read later without executing notebook code | None; lifetime, backpressure and teardown contract | Main foundation |
| `attach_artifact_to_prompt` | User selects the exact image/derived frames a model may see | None intrinsically; requires new multimodal transports and budgeting | Main, separate substantial feature |
| Optional `browser_attach`, `browser_inspect`, `browser_click`, `browser_screenshot` | Control a selected external tab through a separately installed/permissioned extension or browser connector | None intrinsically; new connector and authentication/target contract | Main-based integration project if selected; not a small built-in tool addition |
| `run_cell_then_capture_then_prompt` | Execute identified code, wait for its actual render/result, capture that result and start a successor AI question | **Yes**: native execution handoffs; also render readiness, artifact and image-model support | Experimental branch |
| `on_app_event_run_and_prompt` | A browser event schedules identified Python work and a later AI turn; repeated observe/act loops have shared budgets | **Yes** for notebook execution; a new event-to-chain adapter is also needed | Experimental branch, after the current handoff slice |

An app action that only updates JavaScript state remains a main candidate. The
same action wired to execute a notebook cell becomes a handoff composition.
Likewise, an event-triggered AI-only call needs explicit prompt scheduling and
lifecycle design, although it does not inherently require Python execution.
Put autonomous notebook continuation experiments on the experimental branch;
do not claim the current three primitives already implement arbitrary events.

### Concrete camera, microphone and video tools

The browser platform permits more than dialoghelper currently wraps. These are
proposed tools we could build, independently of notebook execution handoffs:

| Operation | Result and example use |
| --- | --- |
| Start/stop camera preview | A local viewfinder; useful for positioning a document or showing a physical experiment before capturing anything |
| Take a camera photo | A locally held still, optionally cropped/redacted; choose separately whether to save it or give it to a model |
| Start/stop camera video | A bounded local recording of a demonstration; optional microphone track with explicit audio choice |
| Start/pause/stop microphone recording | A local audio artifact for a spoken note, pronunciation exercise or interview excerpt |
| Inspect microphone signal | Local level meter, waveform or frequency summary, useful for checking setup or a sound experiment without speech transcription |
| Play/pause/seek local media | Preview a selected audio/video file, choose a timestamp or segment, and control volume without model transfer |
| Extract a video frame or sample frames | A timestamped still/contact sheet from a chosen local file or authorized stream; cap frame count and resolution |
| Record a screen or canvas | Capture a walkthrough or visualization animation, using browser-supported formats and a visible stop button |
| Crop/redact/annotate and export | Produce a local derivative for a report or selectively disclose it later; original and derivative have separate IDs |

Camera/microphone access comes from `getUserMedia`; recording from
`MediaRecorder`; local audio analysis/playback can use Web Audio. Camera preview
or a level meter need not return media to Python at all. Speech transcription,
OCR and semantic image analysis are additional engines, not consequences of
granting device access. A remote engine moves data off-device; a genuinely local
engine would need its own model/runtime and performance evaluation.
([Device capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[recording](https://www.w3.org/TR/mediastream-recording/),
[Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API),
[signal analysis](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode).)

All of these are main candidates as explicit, user-controlled operations. A
workflow such as “watch the camera, run this analysis cell after each capture,
then ask the AI what to do next” is a separate experimental composition with
sampling limits, queue ownership, cancellation and explicit media disclosure.

## Browser constraints that affect the contracts

- **Screen sharing needs a real user gesture and chooser.** A model request can
  present a Share button, but cannot manufacture activation or silently choose a
  screen. Granted display-capture permission cannot simply be persisted for the
  next share session. Stop all tracks when sharing ends or its owner closes.
  ([Screen Capture standard](https://www.w3.org/TR/screen-capture/).)
- **Camera/microphone are separate permissions.** `getUserMedia` requires a secure
  context and user permission; embedded contexts also have permission-policy
  constraints. Audio capture must be explicit, not a side effect of a screenshot.
  ([Device capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).)
- **Video is a stream plus recording/encoding.** `MediaRecorder` can produce
  blobs/chunks from a stream; an origin-clean canvas can supply its own stream.
  Bound duration, resolution, accumulated bytes and frame extraction. Detect
  supported formats instead of promising one codec across browsers.
  ([Recording](https://www.w3.org/TR/mediastream-recording/),
  [canvas stream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream).)
- **A DOM node is not universally screenshot-able by a page API.** Prefer MIME
  or canvas export for known outputs. DOM-to-image reconstruction has fidelity
  limits; display capture samples a rendered surface and may include unwanted
  surroundings. Cross-origin pixels can taint a canvas and prevent export.
  ([Canvas origin rules](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image).)
- **Other apps need cooperation or another permission boundary.** Same-origin
  widgets can expose typed APIs. Cross-origin iframes require a cooperating
  `postMessage` contract with checked origin, source and schema. Ordinary page
  access cannot enumerate/read other tabs. CDP/extension access is a separate
  integration, not a workaround hidden inside a screenshot tool.
  ([Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy),
  [messaging](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).)
- **Saving and clipboard are user-facing operations.** The save picker has
  limited browser availability and requires activation; provide a supported
  download alternative. Clipboard access also has browser-specific permission
  and activation rules. A scripted DOM click is not equivalent to user consent.
  ([Save picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker),
  [clipboard](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API).)

## Keeping material on the user's computer

The proposed artifact contract must distinguish three destinations:

| Destination | What it means | Suitable for strict device-local capture? |
| --- | --- | --- |
| Browser memory/storage or a user-selected local download | Pixels/recording stay in the client; tools return only an opaque ID and bounded non-content status | Yes, with a deliberately local data path |
| Jupyter server/kernel filesystem or saved notebook | Bytes go to the Jupyter host; that host may be remote | Only when that host is the intended local destination |
| Model attachment | Bytes/derived frames go to the configured model service | No for a remote model; it is a separate disclosure decision |

For strict local mode, do not put base64 images, transcripts, OCR, thumbnails or
file contents in tool-result text. Do not insert the media into ordinary notebook
outputs/attachments and then call it local-only: saving that notebook can send it
to a remote Jupyter server. Keep the capture in a browser-owned client artifact
store, preview it locally, and make local download and model attachment distinct
actions. A model may arrange a local capture without receiving its pixels; it
cannot visually reason about pixels it has not been given. Previously existing
notebook outputs may already reside on the server, regardless of how we export
them afterward.

An artifact descriptor could carry an opaque ID, MIME type, dimensions/duration,
size, origin target, capture time, retention mode and allowed destinations.
Avoid leaking sensitive filenames/window titles through that descriptor. Browser
storage is not a permanent export: quotas, deletion and retention need handling.
The origin-private filesystem is isolated from the visible user filesystem and
is affected by storage management; use a user-visible save/export for durable
files. ([OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).)

## What nbinlineai already has and what must be added

Main has an authenticated model-tool browser round trip, bound to the originating
document/model/session/kernel/prompt/answer. Actions and replies are sequential;
there is one pending action, a 45-second wait and a 4,000-character result bound.
Its context snapshot contains source/metadata/execution count, not rich output.
These are sound starting points for bounded named text actions, not binary media
or an indefinite wait for a user chooser.
([Frontend actions](https://github.com/rahuldave/nbinlineai/blob/481ba0d50d6582e7d69e4180415e337042c98029/src/frontendActions.ts#L46-L95),
[server bridge](https://github.com/rahuldave/nbinlineai/blob/481ba0d50d6582e7d69e4180415e337042c98029/nbinlineai/frontend_bridge.py#L70-L275),
[context](https://github.com/rahuldave/nbinlineai/blob/481ba0d50d6582e7d69e4180415e337042c98029/src/context.ts#L12-L45).)

Add explicit browser-owned operation/artifact IDs for user interaction and
recording. A tool can request an operation, return pending status and let the
user complete it later; cancellation, expiry, tab closure and duplicate replies
need defined behavior. These IDs supplement notebook cell IDs: a canvas, media
track, iframe or recording has its own identity and lifetime. Bind results to
the exact capture/render revision. An existing output snapshot is not proof
that a particular newly requested execution produced it.

The current model paths assemble text, including string tool results. The
subscription runtime also disables native image viewing. Image-aware prompts
need a deliberate media schema, transport support for each backend, size/pixel
limits, authorization and preview/budget accounting; base64 inside text is not
equivalent. The existing 64,000-character envelope estimate is not an image-token
budget. This work is independent of queued cell execution.
([Text context](https://github.com/rahuldave/nbinlineai/blob/481ba0d50d6582e7d69e4180415e337042c98029/nbinlineai/context_budget.py#L154-L206),
[tool results](https://github.com/rahuldave/nbinlineai/blob/481ba0d50d6582e7d69e4180415e337042c98029/nbinlineai/prompt.py#L395-L444),
[subscription configuration](https://github.com/rahuldave/nbinlineai/blob/481ba0d50d6582e7d69e4180415e337042c98029/nbinlineai/subscription_runtime.py#L80-L131).)

Direct Python helpers are another entry point. Today's `insert_tools` returns a
receipt and receives a later execution-bound comm acknowledgement. It is not a
general blocking browser RPC. Extend the nonblocking pattern if Python should
request a capture; never hold a Python cell waiting for successor execution on
the same shell. No sidecar is needed merely to run JavaScript or record media
in the browser. A long recording can outlive a prompt through an explicit
browser operation owner; automatically resuming an agent afterward is a separate
continuation feature. ([Existing transports](bundled_tools.md).)

## Suggested delivery order

1. **Main: local artifact foundation.** Bound IDs, local preview, cleanup,
   download, existing image/canvas output export and explicit destinations.
2. **Main: local screen capture.** User share/stop controls and still frames;
   add region selection/redaction and bounded recording in subsequent slices.
3. **Main: typed app interfaces.** Read notebook view/output text, registered
   app state/actions and a bounded event queue. Avoid making arbitrary page
   JavaScript evaluation the default model tool surface.
4. **Main, separate design: image-aware model input.** Explicitly attach chosen
   artifacts only after both transport and budget contracts are defined. Full
   video-model input need not precede useful still frames or local recordings.
5. **Optional separate main integration: external-browser connector.** Adopt an
   extension/CDP approach only if controlling other apps is selected as a goal;
   it needs its own installation and target/permission UX.
6. **Experiment: compose with execution handoffs.** Run → render → capture →
   prompt, or app event → native code → successor prompt. Depend on the reviewed
   handoff interface and add explicit render/event adapters and chain limits.

Later implementation acceptance should include two notebook tabs, target edits,
closed surfaces, chooser denial/timeout, stop/restart, duplicate messages, media
bounds and backend differences. For local-only mode, test that pixels never
enter server requests, notebook saves or provider payloads, including preview
and error paths. Test a remote-server arrangement rather than assuming browser
and kernel share a filesystem. This research does not authorize those features
or paid provider tests; it supplies a menu for choosing the next scope.

Tracking: notebook-agent initiative [#2](https://github.com/rahuldave/nbinlineai/issues/2),
research task `trvoxvks`. The [older dialoghelper catalog](dialoghelper_tool_catalog.md)
remains historical context; the [current bundled tool contract](bundled_tools.md)
describes what is already implemented.

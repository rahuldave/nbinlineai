# Spec: browser, camera, audio and notebook-app tools

**Proposed API contract, 2026-09-28; no implementation or release in PR #20.**
This spec refines the [source-pinned research](browser_media_tool_research.md).
It is the normative proposal where the survey lists alternative designs.
Implementation uses main-based topics and reviewed PRs. The [implementation task
prompt](browser_media_tool_task_prompt.md) is for use after this spec merges.

## Problem statement

A notebook agent should be able to capture camera photos and video, record
audio, inspect existing notebook output, interact with cooperating browser apps,
and save useful media in the user's Jupyter folder. These operations should also
be callable from notebook Python without monopolizing its execution thread.

The user explicitly selected a local Jupyter server, no extra browser extensions,
desktop **and mobile** support, and clearly explained screen-capture gaps.
Capturing/saving media must be useful without sending it to a model.

## Scope and deployment

- The existing nbinlineai JupyterLab extension owns the UI and browser actions.
  No Chrome extension, CDP/debugger connector, ipylab installation, sidecar or
  browser filesystem permission is required.
- The server saves files inside its configured user folder. Do not build a
  separate durable browser artifact store. Temporary recording buffers are fine.
- Cover current desktop Chrome, Edge, Firefox and Safari; Android Chrome and
  Firefox; and iOS/iPadOS Safari. Exercise other installed mobile browsers where
  available; branding does not prove identical API/device behavior.
- A phone accessing Jupyter on the user's computer sends bytes to that computer.
  This is still the selected local-server destination, not phone-only retention.
  A phone normally needs an HTTPS Jupyter origin for camera/microphone APIs;
  the computer's HTTP LAN address is not the phone's localhost secure-context
  exception. Document supported secure access; do not ask users to disable
  browser security or add an extension.
- Core camera/microphone and file operations use portable APIs. Screen surfaces,
  system/tab audio, codecs and some clipboard features can differ. Report actual
  capability and usable alternatives; do not imply that an unavailable feature
  succeeded or silently record a different audio source.
- No automatic cell execution or new AI turn follows a browser event. Those
  compositions belong on `codex/agentic-notebook-experiments`.

## API conventions

Names below are proposed Python functions, re-exported through `nbinlineai.tools`
when available as model tools. Signatures use JSON-compatible values; optional
arguments are keyword arguments. Existing tool declaration/discovery and object
identity dispatch remain authoritative. Adding a group must not enable every
tool by default or exceed the existing active-tool limit.

Direct Python calls return a mutable `BrowserReceipt` immediately, following
`insert_tools()`. It has `operation_id`, `status`, `result` and `error`. Inspect
it in a later cell or use the visible UI; no `.wait()`, blocking polling loop,
nested event loop or synchronous browser RPC is provided. Async `_a` aliases
from dialoghelper are not promised by this phase. Model calls use the existing
authenticated frontend dispatch and receive a bounded result or an operation
receipt; the kernel does not execute a waiting tool body.

### Common results and identity

- `Operation`: `operation_id`, `status`, optional bounded `result` or `error`.
  States: `waiting_for_user`, `running`, `paused`, `saving`, `completed`,
  `cancelled`, `failed`, `expired`. A source-opening operation completes with a
  `source_id`; that source has a separate live lifetime until stopped.
- `File`: server-root-relative `path`, `mime_type`, `bytes`, `sha256`, optional
  `width`, `height`, `duration_seconds`. No media bytes or data URLs in tool text.
- `Source`: `source_id`, `kind` (`camera`, `microphone`, `screen`, `canvas`),
  actual audio/video tracks, supported actions, ownership and live/stopped state.
- `OutputRef`: stable `cell_id`, opaque `output_id`, `revision`, MIME choices.
  IDs refer to the live model. They expire when output changes, the cell is
  deleted or the bound model/session/kernel changes; an index alone is invalid.
- `App`: opaque `app_id`, registered actions and event schemas. It identifies a
  particular owned widget/iframe instance, never whichever app has focus.
- `error`: machine-readable code and short message, with an optional suggested
  alternative. Codes include `unsupported`, `needs_secure_context`,
  `permission_denied`, `device_unavailable`, `stale_target`, `source_stopped`,
  `busy`, `limit_exceeded`, `path_conflict`, `save_failed`, `cancelled`,
  `timeout`, `provider_unsupported` and `invalid_argument`.

Browser operations are bound to the initiating notebook model/session/kernel
and original browser client; cell operations also bind stable cell IDs. A later
prompt in that same notebook may inspect or stop its operation. Focus changes
cannot retarget it, and another client cannot claim it merely by knowing an ID.
Operations may outlive the initiating prompt. Closing the owner, changing kernel
or explicitly cancelling stops tracks/jobs; a prompt finishing normally does
not. A visible notebook media panel exposes pending permission, preview, status
and Stop without requiring another model call.

### File and limit conventions

All `path` arguments are server-root-relative, not kernel-cwd-relative. Empty
output paths choose a unique file in `media/` beneath the initiating notebook's
directory, frozen when the request starts. Return the resolved relative path.
Do not overwrite existing files; explicit file replacement is not in this API.
Reject traversal and destinations escaping the configured root, including
symlink escapes for a filesystem backend. Finalize saves before returning a
`File`; remove incomplete uploads on failure/cancel. Use authenticated Jupyter
Contents/server services independently of Python kernel idleness.

For initial implementation: stills at most 4096 pixels on either side and
16 megapixels, default longest side 1280; recordings default 30 seconds, maximum
300 seconds and 50 MiB buffered/uploaded per operation; at most one recording
per notebook; permission requests expire after 120 seconds. Pause does not
extend the 300-second wall-clock lifetime. Stop safely at limits and report
`stop_reason` (`user`, `duration`, `size`, `source_ended`) with the saved result;
encoding/save failure is an error, not a successful truncation. These bounds
are named configuration/constants, included in capability results and tests.
Resize when requested bounds are valid; reject impossible or invalid values.

Tool JSON must fit the existing 4,000-character reply limit, including its
envelope; errors remain within 500 characters. Lists/events/text paginate or
truncate explicitly. Binary uploads use a distinct authenticated file path,
not the action-reply text field or the 64,000-character prompt envelope.

## 1. Capability and operation tools

| API | Contract |
| --- | --- |
| `browser_capabilities()` | Report feature availability, secure-context status, observed permission state when available, limits and format candidates. Do not trigger permission or guess permission from a missing API. |
| `list_media_sources(kind="all", cursor="", limit=10)` | List available camera/microphone devices with opaque device IDs and pagination. Labels can be absent before permission. No implicit permission request. |
| `operation_status(operation_id)` | Return current state, bounded progress and final file/source/app result when complete. Does not wait for completion. |
| `cancel_operation(operation_id)` | Cancel an unfinished job and release its resources. A completed file is retained; cancellation is not deletion. |

Show unsupported tools clearly in help and capability results. If a declared
tool is unavailable at runtime, return `unsupported` with a precise reason.
Do not hide portability gaps by omitting them from documentation.

## 2. Camera, microphone and recording tools

| API | Contract |
| --- | --- |
| `start_camera(audio=False, device_id="", facing="user")` | Request camera permission through visible UI and open an inline preview. Optional microphone is explicit. `facing` is a preference (`user` or `environment`); report the actual source rather than claiming an unavailable camera was selected. Returns a source when ready. |
| `start_microphone(device_id="")` | Request microphone permission and create an audio source with a local level meter. |
| `capture_camera(source_id="", path="", max_size=1280)` | Save a PNG still from a ready camera source. Empty ID means the unique active camera owned by this notebook; otherwise error. Use a video element and canvas, not a requirement on `ImageCapture`. |
| `stop_source(source_id)` | Stop all tracks of that source. An active recording finalizes as `source_ended`; cancelling the recording instead discards its unfinished file. |
| `start_recording(source_id, path="", duration=30)` | Start bounded recording of the specified source; return immediately. Record only its declared tracks. `path` extension, if supplied, must match the selected supported format. |
| `pause_recording(operation_id)` | Pause encoded recording; reflect actual state. Capture tracks may remain active, and the preview must say so. |
| `resume_recording(operation_id)` | Resume a paused recording without resetting its bounds. |
| `stop_recording(operation_id)` | Stop, flush final encoded data, save and close the recording. Return `saving` until finalization finishes, then a `File`; repeated stop does not create a second file. |
| `record_camera(path="", duration=30, audio=False, facing="user")` | Convenience operation: request permission, preview, record and save. Owns and stops its camera/microphone tracks on completion. No preceding `start_camera` call required. |
| `record_microphone(path="", duration=30, device_id="")` | Convenience operation: request permission, record and save audio; stop its owned tracks afterward. |
| `read_audio_levels(source_id, window_ms=250)` | Return bounded RMS/peak signal levels and optional compact frequency summary, never transcript or raw audio. The source must include audio; observation is limited to 1 second. |

Use `getUserMedia` and `MediaRecorder`, selecting a supported format with
`isTypeSupported` or the browser default. Save the actual MIME type and correct
extension; do not mandate WebM or MP4 on every browser. If the caller requests
microphone audio and it fails, report that failure rather than silently producing
a silent clip. Camera/microphone permissions are mandatory browser UI; a model
cannot manufacture a grant. No speech transcription or OCR engine is implied.

## 3. Screen sharing and screenshots: dialoghelper names

| API | Contract and upstream relationship |
| --- | --- |
| `setup_share()` | Idempotently show this notebook's Share/Stop controls and capabilities. Uses dialoghelper's name; no source capture or injected upstream script. |
| `start_share(audio=False)` | Present the share action. A real user click opens the browser chooser and selects the display surface. Return a pending operation, then a source. If requested screen audio is unavailable, explain and let the user choose silent capture; never substitute microphone audio. |
| `capture_screen(timeout=15, source_id="", path="", max_size=1280)` | Capture one frame from an already granted source, save PNG and return a `File`. Default ID chooses the unique active owned screen source; no source is an explicit error. Timeout bounds frame readiness, not time to grant sharing. |
| `capture_tool(timeout=15, source_id="", path="", max_size=1280)` | Alias of our `capture_screen`, preserving dialoghelper's model-tool name and the same file result. Do not register both aliases by default. |
| `stop_share(source_id="")` | Stop the selected or unique owned screen source; idempotent when already stopped. |

Unlike upstream `capture_screen`/`capture_tool`, these return saved-file metadata,
not a PIL image automatically available to the model. This is a documented
adaptation, not drop-in return-type compatibility. Avoid upstream's missing-reply
case and forward timeout correctly. Screen video uses `start_recording` with the
screen source; it does not need another recorder API. Mobile browsers without
display capture return `unsupported`; camera recording and notebook image export
remain available. Publish a browser/device table for surfaces and audio actually
tested. The UI must explain missing screen support before asking to record.

## 4. Notebook view and existing output

| API | Contract |
| --- | --- |
| `read_notebook_view()` | Read originating notebook's visible range, selected cell IDs and compact UI state. No execution, focus change or notebook mutation. |
| `read_selection(max_chars=2000)` | Read selected text plus its cell ID when selection belongs to this notebook; otherwise return empty. Never global clipboard or another tab. |
| `list_outputs(cell_id, cursor="", limit=10)` | Snapshot existing outputs and return `OutputRef` descriptors/MIME types, not media data. |
| `read_output(cell_id, output_id, revision, mime="text/plain", start=0, max_chars=2000)` | Read bounded existing text/structured table data. No binary-to-base64 reply, no raw script execution and no claim of new execution. |
| `export_output(cell_id, output_id, revision, path="", mime="")` | Save an existing image/SVG or supported data MIME representation. Preserve original bytes where possible. Explicit MIME choice or report the selected type. Unsafe HTML/SVG is not executed in a privileged preview. |
| `export_canvas(app_id, canvas_id, path="", max_size=1280)` | Save an origin-clean canvas registered by an owned app; selectors into arbitrary page DOM are not accepted. |
| `start_canvas(app_id, canvas_id, frame_rate=30)` | Create a video-only source from an owned registered origin-clean canvas, at a requested 1–60 frames/second. Return `source_id` for `start_recording`; report actual settings/support. No implicit microphone mixing. Stop it with `stop_source` or app teardown. |
| `capture_notebook_region(cell_ids, path="", max_size=1280)` | Capture only supported rendered cells/outputs. Validate stable IDs and render revisions; report offscreen/cross-origin/unsupported renderers explicitly. No promise of universal DOM screenshot fidelity and no implicit screen chooser fallback. |

Notebook-source access already has tools; do not duplicate `list_cells` or
`read_cell`. Region capture needs its own supported-renderer matrix; an existing
MIME export is the first useful portable path. All output reads are snapshots;
“execute then capture the new result” remains an experimental composition.

## 5. Saved media, local editing and clipboard

| API | Contract |
| --- | --- |
| `choose_file(accept="", multiple=False)` | Show standard file input, save chosen files into the local Jupyter folder, return files after upload. Cancel/oversize is explicit. No browser File System Access API. |
| `open_media(path, expected_sha256)` | Preview the specified saved image/audio/video in an owned panel, returning a `media_id`. Verify bytes/revision before loading; report unsupported decoding. |
| `play_media(media_id)` / `pause_media(media_id)` | Control this preview. If browser autoplay rules require a click, show Play and return `waiting_for_user`. |
| `seek_media(media_id, seconds)` / `set_media_volume(media_id, level)` | Seek within available duration; volume in [0,1]. Report platforms that disallow programmatic volume rather than asserting success. |
| `close_media(media_id)` | Dispose the preview and temporary URLs without deleting its file. |
| `extract_frames(path, expected_sha256, timestamps, output_dir="")` | Save at most 12 PNG frames at explicit timestamps and report actual timestamps. Operates on browser-decodable local video; capped input/output size. Paginate returned descriptors. |
| `crop_image(path, expected_sha256, x, y, width, height, output_path="")` | Produce a new PNG derivative using pixel coordinates; validate bounds and preserve the source. |
| `annotate_image(path, expected_sha256, annotations, output_path="")` | New derivative with bounded text/arrows/rectangles or opaque redaction rectangles; at most 50 shapes. Redaction writes opaque pixels into the derivative, not a removable overlay. |
| `copy_text(text)` | Copy bounded text after required user activation; show a manual copy control when programmatic writing is unavailable. |
| `paste_content(accept="text,image")` | Explicit paste UI; return bounded text or save pasted image and return a file. No silent background clipboard reads. |

Use normal Jupyter file browsing for already-saved files; no new whole-filesystem
search tool is required. Derivatives record source hash and transformation in
sidecar metadata or the bounded operation result. Byte/hash mismatch returns
`stale_target`. Native recording success does not prove another browser can
decode the same codec; preview/extraction checks decoding separately. Codec
conversion is a possible server follow-up, not an undeclared hard dependency.

## 6. Cooperating browser apps and events

| API | Contract |
| --- | --- |
| `list_apps(cursor="", limit=10)` | List registered app instances and bounded capability/action summaries in this notebook, with pagination. |
| `open_app(app_name, initial_state=None)` | Open an installed/registered app definition; return its `app_id`. Arbitrary URLs are not app definitions. |
| `read_app_state(app_id, fields=None)` | Read only schema-declared state, bounded and revision-tagged. |
| `call_app(app_id, action, arguments=None, expected_revision="")` | Call a registered, schema-validated browser-only action; return its result or operation. No implied Python execution. |
| `close_app(app_id)` | Dispose the instance, outstanding app work and subscriptions. |
| `fire_event(app_id, event, data=None)` | Send a declared one-way app event; acknowledgement means accepted, not a computed response. Name follows dialoghelper. |
| `event_get(app_id, event, data=None, timeout=15)` | Request one correlated app reply, bounded to 15 seconds; Python still receives an immediate receipt. Name follows dialoghelper, not its blocking behavior. |
| `subscribe_app_events(app_id, events)` | Create a bounded subscription to declared events; return a `subscription_id`. Never start an AI prompt automatically. |
| `read_events(subscription_id, cursor="", limit=20)` | Nonblocking paginated read with monotonic cursor and explicit dropped-event count; maximum queue 100 events/64 KiB per subscription. |
| `unsubscribe_app_events(subscription_id)` | Dispose queue and listeners. |

The extension exposes a developer registration contract for app ID/version,
state schema, action input/result schemas, event schemas, canvas IDs and cleanup.
Owned widgets can implement it directly. A cooperating iframe uses a dedicated
message channel bound to its exact window and validated origin/schema; it
receives no server credentials and has no ambient notebook/kernel authority.
Opaque-origin sandboxed frames need a transferred `MessagePort` and instance
nonce rather than trusting `origin="null"`. Events are observations, not agent
instructions. Validate schemas and budgets before returning them to a model.

### Low-level dialoghelper bridge: developer API

Retain familiar names where they are useful to app authors, scoped to an owned
app surface rather than the JupyterLab document. These are developer helpers,
not automatically enabled model tools:

| API | Contract |
| --- | --- |
| `add_html(content, app_id="")` | Create/update an owned sanitized HTML panel; return app identity. No script execution or arbitrary DOM swapping. |
| `add_scr(code, app_id)` / `iife(code, app_id)` | Run developer-supplied code in that app's isolated scripting frame; `iife` wraps an async function body. Explicit app scripting opt-in required. |
| `add_mod(code, app_id)` | Execute a module in the same isolated app surface; no implicit remote/CDN import. |
| `js_eval(code, app_id, timeout=15)` | Async JavaScript body with explicit `return`, returning JSON through a receipt. |
| `js_run(code, app_id, timeout=15)` | Callback-style body with one `done(data)` reply; duplicate completion rejected. |
| `display_response(display, result="")` | Show bounded sanitized Markdown/HTML in an owned visible surface and return only `result` to the model. Media bytes are not inferred from display markup. |

The scripting frame has no access to the parent DOM, cookies, Jupyter tokens or
kernel, and no arbitrary network permission by default. Script/module policy,
CSP and teardown are tested. Do not claim a timeout can interrupt arbitrary
synchronous JavaScript in a DOM-capable frame; untrusted model-generated script
execution is excluded. Long computation belongs in a terminable worker supplied
by the app. Existing trusted notebook code remains a separate trust boundary.
No blocking `Channel.connect`/Solveit `/wsx` relay is imported; the app/event
contract supplies the needed messaging. Other browser tabs remain inaccessible.

## 7. Explicit model attachment

`attach_media(path, expected_sha256, question_cell_id, detail="auto")` proposes
attaching an exact saved image (or extracted video frame) to an identified AI
question. A visible confirmation records the accepted file hash and destination
question in metadata without starting execution. The question must not be
currently running. Recheck bytes and backend support when the user runs it;
changed files fail rather than silently substituting media. Opening a notebook
or previewing a file never attaches it.

The initial supported attachment type is a still image. Audio/full video return
`provider_unsupported` until a reviewed backend capability adds them; local
recording remains useful independently. Add actual multimodal support for each
offered model transport, including preview and budget accounting. Never place
base64 into ordinary text or silently flatten an image to its filename. Expose
unsupported models clearly. The existing 64,000-character host-envelope limit
still applies, with separate media byte/pixel limits and the backend's actual
wire representation accounted for. Do not replay effects during re-budgeting.

## Execution, cancellation and transport

The browser owns live tracks and rendering. The Jupyter server owns authenticated
operation records and file writes. Neither requires an executing Python cell.
Direct Python initiation uses an execution-bound comm receipt; model initiation
uses the SSE/action-reply path. Persistent operations need a new bounded
notebook/client-owned registry because today's prompt-owned action registry
expires at the end of a turn. Do not extend a single 45-second action wait into
an indefinite permission/recording wait.

Deduplicate operation creation by authenticated client/notebook/request ID and
payload. Duplicate start/stop/save delivery must not duplicate captures or files;
a changed payload under the same ID is an error. Validate ownership at every
status/control/upload request. On tab closure/disconnect, lease expiry, kernel
change or server restart, stop/expire live operations, clean partial files and
report loss; do not replay captures after reconnect. Retain final status briefly
for receipt lookup, with explicit expiry and bounded registry size. Final files
survive cleanup. The implementation plan must fix concrete lease/retention
limits before coding this registry.

Browser camera/recording can continue while Python is busy. A new Python helper
cannot execute until its cell is scheduled; comm receipts might not update
until the running cell yields/finishes. Likewise current inline AI invocation
can require the kernel for discovery/context. This proposal does not make a
second AI turn run concurrently in a busy kernel. UI controls and server saves
continue independently. No `run_and_prompt`, `prompt_and_run`, automatic event
continuation, RLM or multi-kernel code is added by this spec.

## Delivery plan and acceptance criteria

All following feature topics target **main**; use reviewed incremental PRs.
Documentation is always authored on main. No version bump or PyPI release is
implied by this spec merge.

1. **Foundation and portable capture:** capability/results/receipts, server save,
   operation lifecycle, `list_outputs` discovery plus `export_output`, camera
   photos/video and microphone recording. Output references must be obtainable
   in this phase. Direct Python and model-tool entry points share behavior.
2. **Remaining browser tools:** screen tools with clear platform gaps, media
   preview/editing, notebook region capture for declared renderers, clipboard,
   registered apps/events and scoped developer helpers.
3. **Image-aware questions:** explicit attachment and genuine model transport
   support. Full audio/video input remains outside the initial attachment API.
4. **Later experimental work:** compose saved media and app events with native
   cell handoffs and successor prompts. This needs a separate experimental plan.

Acceptance requires:

- A camera video with optional microphone and microphone-only audio is recorded,
  stopped, saved and previewed on the desktop/mobile matrix. Permission denial,
  ignored chooser, missing hardware and unsupported codecs give precise results.
- Mobile HTTPS/access requirements and tested device/browser versions are
  documented. Backgrounding, screen lock, interruptions and track-ended events
  stop/finalize or fail explicitly; never promise uninterrupted mobile recording.
- Screen support gaps, available surfaces and audio capture differences appear
  in capability UI/help and a tested compatibility table. No extra extension.
- Saving works while the kernel is busy; capture tool returns only status/file
  metadata. Captured bytes do not enter provider payloads without attachment.
- Two notebooks, two browser clients, focus changes, deleted cells, output
  revisions, kernel replacement, duplicate replies, upload interruption, Stop,
  cancel and reopen cannot redirect or duplicate operations.
- Source bounds, duration/size caps, pause behavior, path/root checks, hash
  checks, resource release and permission revocation have meaningful tests.
- Cross-engine automated tests use isolated JupyterLab on 8897 and deterministic
  providers; real Safari/mobile camera and codec checks supplement them. Never
  use the user's server on 8888. Missing device coverage is reported honestly.
- Existing tool discovery, declarations/aliases, context controls, no-dirty
  reads, output semantics and native notebook execution remain intact.
- Public docs/examples describe implemented behavior; capability groups allow
  users to enable small relevant sets. Independent adversarial review and the
  required CI gates pass at the actual PR base/head.

## Open implementation decisions

Set registry lease/retention constants; choose a supported rendered-region
capture adapter; map tested codecs and backend image transports; decide whether
bounded recordings fit ordinary Contents saves or need a bounded upload route.
These are planning decisions under this contract, not reasons to add browser
extensions or return to browser-only durable storage. A genuinely unsupported
platform feature stays explicitly unsupported; do not invent a successful stub.

## References

- [Research and pinned dialoghelper sources](browser_media_tool_research.md)
- [Implemented tools, ownership and transports](bundled_tools.md)
- [Cell/kernel model](cell_kernel_model_and_context_selection.md)
- [Experimental execution handoffs](notebook_execution_handoff_spec.md)
- [Jupyter Server Contents API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html#put--api-contents-path)
- [Camera/microphone and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Media recording](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [Recording format detection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
- [Screen capture and compatibility](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Browser messaging](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)

Tracked under notebook-agent initiative [#2](https://github.com/rahuldave/nbinlineai/issues/2).
Gest uses the existing research/documentation tags; this prose-only proposal
does not need an AST dependency pass. Implementation planning should inspect
frontend dispatch, kernel receipts, server auth/files, tool registry, context
budgeting and model transports for coupled changes before splitting work.

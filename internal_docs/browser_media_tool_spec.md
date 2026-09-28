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
- Results can stay in memory or be saved by the server inside its configured
  user folder. Do not build a separate durable browser artifact store. Bounded
  temporary media results and recording buffers are part of the operation API.
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
`insert_tools()`. It has `operation_id`, `status`, `result`, `media` and `error`.
For a raster still, the completed Python `result` is a PIL image; in-memory
audio/video returns a `MediaClip` with encoded `data: bytes`, `mime_type` and
duration when known. SVG returns its markup string, not a PIL object; other
native export formats return typed data/bytes appropriate to their MIME type.
`media` is the bounded descriptor/reference used by browser and model tools.
Inspect it in a later cell or use the visible UI; no `.wait()`, blocking polling loop,
nested event loop or synchronous browser RPC is provided. Async `_a` aliases
from dialoghelper are not promised by this phase. Model calls use the existing
authenticated frontend dispatch and receive a bounded result or an operation
receipt; the kernel does not execute a waiting tool body.

### Common results and identity

- `Operation`: `operation_id`, `status`, optional bounded `result` or `error`.
  States: `waiting_for_user`, `running`, `paused`, `saving`, `completed`,
  `cancelled`, `failed`, `expired`. A source-opening operation completes with a
  `source_id`; that source has a separate live lifetime until stopped.
- `Media`: opaque `media_id`, `mime_type`, byte count, `sha256`, optional
  `width`, `height`, `duration_seconds` and saved server-root-relative `path`;
  `expires_at` is the server UTC expiry of the managed media reference.
  A path exists only after a successful save. The descriptor is JSON; Python
  image/clip objects are not serialized into ordinary model tool text.
- `MediaRef`: either `{"media_id": "..."}` for a live immutable media result or
  `{"path": "...", "sha256": "..."}` for an exact saved file. `open_media`,
  editing and attachment accept either without requiring an intermediate save.
  Direct Python may pass a receipt's `media` descriptor. Media IDs identify
  content; preview IDs identify panels and must not be confused with them.
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

### Memory, saving and limit conventions

One argument, `save_to`, controls output persistence throughout capture, native
export, import and editing:

| Value | Behavior |
| --- | --- |
| `None` | Return an in-memory result; do not create a user file. |
| `"auto"` | Save a uniquely named file in `media/` beside the initiating notebook. |
| Other nonempty string | Save to that explicit server-root-relative path. |

Stills, native vector exports and image derivatives default to `None`; audio/
video recording defaults to `"auto"`, with `None` available for short clips.
An explicit save does not remove the image result: Python still gets a PIL image
for a raster still plus saved-file metadata. File-backed recordings need not
also materialize a second full `MediaClip` in Python. A file can be saved later
with `save_media(media, save_to="auto")`; PIL users can also use normal Pillow
operations. Kernel-side `image.save()` uses normal Python filesystem semantics,
whereas our `save_to` paths are relative to the Jupyter server root.

The notebook directory used for `"auto"` is frozen when the request starts;
return the actual path/MIME extension. Empty strings are invalid. For operations
producing several frames/files, an explicit destination is a directory and
generated child names are returned; single-result operations treat it as a file.
Do not overwrite existing files; explicit file replacement is not in this API.
Reject traversal and destinations escaping the configured root, including
symlink escapes for a filesystem backend. Finalize saves before claiming a
saved path; remove incomplete uploads on failure/cancel. Use authenticated Jupyter
Contents/server services independently of Python kernel idleness.

In-memory results use a bounded authenticated notebook/client-owned volatile
registry, not durable browser storage. Keep at most 100 MiB of encoded media per
notebook with a 10-minute idle expiry, reported in the descriptor. Reject a new
result that exceeds the cap rather than evicting an actively used result or
silently writing it to disk. Explicit `release_media` and owner teardown free
managed buffers; existing Python copies remain ordinary Python objects. Enforce
expiry on the server. Successful media consumption (preview/edit/export/attach)
refreshes the idle expiry; active playback renews its bounded owner lease.
Status polling alone does not refresh it. Return updated `expires_at` with
successful access and status responses; saved files outlive reference expiry.
Enforce separate decoded-pixel/working-memory bounds, including batch frame extraction.
This means no application-requested persistent file, not a guarantee about OS
swap or browser-internal storage. Binary delivery to Python uses a validated
binary channel/result fetch, never base64 stuffed into the text action reply;
the implementation must test binding and receipt delivery while the kernel is busy.

For initial implementation: stills at most 4096 pixels on either side and
16 megapixels, default longest side 1280; recordings default 30 seconds. Saved
recordings allow at most 300 seconds and 50 MiB per operation; in-memory
recordings (`save_to=None`) allow at most 60 seconds and 16 MiB. Reject a requested
duration beyond its destination's limit before opening the device; never switch
a memory request to a file implicitly. At most one recording per notebook;
permission requests expire after 120 seconds. Pause does not extend the selected
destination's wall-clock lifetime. Stop safely at limits and report
`stop_reason` (`user`, `duration`, `size`, `source_ended`) with the media result;
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
| `capture_camera(source_id="", save_to=None, max_size=1280)` | Capture a raster still, yielding a PIL image in Python; optionally save it. Empty ID means the unique active camera owned by this notebook; otherwise error. Use a video element and canvas, not a requirement on `ImageCapture`. |
| `stop_source(source_id)` | Stop all tracks of that source. An active recording finalizes as `source_ended` using its selected memory/file destination; cancelling instead discards unfinished recording data. |
| `start_recording(source_id, save_to="auto", duration=30)` | Start bounded recording; return immediately. Record only declared tracks. `None` retains an encoded clip in memory. An explicit file extension must match the selected supported format. |
| `pause_recording(operation_id)` | Pause encoded recording; reflect actual state. Capture tracks may remain active, and the preview must say so. |
| `resume_recording(operation_id)` | Resume a paused recording without resetting its bounds. |
| `stop_recording(operation_id)` | Stop, flush final encoded data and finish in memory or save according to the recording's `save_to`. Report `saving` only while a requested save is pending; repeated stop does not duplicate results. |
| `record_camera(save_to="auto", duration=30, audio=False, facing="user")` | Convenience operation: request permission, preview, record and return/save. Owns and stops its camera/microphone tracks on completion. No preceding `start_camera` call required. |
| `record_microphone(save_to="auto", duration=30, device_id="")` | Convenience operation: request permission, record and return/save audio; stop its owned tracks afterward. |
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
| `capture_screen(timeout=15, source_id="", save_to=None, max_size=1280)` | Capture one frame from an already granted source; completed Python result is a PIL image, optionally also saved. Default ID chooses the unique active owned screen source; no source is an explicit error. Timeout bounds frame readiness, not time to grant sharing. |
| `capture_tool(timeout=15, source_id="", save_to=None, max_size=1280)` | Dialoghelper-name alias using the same image capture and optional save. Before genuine image-tool-result transport exists, return a local media descriptor and explicitly state the model has not received pixels; do not register both aliases by default. |
| `stop_share(source_id="")` | Stop the selected or unique owned screen source; idempotent when already stopped. |

Preserve upstream's useful PIL image result for Python, delivered through our
nonblocking receipt rather than claiming an immediate/awaitable drop-in API.
PIL availability in Python, optional persistence and model image disclosure are
three separate choices. Neither ordinary capture nor its alias automatically
attaches pixels; the explicitly authorized model attachment contract is below.
Avoid upstream's missing-reply case and forward timeout correctly. Screen video
uses `start_recording` (including `save_to=None` for short clips) with the
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
| `export_output(cell_id, output_id, revision, save_to=None, mime="")` | Obtain an existing image/SVG or supported data MIME representation in memory or save it. Preserve native bytes/type where possible: raster image to PIL, SVG to markup text. Unsafe HTML/SVG is not executed in a privileged preview. |
| `capture_canvas(app_id, canvas_id, save_to=None, max_size=1280)` | Raster still from an origin-clean registered canvas, giving a PIL image in Python with optional save. No arbitrary DOM selector. |
| `export_canvas(app_id, canvas_id, save_to="auto", max_size=1280)` | Saving-oriented convenience alias for `capture_canvas`; supports the same explicit `save_to=None` option. This remains raster export. |
| `start_canvas(app_id, canvas_id, frame_rate=30)` | Create a video-only source from an owned registered origin-clean canvas, at a requested 1–60 frames/second. Return `source_id` for `start_recording`; report actual settings/support. No implicit microphone mixing. Stop it with `stop_source` or app teardown. |
| `capture_notebook_region(cell_ids, save_to=None, max_size=1280)` | Raster capture of supported rendered cells/outputs, in memory or saved. Validate IDs/render revisions; report offscreen/cross-origin/unsupported content. No universal DOM screenshot promise or implicit screen chooser fallback. |

Notebook-source access already has tools; do not duplicate `list_cells` or
`read_cell`. Region capture needs its own supported-renderer matrix; an existing
MIME export is the first useful portable path. All output reads are snapshots;
“execute then capture the new result” remains an experimental composition.

### Canvas, vector export and notebook views

Here canvas means the browser's HTML `<canvas>`, not a generic editor/document.
Its exported surface is a bitmap. `toBlob` obtains a still; `captureStream`
provides video frames to the same recorder used for camera/screen sources.
Canvas capture itself needs no camera permission or screen chooser, adds no
microphone, and captures only that drawing surface. The app must register and
own it; cross-origin-tainted canvases fail, and WebGL renderers may require an
app-specific render/readback adapter. Background throttling can affect frame
timing; the requested rate is not a guaranteed rendering rate.

Vector output requires an existing SVG output or an app-owned exporter using
its retained drawing model. `export_output(..., mime="image/svg+xml")` preserves
existing SVG; `export_app(app_id, format="svg", save_to=None)` requests native
SVG from a registered exporter. SVG is markup, not PIL. App-native JSON/PDF is
available only if that app declares such an exporter. Putting a bitmap inside
an SVG wrapper is not vector recovery. Automatic tracing is outside this scope.
([Canvas bitmap](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API),
[still export](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob),
[canvas video](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream).)

Notebook view tools answer “what is selected/visible?”; existing `read_cell`
reads code/source, while output tools read what a cell already produced. They
inspect the originating live notebook, including unsaved state, and do not run
cells or browse other notebooks. Capture/export consumes those existing results.

## 5. Memory or file media, playback, editing and clipboard

| API | Contract |
| --- | --- |
| `choose_file(accept="", multiple=False, save_to=None)` | Standard file input; retain selected content in memory or copy to the selected server destination. Returning a selection does not mandate saving a new file. Cancel/oversize is explicit. |
| `open_media(media)` | Preview a `MediaRef` in an owned panel, returning a `preview_id`. Verify immutable content/file hash; report unsupported decoding. No save/copy is implied. |
| `play_media(preview_id)` / `pause_media(preview_id)` | Control this preview. If autoplay rules require a click, show Play and return `waiting_for_user`. |
| `seek_media(preview_id, seconds)` / `set_media_volume(preview_id, level)` | Seek within available duration; volume in [0,1]. Report platforms that disallow programmatic volume. |
| `close_media(preview_id)` | Dispose the preview and temporary URLs without deleting the input media/file. |
| `extract_frames(media, timestamps, save_to=None)` | Return at most 12 raster frames at explicit timestamps, with actual timestamps, as PIL images in Python or optionally saved files. Accept a memory or file clip; cap aggregate encoded/decoded size and paginate descriptors. |
| `crop_image(media, x, y, width, height, save_to=None)` | Return a new raster derivative, optionally saved; pixel coordinates, checked bounds, source preserved. |
| `annotate_image(media, annotations, save_to=None)` | New raster derivative with bounded text/arrows/rectangles or opaque redaction rectangles; at most 50 shapes. Redaction changes derivative pixels. SVG/vector editing requires an app-native action, not silent rasterization. |
| `save_media(media, save_to="auto")` | Persist the referenced memory/file result under a new server path; `None` is invalid for this explicitly saving operation. Existing files are never overwritten. |
| `release_media(media_id)` | Release managed in-memory bytes/references, revoke dependent previews and return a clear expired result to later requests. Do not delete a saved file or already-delivered Python objects. |
| `copy_text(text)` | Copy bounded text after required user activation; show a manual copy control when programmatic writing is unavailable. |
| `paste_content(accept="text,image", save_to=None)` | Explicit paste UI; return bounded text or a raster image with optional saving. No silent background clipboard reads. |

Use normal Jupyter file browsing for already-saved files; no new whole-filesystem
search tool is required. Derivatives record source hash and transformation in
bounded operation metadata (and a sidecar only when saving is requested). Byte/hash mismatch returns
`stale_target`. Native recording success does not prove another browser can
decode the same codec; preview/extraction checks decoding separately. Codec
conversion is a possible server follow-up, not an undeclared hard dependency.

## 6. Cooperating browser apps and events

**New proposed infrastructure, not an existing nbinlineai app system.** Here an
app is a particular interactive HTML/JavaScript component hosted in an owned
notebook output or JupyterLab panel: for example, a chart with sliders, a form,
an image annotator or a small simulation. This repository currently has no
`open_app` registry, app catalog or typed app-action/event framework. The table
below proposes that contract; it must not be described as wrapping something
already shipped. An ordinary HTML display is not automatically a controllable
app: it must expose the state/actions/events described here. Existing Jupyter
widgets or external sites would need explicit adapters/cooperation, not just an
`app_id`. Media capture itself does not depend on this new app framework.

The foundational capability is to create an owned interactive surface, address
it by a stable ID and exchange messages. A reusable named app definition and
`open_app(app_name)` are an additional layer. This distinction should remain
visible during API review rather than presupposing an installed app ecosystem.

| API | Contract |
| --- | --- |
| `list_apps(cursor="", limit=10)` | List registered app instances and bounded capability/action summaries in this notebook, with pagination. |
| `open_app(app_name, initial_state=None)` | Open an installed/registered app definition; return its `app_id`. Arbitrary URLs are not app definitions. |
| `read_app_state(app_id, fields=None)` | Read only schema-declared state, bounded and revision-tagged. |
| `call_app(app_id, action, arguments=None, expected_revision="")` | Call a registered, schema-validated browser-only action; return its result or operation. No implied Python execution. |
| `export_app(app_id, format="svg", save_to=None)` | Invoke a declared native exporter, returning SVG text, typed scene data or format bytes in memory or saved. Preserve the app's declared vector/scene content; unsupported formats fail, not raster fallback. |
| `close_app(app_id)` | Dispose the instance, outstanding app work and subscriptions. |
| `fire_event(app_id, event, data=None)` | Send a declared one-way app event; acknowledgement means accepted, not a computed response. Name follows dialoghelper. |
| `event_get(app_id, event, data=None, timeout=15)` | Request one correlated app reply, bounded to 15 seconds; Python still receives an immediate receipt. Name follows dialoghelper, not its blocking behavior. |
| `subscribe_app_events(app_id, events)` | Create a bounded subscription to declared events; return a `subscription_id`. Never start an AI prompt automatically. |
| `read_events(subscription_id, cursor="", limit=20)` | Nonblocking paginated read with monotonic cursor and explicit dropped-event count; maximum queue 100 events/64 KiB per subscription. |
| `unsubscribe_app_events(subscription_id)` | Dispose queue and listeners. |

The extension exposes a developer registration contract for app ID/version,
state schema, action input/result schemas, event schemas, canvas IDs, native
export formats/handlers and cleanup. Native exporters use the bounded media
result channel, not large strings in an ordinary tool reply.
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

`attach_media(media, question_cell_id, detail="auto")` proposes attaching an
exact raster image (or extracted frame) from memory or a file to an identified
AI question. A visible confirmation records the accepted hash and question
without starting execution. The question must not be running. Recheck bytes
and backend support at execution; changed files or expired memory fail rather
than silently substituting content. A pending in-memory attachment is volatile
and expires with its result; storing its opaque reference in metadata does not
serialize pixels into the notebook or make it survive reopening. Show expiry
clearly and offer an explicit save if persistence is wanted. Previewing never
attaches. SVG is not silently rasterized for this initial image-input contract.

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
operation records, bounded temporary media and requested file writes. Neither
requires an executing Python cell.
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
report loss; do not replay captures after reconnect. Expire managed in-memory
results on owner loss and never save them as an implicit cleanup fallback. Retain final status briefly
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

1. **Foundation and portable capture:** capability/results/receipts, bounded
   memory/PIL and encoded clip results, shared `save_to` and explicit server save,
   operation lifecycle, `list_outputs` discovery plus `export_output`, camera
   photos/video and microphone recording. Output references must be obtainable
   in this phase. Direct Python and model-tool entry points share behavior.
2. **Remaining browser tools:** screen tools with clear platform gaps, media
   preview/editing, notebook region capture for declared renderers, clipboard,
   registered apps/events and scoped developer helpers.
3. **Image-aware questions:** explicit attachment and genuine model transport
   support. Full audio/video input remains outside the initial attachment API.
4. **Later experimental work:** compose media results and app events with native
   cell handoffs and successor prompts. This needs a separate experimental plan.

Acceptance requires:

- A camera video with optional microphone and microphone-only audio is recorded,
  stopped, retained in memory or saved as requested, and previewed on the
  desktop/mobile matrix. Permission denial,
  ignored chooser, missing hardware and unsupported codecs give precise results.
- Mobile HTTPS/access requirements and tested device/browser versions are
  documented. Backgrounding, screen lock, interruptions and track-ended events
  stop/finalize or fail explicitly; never promise uninterrupted mobile recording.
- Screen support gaps, available surfaces and audio capture differences appear
  in capability UI/help and a tested compatibility table. No extra extension.
- Capture works without mandatory persistence. Python receives actual PIL
  stills/encoded memory clips through receipts; model text gets bounded media
  descriptors. Requested saving works while the kernel is busy. No captured
  bytes enter provider payloads without attachment.
- Canvas stills, animation clips and app-native vectors preserve their different
  formats and capabilities. Memory/file inputs work in preview and editing;
  derivatives preserve sources and obey `save_to`. Test no unintended file or
  sidecar writes for `None`, memory caps/expiry/release, and native export gaps.
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

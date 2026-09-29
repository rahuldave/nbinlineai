# Worked notebook execution record

This is an in-progress record for the opt-in worked gallery. Execution uses an
isolated JupyterLab on port 8897, browser sessions including the user's Chrome
for physical camera permission, the normally configured nbinlineai ChatGPT
subscription, and disposable notebooks. The
published examples must retain observed outputs and tool-call evidence; an
accepted browser-operation receipt alone does not establish completion.

## Camera

On 2026-09-29, the user opened Chrome to the isolated JupyterLab and granted
camera permission. In that browser, saved concise AI answers and one-use tool
traces show `start_camera(audio=False)` acquiring a real source, followed by a
completed `operation_status`. `capture_camera` then produced a real 640×480 PNG
managed-media result, verified by a later completed status. After `stop_source`,
`record_camera(audio=False, duration=5)` produced a real five-second
`video/webm;codecs=vp9` clip of 1,196,251 bytes, also verified by a later
completed status. The canonical capture notebook publishes the answer and
trace evidence without embedding the camera still, video bytes, or source IDs.
The user explicitly permitted the camera test and publication of their image.

Earlier on 2026-09-29, a separate bounded diagnostic used installed Chrome with a
fresh profile and origin-scoped camera permission on the owned isolated
JupyterLab. The browser reported camera permission `granted` and one video
input, but both `getUserMedia({video: true, audio: false})` and the default
ideal-facing constraint remained unresolved for 20 seconds each. Neither
returned a stream or a DOM exception. The diagnostic stopped any late stream
tracks, closed its browser and server, and left port 8897 free. Only device
kinds and counts were retained; no device labels or identifiers are published.

The direct Python calls for `start_camera`, `capture_camera`, and `record_camera`
remain runnable demonstrations but were not executed in the published capture
notebook. Their earlier in-app browser permission attempt expired. The
execution gate defers only those three direct calls; it requires each saved AI
answer and observed call, with the completed source, still, and clip established
by linked later status answers. No simulated camera result is claimed.

## Completed direct media examples

The playback notebook was executed in one isolated JupyterLab/kernel session.
Its generated PNG went through the visible file chooser; its quiet 60-second
WAV advanced from playback time 0 to 5.107 seconds before Pause. Seek returned
2.5 seconds, volume returned 0.25, and Close and the imported-image release
completed. The browser Copy shortcut and Paste control returned the exact
37-character disposable sample. Nine direct calls have separate completed
receipt inspections, and generated sample files were removed. The saved
playback example retains the actual outputs; its AI questions remain unrun.

The capture notebook currently retains a genuine **partial** microphone run:
device listing, microphone start, positive audio levels, microphone-backed
recording with pause/resume/stop, source stop, and a separate one-shot recording.
The embedded Opus clips independently decode to 20.64 and 6.96 seconds of
playable audio. The recording receipt's 24.629-second duration includes paused
wall time and is not its playable duration. Nine direct calls and later terminal
receipts are saved. A separate real `setup_share` call and later completed
receipt are also saved; the remaining screen calls, AI examples, and final
shared cleanup cell are still unrun in that notebook. Server teardown released
the disposable run's remaining memory media.

The integration notebook retains a direct run from one isolated
kernel: an 8×8 notebook PNG was listed, exported, previewed, cropped to 4×4,
and saved with a provenance sidecar. Later receipt inspections confirmed each
operation before dependent cells used it. The notebook checked both pixel
values and file hashes, then completed preview/media release and removed its
generated image and sidecar. A separate guarded ChatGPT `gpt-6-sol` pilot on
the unchanged canonical notebook executed the two setup cells and saved one
answer to `integration-list-ai-question`. Its retained subscription trace has
exactly one `list_outputs` call for `integration-output` and one accepted
receipt. Both the immediate receipt and the answer say the operation was
`running`; neither reports an output ID or MIME type. The following
`integration-list-ai-ready` status question has not run, so this AI tool
example is partial until a later terminal receipt verifies its effect. The
attachment confirmation and other AI questions are also still unrun.

The attachment notebook retains an actual direct image confirmation with a
later completed receipt, plus two earlier genuine AI tool answers and traces.
The final image question is not published as a completed answer: its retained
private run predates the current trace-free plan attestation, and a fresh
authorized submission is pending. A private test observer independently
verified that earlier submitted turn contained one native image with the
confirmed PNG hash; this is not a claim that the canonical final question has
been rerun.

The `insert_tools` helper inserted a real Markdown declaration immediately
after its calling cell. A later kernel turn inspected `status='inserted'` and
the same cell ID, which is preserved in the saved notebook. The
`tools_markdown` helper printed generated declarations in a separate direct
run. The live-notebook tutorial also retains its actual setup/reference
outputs; its AI editing questions remain unrun.

## Ordinary JupyterLab comparisons

Fourteen editor actions in the live-tool catalog were performed on a second
disposable notebook through ordinary JupyterLab controls: list, read, find,
insert, replace, delete, move, copy, split, and merge examples. Each action
was saved through JupyterLab and checked against the resulting notebook cells
before its concise observation was attached to the canonical comparison cell.
The public web tutorial was opened in a browser; a separate disposable
notebook received an ordinary saved Markdown note citing its source. Its
observed comparison is attached to the mapped `url_to_note` cell. The
disposable scratch edits themselves were not copied into the runnable catalog
notebook.

## Screen-share direct status

On 2026-09-29, earlier bounded direct attempts completed `setup_share` and
reached `start_share`'s `waiting_for_user` state, then used the notebook's
visible Share control. A separate setup-only pass saved the genuine completed
`setup_share` call and later inspection (`share_controls: true`,
`screen_available: true`). Those earlier `start_share` attempts did not complete.

The initial computer-use route attached to an old, unrelated Chrome for
Testing process showing **New Tab**. An intervening attempt confirmed this
same-bundle mismatch: its owned disposable browser was PID 65835, while native
app control still attached to the unrelated PID 10120. No unrelated tab or
chooser row was selected. In three later, process-specific attempts, native
accessibility and window inspection did identify the owned browser and chooser.
The first showed one disposable notebook tab in the chooser, but exposed no
accessibility element for its tab tile, so it was left unselected. In the next
two attempts, a fresh image of the owned window identified the sole disposable
tab row; a guarded native click inside that row did not establish a selection.
One post-click image was unavailable; the final attempt's post-click image and
accessibility state both showed Share still disabled. Share was never pressed
in the native chooser, and each `start_share` receipt failed its bounded
completion check. All owned browser/server processes were stopped and port
8897 was free afterward.

One later isolated direct attempt reached the same chooser with a single
disposable JupyterLab tab. Full-display observations before and after
`start_share` showed no unexpected system permission alert during that session.
The user selected the sole tab in the browser chooser; the agent made no
chooser selection. The original `start_share` operation then completed with
`display_surface: browser`, video enabled, and audio disabled. In the same
notebook/kernel session, later inspections confirmed completed `capture_screen`
and `capture_tool` operations. Each captured a 1280×670 image of the disposable
target notebook and displayed a 320×240 preview. `stop_share` and its later
inspection completed
with `stopped: true`. Only these genuine direct-call outputs and receipt
inspections were added to the public capture notebook. Its AI examples remain
unrun. The separate actual owned-tab video used by transform examples remains
independent evidence.

## Native Run All observation

On 2026-09-29, a disposable direct notebook used JupyterLab's native **Run All
Cells** menu action. The `start_share(audio=False)` call returned an initial
receipt, and the following marker cell executed without clicking the visible
Share control. That initial receipt did not prove a completed screen share.

A second disposable pass used native **Run All Above Selected Cell** for only
the setup, start-share, and marker cells. The marker executed at count 3. A
separate kernel turn then observed the exact start-share operation in
`waiting_for_user`; no chooser or screen stream was claimed. Later cancellation
changed that same operation to `cancelled`, and a final status query confirmed
the original operation ID and cancelled state. This shows that direct Run All
continues past an immediate browser receipt while the user action remains
pending. The corresponding AI-question Run All pass remains untested while the
configured ChatGPT subscription is usage-limited; the question about using
existing paid credits has not been answered.

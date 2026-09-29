# Worked notebook execution record

This records what was actually run for the worked gallery on 2026-09-29. The
browser trials used disposable notebooks, real JupyterLab kernels, the isolated
loopback server on port 8897, and the configured ChatGPT subscription with
`gpt-6-sol` in Compact mode. AI answers and observed tool-call traces are saved
in the example notebooks. A browser tool's initial operation receipt is not
treated as a completed result: a later `operation_status` answer or a separately
labeled browser observation establishes the outcome.

Evidence revisions reviewed here: capture notebook `7eb77ec`, its focused
recorder-resume checker `54c17dc`, and playback notebook `c26e16b` (source
topic commits, subsequently integrated into the guide branch).

## Capture, sources, and recording

[`browser-media-capture.ipynb`](../examples/browser-media-capture.ipynb) contains
real direct Python runs for microphone source discovery, start, audio levels,
recording, pause, resume, stop, one-shot microphone recording, and source
cleanup. The saved Opus clips independently decode to 20.64 and 6.96 seconds
of playable audio. The longer recording's 24.629-second operation duration
includes paused wall time; it is not playable duration. Direct screen sharing
also completed after the user selected the disposable notebook tab in the
browser chooser. The later receipts verify a browser-tab source, `capture_screen`
and `capture_tool` stills, and `stop_share`.

The same notebook retains guarded ChatGPT calls and later status answers for
real microphone access and levels, a seven-second microphone clip, screen-share
setup, start, both screen-capture tools, stop, and managed-media cleanup. The
user granted microphone access and selected what to share. Screen stills from
the AI run were 1280×800.

### Camera

AI camera calls ran in the user's Chrome after camera permission was granted:
`start_camera(audio=False)` returned a real source,
`capture_camera` produced a 640×480 PNG, and `record_camera(audio=False,
duration=5)` produced a five-second VP9/WebM clip. Later status answers verify
each result. Camera image and video bytes, microphone bytes, and device IDs are
omitted from the public notebook. The three **direct Python** camera cells
remain runnable but have no saved completed execution; the strict checker
records only those three explicit deferrals. An earlier permission attempt in
the in-app browser expired and does not count as camera success.

The shared recorder was also exercised through AI on a generated, silent 64×32
canvas source. The first recording reached `paused` after `pause_recording`; a
guarded `resume_recording` call changed its visible Media row from `paused` to
`running`. It later reached the 300-second wall limit before another AI status
check, so its resume is a labeled browser observation rather than a terminal AI
status claim. A separate recording was explicitly stopped and confirmed by
`operation_status`: 54.5537 seconds of VP9/WebM video. The direct microphone
pause/resume/stop run is independent evidence for those controls. An earlier AI
microphone recording reached the 60-second memory limit before a pause could
be confirmed. Three old media references expired before cleanup; one later
`release_media` call returned `released: true`, but its status lookup was
`stale_target`, so no terminal release status is claimed for it.

## Import, playback, and clipboard

[`browser-media-playback.ipynb`](../examples/browser-media-playback.ipynb) saves
real direct calls and completed receipt inspections for file choice, import,
audio open/play/pause/seek/volume/close, clipboard copy/paste, and media
release. Its generated PNG was selected in the visible file chooser. Its
generated 60-second WAV played to 5.107 seconds before the direct Pause; Seek
returned 2.5 seconds, volume returned 0.25, and the opened preview closed.
The fixture files were removed after the run.

The notebook also saves concise ChatGPT questions, observed calls, and final
status answers for every import/playback/clipboard tool. AI file choice
completed on the generated PNG, and its managed media was released. AI
`open_media` created a separate audio preview; `close_media` closed that preview
without targeting the direct example's preview. AI `play_media` was confirmed
playing at 0.11235 seconds. A fresh muted run confirmed `pause_media` at
41.751484 seconds with `playing: false`; the preview had been set to volume
zero before this retry. AI Seek returned 2.5 seconds and volume returned 0.25
while paused. The visible browser Copy control completed with `copied: true`.
For AI Paste, the computer-control test clipboard was explicitly seeded with
the known disposable sample before a real paste keystroke into the visible
field. The later status returned that exact text without truncation. This
demonstrates the paste flow; it does **not** establish that the preceding Copy
transferred text into the computer-control virtual clipboard.

## Notebook outputs and canvas

[`browser-media-outputs.ipynb`](../examples/browser-media-outputs.ipynb)
retains real direct runs for reading the notebook view and selection, listing
and reading existing outputs, exporting a generated 8×8 PNG, enumerating and
capturing a generated 64×32 canvas, exporting that canvas, starting and
stopping its source, capturing a visible output region, and releasing the
managed results. A later direct selection trial returned the exact selected
line `SELECT_ME = "blue square"` from its live editor cell.

The saved ChatGPT sequence has guarded calls and terminal status answers for
the view, an empty selection, output list/read/export, canvas list/capture/
export/start/stop, visible-region capture, and four successful media releases.
The initial empty-selection answer is retained as observed, not presented as
the nonempty demonstration. A separate AI question in a fresh browser run
returned the selected text `selected blue square` from `selection-ai-target`;
its later status answer was saved in the notebook.

## Other worked examples

The integration notebook's direct run listed, exported, previewed, cropped,
saved, and released an 8×8 generated PNG, checking pixels and file hashes. Its
earlier AI `list_outputs` pilot saved one accepted call, but only the immediate
`running` receipt; a terminal output listing and its other AI questions remain
unrun in that notebook. The attachment notebook has direct image confirmation
and two earlier AI tool answers. Its final image question has not been
republished with a fresh authorized submission. The helper examples executed
real `insert_tools` insertion and `tools_markdown` generation. The live-notebook
tutorial's setup/reference cells ran; its AI editing questions remain unrun.

Fourteen ordinary JupyterLab editor actions and one public-page note were run
in disposable comparison notebooks for the live-tool catalog. Their observed
results are attached to the mapped canonical cells, but the scratch edits were
not copied into the catalog notebook.

## Native Run All limit

A disposable native **Run All** pass ran the cell following a direct
`start_share` call while that operation still needed a browser choice. A second
**Run All Above Selected Cell** pass likewise reached its marker while the
original share operation was `waiting_for_user`; later cancellation was
confirmed on that same operation. These observations show that ordinary Run
All advances past an immediate browser receipt, not that it waits for the
interactive action to finish. AI-question Run All remains untested.

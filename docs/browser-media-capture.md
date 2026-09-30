---
title: Camera, microphone, and screen tools
---

# Camera, microphone, and screen tools

Use these tools in an **open JupyterLab notebook tab**. The browser asks you to allow a camera or microphone and lets you choose what to share from your screen. The AI cannot grant permission or choose a window for you. Start with the [camera, microphone, and screen notebook](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html), which pairs direct Python calls with short AI questions for the same tools. Point the camera at something you are willing to save or show, and choose a screen area without private content.

Each Python call returns a `BrowserReceipt` promptly. Run the call in one cell, wait for the notebook's **Media** row to finish, then inspect that **same receipt** in a later cell. Check `status` and `error` before using `result` or `media`. An AI tool result is a snapshot: when it says `waiting_for_user` or `running`, complete the visible action and use a later AI question with `operation_status(operation_id)`. That later status is what establishes a finished source or capture. The [receipts guide](browser-media-foundation.md) explains the fields, saving, cancellation, and cleanup.

## Take a camera photo

Run each block as a separate cell. First open the camera and allow the browser prompt if it appears:

```python
from nbinlineai.tools import start_camera, capture_camera, stop_source

camera = start_camera(audio=False)
```

After the Media row finishes, inspect the receipt. A completed result supplies the source ID needed for a still:

```python
print(camera.status, camera.error)
still = None
if camera.status == "completed":
    camera_id = camera.result["source_id"]
    still = capture_camera(camera_id, save_to=None)
```

When the still's Media row finishes, display the actual Pillow image and stop the live camera. Inspect the stop receipt in another cell:

```python
from IPython.display import display

if still is not None:
    print(still.status, still.error)
    if still.status == "completed":
        display(still.result)
    if still.status in {"completed", "failed", "cancelled", "expired"}:
        stopped_camera = stop_source(camera_id)
```

The notebook shows completed real-camera results in the [direct start](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-start_camera-call), [capture](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-capture_camera-call), and [cleanup](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-cleanup) cells. It saves dimensions and receipt status without the photo or device ID. Its [AI start question](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-camera-workflow) first records the operation ID; the [status question](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-camera-ready) verifies the source before the [AI still request](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-camera-still). If camera access fails, read the receipt's error and continue with the independent microphone or screen examples.

## Use the microphone and record audio or video

`list_media_sources(kind="all", cursor="", limit=10)` lists camera and microphone device IDs without requesting permission. Labels may remain hidden until permission is granted. The [direct list](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-list_media_sources-call) and [AI list question](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-list-sources) show the difference between a Python receipt and an AI snapshot. Browser IDs remain exact when returned; `labels_truncated` or `device_id_omitted` tells you when display text or an oversized ID could not fit.

`start_microphone(device_id="")` opens a source with a local level meter. After its receipt completes, pass its `source_id` to `read_audio_levels(source_id, window_ms=250)` while making a sound. The result reports bounded RMS and peak levels, not a recording or transcript. The notebook has [direct microphone](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-start_microphone-call) and [level](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-read_audio_levels-call) calls plus [AI microphone](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-microphone-workflow) and [AI level](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-microphone-levels) questions. Stop the source with `stop_source(source_id)` when finished.

For a controlled recording, call `start_recording(source_id, save_to=None, duration=60)` on an active camera, microphone, screen, or canvas source. The notebook [starts](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-start_recording-call) a microphone recording, [pauses](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-pause_recording-call), [resumes](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-resume_recording-call), and [stops](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-stop_recording-call) it after several active seconds. The [AI recording questions](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-recording-start) use the same original recording operation ID throughout. **Inspect the original `start_recording` receipt after stopping** to get the finished clip, actual MIME type, and duration. The `stop_recording` receipt describes the control action; it is not the encoded clip. Pausing encoding does not stop the live source or extend the recording's wall-clock limit.

For one call that opens, records, and closes its own tracks, use `record_camera(save_to=None, duration=5, audio=False)` or `record_microphone(save_to=None, duration=7)`. Their [direct camera](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-record_camera-call) and [direct microphone](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-record_microphone-call) examples request real permission and later inspect actual clip metadata. The saved direct camera example completed a five-second video and shows its type, duration, and byte count without storing the video. The notebook also contains [AI camera recording](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-camera-clip) and [AI microphone recording](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-microphone-clip) questions. A source ending finalizes an active recording with `stop_reason="source_ended"`; cancelling discards unfinished recording data.

## Share a screen and capture a frame

`setup_share()` reveals the notebook's sharing controls and checks support without opening the system chooser. `start_share(audio=False)` leaves a pending operation: click the visible **Share** control and choose a tab, window, or display in the browser chooser. The model cannot make that selection. If you request display audio and the browser cannot provide it, the UI offers a separate choice to share without audio; it does not substitute your microphone.

Once `start_share` completes with a `source_id`, call `capture_screen(source_id=screen_id, save_to=None)` for a PNG frame. `capture_tool` is an opt-in alias for the same frame capture. Its model reply contains a local media descriptor, **not image pixels sent to the model**. Use `stop_share(screen_id)` when done. The [direct setup](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-setup_share-call), [share](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-start_share-call), [screen frame](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-capture_screen-call), [alias](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-capture_tool-call), and [stop](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-stop_share-call) cells each have a later inspection cell. The [AI share sequence](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-share-workflow) likewise checks each operation's status before using its source ID.

## Saving, limits, and notebook execution

`save_to=None` keeps a still or short clip in managed memory. `save_to="auto"` creates a unique file in `media/` beside the notebook; an explicit destination is relative to the Jupyter server root and cannot overwrite an existing file. A finished still is a Pillow image in Python; a short in-memory recording is a `MediaClip`. The browser reports the actual recording MIME type and extension. Stills default to a longest side of 1280 pixels and are bounded by 4096 pixels per side and 16 megapixels. Saved recordings allow up to 300 seconds and 50 MiB; in-memory recordings allow up to 60 seconds and 16 MiB. Only one recorder can run for a notebook at a time. See [browser media receipts](browser-media-foundation.md) for safe paths and releasing managed bytes.

**Run interactive calls one step at a time.** Run All can advance from a call to a dependent cell while the browser is still asking for permission, recording, or waiting for the share chooser. The notebook therefore separates calls, inspections, and short AI status questions. It has no automatic next AI turn when you grant permission. Camera and microphone access on another device usually requires an HTTPS Jupyter origin; screen capture and display audio support vary by browser and device. If a capability is unavailable, the receipt reports it rather than silently selecting another source.

---
title: Camera, microphone, and screen tools
---

# Camera, microphone, and screen tools

These tools operate in the open JupyterLab notebook tab. A Python call returns a `BrowserReceipt` promptly; inspect `status`, `result`, `media`, and `error` in a later cell. Camera and microphone permissions, and the screen chooser, remain browser actions for you to approve. Closing the tab, replacing its kernel, or cancelling an active operation stops its capture. Nothing captured here is automatically attached to an AI model.

## Take a still from your camera

Run this first cell, then approve the browser's camera prompt and wait for the notebook's Media row to finish:

```python
from nbinlineai.tools import start_camera, capture_camera, stop_source
camera = start_camera(audio=False)
```

In a later cell, inspect the same receipt. Once it is complete, request a still from its actual source ID:

```python
print(camera.status, camera.error)
assert camera.status == "completed", "Wait for the camera, then rerun this cell."
camera_id = camera.result["source_id"]
still = capture_camera(camera_id, save_to=None)
```

After the still's Media row finishes, run another cell to display the actual returned image. Stop the source when done and inspect that stop receipt later too:

```python
from IPython.display import display
print(still.status, still.error)
assert still.status == "completed", "Wait for the still, then rerun this cell."
display(still.result)
stopped = stop_source(camera_id)
```

The [camera walkthrough](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-start_camera-call) keeps the call and inspection cells separate. Its [AI start question](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-camera-workflow) records operation IDs first; a [later status question](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-camera-ready) verifies completion before asking for the still. You must approve real hardware access yourself.

## Choose a source and record

Start with `list_media_sources(kind="all", cursor="", limit=10)` to list camera and microphone device IDs without asking for permission. Its [passive AI question](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-list-sources) and [later status check](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html#capture-ai-list-sources-ready) run independently of the camera request. Labels can be hidden until permission is granted; long labels may be shortened to fit a result page, indicated by `labels_truncated`. Device IDs are returned exactly or omitted, never shortened into unusable IDs. `start_camera(audio=False, device_id="", facing="user")` opens a preview; its `audio=True` option explicitly requests a microphone track. `start_microphone(device_id="")` opens an audio source and local level meter. Their completed receipts report the actual source ID and available track settings; `device_id_omitted` marks a browser ID too large for the result. `capture_camera(source_id="", save_to=None, max_size=1280)` takes a PNG still from an active camera. An empty source ID works only when exactly one camera source is active. `read_audio_levels(source_id, window_ms=250)` returns a short RMS and peak measurement without raw audio or transcription. `stop_source(source_id)` stops that source and all its tracks.

### Record, pause, and stop

`start_recording(source_id, save_to="auto", duration=30)` uses the source's declared video and audio tracks. Its receipt stays active until `stop_recording(operation_id)`, its duration limit, or the source ending; `pause_recording(operation_id)` and `resume_recording(operation_id)` affect encoding while the preview and capture tracks may remain live. **After stopping, inspect the original `start_recording` receipt in a later cell** to get the finished clip, MIME type, and duration. The stop receipt reports the control action, not the encoded clip. Stopping the source finalizes the recording with `stop_reason="source_ended"`; cancelling discards unfinished data. `record_camera(save_to="auto", duration=30, audio=False, facing="user")` and `record_microphone(save_to="auto", duration=30, device_id="")` are convenience calls that ask permission, record, and stop only their own tracks afterward. The server admits one active recorder for a notebook, even across two browser clients or Jupyter sessions showing that same document.

Recordings default to 30 seconds. Saved recordings are limited to 300 seconds and 50 MiB. An in-memory recording (`save_to=None`) is limited to 60 seconds and 16 MiB; its finished clip stays in managed memory until released or expired. Pause does not extend the wall-clock recording limit. The browser selects an encoding it supports and reports the actual MIME type. An explicit filename must use an extension matching that encoding; `auto` chooses a unique matching name. A failed encoder or an oversized result is an error, never a silently truncated success. See [browser media operations](browser-media-foundation.md) for the shared receipt, safe saving, and release rules.

### Share a display deliberately

`setup_share()` shows the notebook's Share control without opening a chooser. `start_share(audio=False)` leaves a pending receipt until you click that control and choose a display. If requested display audio is unavailable, the UI offers a separate choice to share without audio; it never substitutes your microphone. `capture_screen(timeout=15, source_id="", save_to=None, max_size=1280)` captures a PNG frame from an already shared display. Its timeout covers frame readiness, not chooser time. `capture_tool(...)` is an opt-in alias with the same result; its model reply is a local descriptor and does not contain image pixels. `stop_share(source_id="")` stops an active share and is idempotent for a known already stopped source. A screen source can also be passed to `start_recording`; there is no second screen recorder.

### Image sizes and saving

Stills are limited to 4096 pixels on either side and 16 megapixels, with a default longest side of 1280. `save_to=None` keeps stills or clips in managed memory; `save_to="auto"` saves beside the notebook through the server's safe file path. An explicit path is relative to the configured Jupyter server root and cannot overwrite an existing file. A completed still arrives as a Pillow image in Python; an audio or video result arrives as a `MediaClip`. Releasing managed bytes does not delete an already saved file or a Python object already delivered to the kernel.

The [camera, microphone, and screen walkthrough](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html) links each request to a later receipt inspection and shows the visible permission and sharing steps. Run it in an open notebook on a secure origin. Allow access only to the camera, microphone, or display you intend to use; stop each source when finished.

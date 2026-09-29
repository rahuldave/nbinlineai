---
title: Media transformations
---

# Media transformations

`extract_frames`, `crop_image`, and `annotate_image` work on exact owned media references. Run them in an open nbinlineai JupyterLab notebook with its live Python kernel. Each call returns a mutable `BrowserReceipt` promptly; inspect its `status`, `result`, `media`, and `error` in a **later** cell. The [transform walkthrough](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html) pairs direct calls with later inspections and includes AI questions. Direct calls need no AI connection; AI questions use the selected connection.

## Crop an image and inspect the new pixels

Use a completed capture or import's exact media descriptor as `image_ref`. The crop leaves its source alone:

```python
from nbinlineai.tools import crop_image
crop = crop_image(image_ref, 4, 4, 16, 16, save_to=None)
```

After the Media row finishes, run a later cell to inspect and display the Pillow result. The [notebook crop](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-crop-call) also demonstrates an explicit save and its sidecar; its [AI crop question](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-crop-ai-question) reports the operation first and checks the result in a later turn.

```python
from IPython.display import display
print(crop.status, crop.error)
assert crop.status == "completed", "Wait for the crop, then rerun this cell."
print(crop.result.size)
display(crop.result)
```

## Extract frames from a playable clip

Ask for explicit times inside a verified clip duration; the receipt returns the **presented** times, which may differ slightly from your requests. The [frame call](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-frames-call) and [AI frame question](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-frames-ai-question) illustrate the separate request and later inspection. Do not use a file extension alone as proof that the current browser can decode the video.

```python
from nbinlineai.tools import extract_frames
frames = extract_frames(video_ref, [1.5, 5.0])
```

After the operation completes in a later cell, inspect `frames.media` for each `actual_seconds` and display the corresponding images in `frames.result`. Frame extraction can fail explicitly if the browser cannot decode or timestamp the clip.

```python
from IPython.display import display
print(frames.status, frames.error)
assert frames.status == "completed", "Wait for the frames, then rerun this cell."
for image, descriptor in zip(frames.result, frames.media, strict=True):
    print("Presented at", descriptor["actual_seconds"], "seconds")
    display(image)
```

## References, saves, and limits

Pass an owned `{"media_id": "..."}` descriptor or an exact saved `{"path": "...", "sha256": "..."}` reference. The browser verifies source bytes and hash, decodes the actual format, and produces a **new PNG**. It leaves the original memory result or saved file unchanged. SVG markup is unsupported as transformation input; these calls do not silently rasterize vector art.

`extract_frames(media, timestamps, save_to=None)` accepts one to twelve explicit finite seconds values. It checks the decoded duration, seeks each frame through the shared video decoder, and records each **actual presented frame timestamp** next to the requested timestamp in its media descriptor. On completion, `frames.result` is a list of Pillow images; `frames.media` is a list of descriptors in the same order. Descriptor pages are assembled before the Python receipt is delivered. A browser-recorded WebM may omit its duration; the decoder makes a bounded seek to establish a finite end from the browser and refuses the clip if it cannot verify a duration within 300 seconds. Video recording or a matching `.webm`/`.mp4` filename does not prove that the current browser can decode that codec. Frame extraction also needs browser support for reporting the presented frame time; an unsupported decoder or timing API, or a failed seek, reports an error rather than substituting a frame. Codec and frame-timing support vary by browser; a failed decode reports an error instead of a substituted frame.

`crop_image(media, x, y, width, height, save_to=None)` takes integer pixel coordinates inside the source bounds. Its Pillow result has the requested dimensions. `annotate_image(media, annotations, save_to=None)` accepts one to fifty shapes of type `text`, `arrow`, `rectangle`, or `redaction`. Coordinates must fit the decoded image. Text is at most 200 characters per shape; optional drawing colors use opaque six-digit hex values. A redaction fills its derivative pixels opaque black regardless of any drawing color, so it is an actual pixel edit rather than a visual overlay. Inspect the source separately when you need to confirm it remains intact.

### Save derivatives with provenance

With `save_to=None`, derivatives remain in owned media memory and no file or sidecar is written. A specific unused server-root-relative filename saves one crop or annotation. For frame extraction, give an unused server-root-relative **directory**; it receives generated `part-01.png` through at most `part-12.png`. `save_to="auto"` chooses a new directory for a frame batch. Existing files are never overwritten. Each saved derivative receives an adjacent `.json` sidecar containing bounded source hash, operation parameters, output hash and, for a frame, requested and actual seconds. The media descriptor reports both paths. Saving a memory derivative later through `save_media` also creates its sidecar. A failed or cancelled save rolls back its newly created media and sidecar together.

### Bounds and unsupported inputs

The shared decoder limits an encoded source to 50 MiB, an image or video frame to 4096 pixels per side and 16 million pixels, video duration to 300 seconds, and a frame batch to 32 million decoded pixels and 50 MiB encoded output. Active previews and working surfaces share a 32-million-pixel per-notebook and 64-million-pixel per-tab budget, so a large transform may be rejected even below an individual image limit when several surfaces are live. Cancellation, owner loss, mismatched bytes, stale references, and out-of-bounds geometry fail explicitly; the operation releases its decoder and working surfaces. Source bytes are not sent to a model by these direct calls.

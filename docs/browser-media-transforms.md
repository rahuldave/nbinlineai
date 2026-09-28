---
title: Media transformations
---

# Media transformations

`extract_frames`, `crop_image`, and `annotate_image` are source-only browser tools. They are absent from the unchanged PyPI 0.1.15 package. Run them in an open nbinlineai JupyterLab notebook with its live Python kernel. Each call returns a mutable `BrowserReceipt` promptly; inspect its `status`, `result`, `media`, and `error` in a **later** cell. The [disposable transformations notebook](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html) demonstrates all three with an exact generated image and two-color video, without a provider or personal media.

Pass an owned `{"media_id": "..."}` descriptor or an exact saved `{"path": "...", "sha256": "..."}` reference. The browser verifies source bytes and hash, decodes the actual format, and produces a **new PNG**. It leaves the original memory result or saved file unchanged. SVG markup is unsupported as transformation input; these calls do not silently rasterize vector art.

```python
from nbinlineai.tools import extract_frames, crop_image, annotate_image

frames = extract_frames(video_ref, [0.25, 1.25])
crop = crop_image(image_ref, 4, 4, 16, 16, save_to="derived/crop.png")
annotated = annotate_image(image_ref, [
    {"type": "redaction", "x": 5, "y": 5, "width": 8, "height": 8},
    {"type": "rectangle", "x": 22, "y": 5, "width": 16, "height": 12, "color": "#1976d2"},
])
# Run inspection cells later, after each receipt completes.
```

`extract_frames(media, timestamps, save_to=None)` accepts one to twelve explicit finite seconds values. It checks the decoded duration, seeks each frame through the shared video decoder, and records each **actual decoded timestamp** next to the requested timestamp in its media descriptor. On completion, `frames.result` is a list of Pillow images; `frames.media` is a list of descriptors in the same order. Descriptor pages are assembled before the Python receipt is delivered. Video recording or a matching `.webm`/`.mp4` filename does not prove that the current browser can decode that codec. An unsupported decoder or failed seek reports an error rather than substituting a frame.

`crop_image(media, x, y, width, height, save_to=None)` takes integer pixel coordinates inside the source bounds. Its Pillow result has the requested dimensions. `annotate_image(media, annotations, save_to=None)` accepts one to fifty shapes of type `text`, `arrow`, `rectangle`, or `redaction`. Coordinates must fit the decoded image. Text is at most 200 characters per shape; optional drawing colors use opaque six-digit hex values. A redaction fills its derivative pixels opaque black regardless of any drawing color, so it is an actual pixel edit rather than a visual overlay. Inspect the source separately when you need to confirm it remains intact.

With `save_to=None`, derivatives remain in owned media memory and no file or sidecar is written. A specific unused server-root-relative filename saves one crop or annotation. For frame extraction, give an unused server-root-relative **directory**; it receives generated `part-01.png` through at most `part-12.png`. `save_to="auto"` chooses a new directory for a frame batch. Existing files are never overwritten. Each saved derivative receives an adjacent `.json` sidecar containing bounded source hash, operation parameters, output hash and, for a frame, requested and actual seconds. The media descriptor reports both paths. Saving a memory derivative later through `save_media` also creates its sidecar. A failed or cancelled save rolls back its newly created media and sidecar together.

The shared decoder limits an encoded source to 50 MiB, an image or video frame to 4096 pixels per side and 16 million pixels, video duration to 300 seconds, and a frame batch to 32 million decoded pixels and 50 MiB encoded output. Active previews and working surfaces share a 32-million-pixel per-notebook and 64-million-pixel per-tab budget, so a large transform may be rejected even below an individual image limit when several surfaces are live. Cancellation, owner loss, mismatched bytes, stale references, and out-of-bounds geometry fail explicitly; the operation releases its decoder and working surfaces. Source bytes are not sent to a model by these direct calls.

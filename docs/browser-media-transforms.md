---
title: Media transformations
---

# Media transformations

Use these tools to take frames from a video, crop an image, or mark up an image in an open nbinlineai notebook. The [worked transform notebook](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html) creates a small PNG and uses a recording of a notebook tab as its video input. It shows each Python call, the result inspected in a later cell, and a concise AI question with its observed tool call. Run its setup first and use the references created in *your* run; the folder names and operation IDs printed in the saved example are temporary.

Each call returns a `BrowserReceipt` immediately. A receipt in `running` is an accepted request, not a finished image. Let the Media row finish, then inspect that **same** Python receipt in a later cell. For an AI call, the initial tool result is one snapshot; ask `operation_status` in a later question using its exact operation ID. The image or video stays in the notebook's owned media or local server files unless you explicitly attach an image to a question.

## Make a crop

`crop_image` takes pixel coordinates in the decoded image: `x`, `y`, `width`, and `height`. The [crop call](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-crop-call) uses the setup cell's exact `image_ref`, selects a 16 × 16 region from its 64 × 64 PNG, and saves the derivative to a new path.

```python
from nbinlineai.tools import crop_image
crop = crop_image(image_ref, 4, 4, 16, 16, save_to=f"{work.name}/crop.png")
```

Run the [later crop inspection](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-crop-inspect) after completion. It checks the returned Pillow image's size and red pixels, confirms that the 64 × 64 source is unchanged, and reads the saved derivative's provenance sidecar. A failed receipt has an `error`; check that before using `result` or `media`.

```python
print(crop.status, crop.error)
if crop.status == "completed":
    print(crop.result.size, crop.media["path"], crop.media["sidecar_path"])
```

The [AI crop question](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-crop-ai-question) requests an in-memory crop using the offered `crop_image` tool; its [later AI status question](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-crop-ai-ready) obtains the finished dimensions and new media reference. This separates the request from the result without making the model guess when the browser finished.

## Mark up or redact an image

`annotate_image` creates another PNG; it does not draw over the source. The [annotation call](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-annotate-call) puts an opaque black redaction, a rectangle, an arrow, and short text on the setup PNG. Its [later inspection](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-annotate-inspect) checks a black pixel in the derivative against a red pixel at the same position in the unchanged source.

```python
from nbinlineai.tools import annotate_image
marked = annotate_image(image_ref, [
    {"type": "redaction", "x": 5, "y": 5, "width": 8, "height": 8},
    {"type": "rectangle", "x": 22, "y": 5, "width": 16, "height": 12,
     "color": "#1976d2"},
])
```

Use `text` and `arrow` shapes as the notebook demonstrates, with coordinates inside the source image. A redaction edits derivative pixels; merely drawing a border would not hide underlying pixels. The [AI annotation question](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-annotate-ai-question) requests one redaction and its [later status question](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-annotate-ai-ready) reports the resulting image reference. The AI status result describes the derivative; the direct Python inspection verifies its pixels.

## Extract frames and make a thumbnail

`extract_frames` needs an exact reference to a video the current browser can decode. In the [frame call](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-frames-call), `video_ref` comes from the checked notebook-tab recording in setup:

```python
from nbinlineai.tools import extract_frames
frames = extract_frames(video_ref, [1.5, 5.0])
```

The [later frame inspection](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-frames-inspect) displays two different notebook scenes and reads `actual_seconds` from each descriptor. These are the frames the browser presented; they may differ from the requested times. The [AI frame question](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-frames-ai-question) makes the tool call, and the [later AI status question](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-frames-ai-ready) reports those observed times and managed media IDs.

Completed `frames.result` is a list of Pillow images, paired in order with `frames.media`. You can make a smaller **local Pillow preview** from one returned frame:

```python
from IPython.display import display
if frames.status == "completed":
    for image, descriptor in zip(frames.result, frames.media, strict=True):
        thumbnail = image.copy()
        thumbnail.thumbnail((320, 180))
        print("Presented at", descriptor["actual_seconds"], "seconds")
        display(thumbnail)
```

The notebook uses Pillow `resize` for its displayed frame and crop previews. `thumbnail` above preserves aspect ratio within a box; `resize((width, height))` chooses exact dimensions and may stretch an image. These Pillow operations work on already returned Python images. They do not create a new browser media ID or provenance sidecar. Use the original `frames.media` reference for a later browser operation, or deliberately save a Python preview yourself if you want a separate file.

## Exact inputs, saving, and errors

Pass an owned `{"media_id": "..."}` from a completed receipt or an exact saved `{"path": "...", "sha256": "..."}` reference. The worked notebook computes the hash of the PNG it created and verifies the recording's size and hash before use. Do not substitute a filename without its actual hash. Browser decoding and byte checks can report an expired or stale reference, unsupported codec, or changed file. SVG is not silently rasterized for these pixel tools.

With `save_to=None`, a derivative stays in bounded owned media memory; no file or sidecar is written. For a crop or annotation, set `save_to` to an unused server-root-relative **filename**. For a frame batch, set it to an unused server-root-relative **directory**, or use `"auto"` for a generated directory. The frame files are named `part-01.png` and onward. Existing destinations are not overwritten. Every saved derivative has an adjacent `.json` sidecar with its source hash, transformation, parameters, and output hash; saved frames also record requested and actual seconds. `save_media` can later save an in-memory derivative and create its sidecar. Inspect a completed receipt's `media` for the resulting paths. A failed save does not count as a completed transform.

Crops and annotations have pixel bounds. Annotations accept 1–50 `text`, `arrow`, `rectangle`, or `redaction` shapes; text is at most 200 characters per shape and drawing colors are opaque six-digit hex values. Frame extraction accepts 1–12 finite timestamps from 0 to 300 seconds and rejects positions beyond the decoded clip. It checks a 32-million-pixel decoded batch and 50 MiB encoded batch limit. The shared decoder limits sources to 50 MiB, each image or frame to 4096 pixels per side and 16 million pixels, and video to 300 seconds. Several active previews or surfaces can also exhaust the notebook's pixel budget. If the browser cannot establish a finite video duration or report a presented frame time, extraction reports an error. A `.webm` or `.mp4` suffix alone does not establish that its codec is playable in this browser.

When finished, use `release_media` for managed in-memory derivatives and remove only your disposable files. The [notebook cleanup cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html#transform-cleanup) shows that sequence. Releasing a media ID does not remove an already saved file or a Pillow image already returned to Python.

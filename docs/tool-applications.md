---
title: Build an application with notebook tools
---

# Build an application with notebook tools

Start with the result you want to keep: a presentation, a bug report, an analysis note, or a project handoff. The [application notebooks](examples.md#complete-applications) join the tools into those tasks. They include Python steps, staged AI questions, and a final artifact. They are new, unrun tutorials; their empty outputs are places for your own results.

## Which tools return receipts?

**All tools do not return browser receipts.** A receipt is how a direct Python browser/media call lets a notebook cell finish while the browser is still working. You can still use real values in ordinary Python.

| Kind of call | What you receive | How to use it |
| --- | --- | --- |
| Python, file, saved-notebook, and web tools called in Python | Ordinary values, often bounded text or a dictionary | Assign the return value and use it immediately. For example, `text = view_file(path)` returns file text. |
| A custom Python tool | Whatever your function returns | Call it normally; when the model calls it, the tool result is serialized for the model. |
| Browser/media tool called in Python | A mutable `BrowserReceipt` | Keep it in a variable. Finish the visible browser step, then inspect that same object in a later cell. Use `.result` only after `.status == "completed"`. |
| Browser/media tool called by the model | A status snapshot and operation ID | Complete the visible step, then ask a later question to call `operation_status` for that exact ID. The earlier answer does not update. |
| Live editor tool called by the model, such as `read_cell` or `insert_code` | Acknowledged text or action result | Reads return source; edits acknowledge the live document. Save the notebook normally. Direct Python stubs for these tools cannot perform the edit. |
| `insert_tools()` setup helper | A separate mutable insertion receipt | Inspect `.status`, `.cell_id`, and `.error` in a later cell. It inserts declarations; it does not call the model or capture media. |

The [receipt-to-values notebook](https://rahuldave.com/nbinlineai/notebooks/application-receipts-to-values.html) demonstrates the distinction. A direct browser capture can deliver a Pillow image into `.result`; you can crop it, measure it, display it, or save it with normal Python. An in-memory recording can deliver a `MediaClip`, whose `.data` holds encoded bytes and whose `.mime_type` identifies the format. A recording saved by the browser may instead supply its saved-file descriptor without duplicating the full clip in Python.

The `.media` field is a descriptor, or a list of descriptors: IDs, format, hash, dimensions, duration, and a path after saving. It is useful for passing a captured item to another tool. It is not the image pixels or the audio samples. An operation ID identifies work; a source ID identifies an open camera, microphone, display, or canvas; a media ID identifies captured bytes. Use the right ID for each next call.

## From a receipt to an ordinary value

Run these as separate code cells in an open nbinlineai JupyterLab notebook. Open the camera first and grant permission if you choose:

```python
from nbinlineai.tools import start_camera, capture_camera, stop_source, release_media
camera = start_camera(audio=False)
print(camera)  # Opening may still be in progress.
```

After the camera Media row finishes, run this later cell to capture from that exact source:

```python
print(camera.status, camera.error)
if camera.status != "completed":
    raise RuntimeError("Finish opening the camera, then rerun this inspection cell.")
source_id = camera.result["source_id"]
photo = capture_camera(source_id=source_id, save_to=None)
print(photo)  # The still capture may still be running.
```

After the Media row finishes, run this later cell. A pending result is a reason to wait and rerun this inspection cell, not to repeat the capture:

```python
from PIL import Image
from IPython.display import display

print(photo.status, photo.error)
if photo.status != "completed":
    raise RuntimeError("Finish the browser step, then rerun this inspection cell.")
if not isinstance(photo.result, Image.Image):
    raise TypeError("This operation did not deliver an image; inspect its error and media fields.")
image = photo.result
display(image)
print("Image dimensions:", image.size)
thumbnail = image.copy()
thumbnail.thumbnail((320, 320))
display(thumbnail)
```

After using the image, request cleanup in another cell. These operations also return receipts; inspect them later to confirm completion:

```python
stopped = stop_source(source_id)
released = release_media(photo.media["media_id"])
# Later cell: print(stopped.status, stopped.error, released.status, released.error)
# The image and thumbnail already copied into Python remain usable.
```

There is no synchronous wait loop. Such a loop can keep the kernel busy and prevent its receipt update from arriving. The original printed receipt is a snapshot; the Python variable holds the updating object. See [receipt fields and ownership](browser-media-foundation.md#read-the-receipt) for failure and expiry handling.

## Put the tools together

| Application | Flow | Result you keep |
| --- | --- | --- |
| [Presenter kit](https://rahuldave.com/nbinlineai/notebooks/application-presenter-kit.html) | Capture a portrait, talking-head video with sound, a screen still and recording, and separate microphone narration; add authored notes; assemble the assets into slides | A local HTML presentation with media and notes |
| [Screen bug report](https://rahuldave.com/nbinlineai/notebooks/application-screen-bug-report.html) | Choose a window, record a short reproduction, capture and mark a still, confirm that still for an AI question, then assemble evidence with written reproduction steps | A report with local image/video evidence |
| [Data investigation](https://rahuldave.com/nbinlineai/notebooks/application-data-investigation.html) | Inspect a small dataset, check suspicious observations with live tools, discuss the evidence, and write a report | A reproducible analysis note and visual evidence |
| [Project handoff](https://rahuldave.com/nbinlineai/notebooks/application-project-handoff.html) | Search a small project and saved notebook, compare the implementation with its method note, make a checked repair, verify it, and document the result | A checked project and a handoff report |

A camera stream with `audio=True` gives one talking-head clip with the microphone track. A display source records the window or screen you chose. Capturing both does **not** automatically create a combined picture-in-picture video; the presenter notebook puts them into the same presentation as separate assets. A separate microphone recording can serve as narration. Browser and codec support still determine which recordings can be made and played.

## Script the conversation in stages

Import the functions, then offer only the small tool menu needed for this stage in an ordinary Markdown cell using references such as `` &`record_camera` `` and `` &`operation_status` ``. Run an AI question asking for the concrete action and its parameters. The model can request the recording, but you still grant permissions and choose a display yourself.

Next, complete the browser action and run a **new question** asking for the status of the exact operation ID from the first answer. A successful status lookup can report that its target is still running; it does not wait for that target. Use a completed target's descriptor for the next tool. The notebooks supply the actual prompt sequence and places to copy returned IDs.

AI calls do not assign Python variables for you. To continue from an AI recording in ordinary Python, save it through the browser tools and use its returned server-root-relative path and hash with an explicitly supplied server-root mapping, or capture directly into a Python receipt. Merely printing a descriptor in an answer does not transfer its bytes into the kernel. Keep the combined offered tool and live-variable names within 20; the presenter notebook changes its menu between stages using the declaration cells' **Tools** checkbox.

The model sees browser tool status and descriptors, not the captured pixels, speech, or full video. To ask about a still, use `attach_media` for one identified question, confirm **Attach image**, then run that question with an image-capable connection. Attachment alone does not run it. Audio transcription, video summarization, slide-file export, and video mixing need additional tools or Python libraries; these bundled tools do not provide them. The presenter notebook uses written notes as the slide text and embeds recordings for human playback.

The presenter notebook also offers a small custom Python tool, `create_presenter_deck_from_text`, after capture. The model drafts seven captions and speaker notes from your written topic and notes, then calls that tool to write a second presentation using the real media already in the kernel. A later Python cell verifies the file. This is how the conversation produces an artifact: the model writes text from supplied evidence, and a concrete callable assembles and saves it.

Save your presentation or report before releasing temporary media. Stop sources you opened, and use `release_media` when their managed bytes are no longer needed. Python copies and exported local files survive that release. The [example audit](example-audit.md) records what each existing notebook actually demonstrates and where a reader should be careful.

[Notebook examples](examples.md) · [Browser media receipts](browser-media-foundation.md) · [Variables and tools](manual/variables-and-tools.md)

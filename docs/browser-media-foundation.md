---
title: Browser media receipts
---

# Browser media receipts

Browser work can take longer than a notebook cell: you may need to allow a device, choose a window, finish a recording, or wait for a file save. A direct Python call therefore returns a **`BrowserReceipt` promptly**. It is a live Python object whose fields can change after the cell ends. Printing it in the calling cell captures only that moment; it does not wait for a photo, clip, or saved file.

The sequence is:

1. Run the call in an open JupyterLab notebook. Keep the returned receipt in a variable. It may initially say `running` with no `operation_id` yet.
2. Complete any visible permission or chooser step. The notebook's **Media** row shows progress and offers **Stop** while work is active.
3. When the row finishes, run a **later cell** that reads the *same* receipt's `status`, `result`, `media`, and `error`. If it is still active, inspect it again later. Use a result only after `completed`.

Run All cannot supply this pause between dependent media cells: it moves to the next cell after the Python call or AI answer, even if the browser operation continues. Run those cells individually. The [foundation notebook](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html) demonstrates direct Python calls and AI tool calls, with a later inspection or status question for each.

## A save you can try

This example creates a disposable 2×2 PNG and saves a separate copy. Run each code block as its own cell in a disposable notebook whose kernel is working at the Jupyter server root:

```python
from pathlib import Path
from uuid import uuid4
import hashlib
from PIL import Image
from nbinlineai.tools import save_media

source = Path.cwd() / f"receipt-source-{uuid4().hex[:8]}.png"
Image.new("RGB", (2, 2), "red").save(source)
source_ref = {"path": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}
saved = save_media(source_ref, save_to="auto")
print(saved)  # The save may still be running.
```

After the Media row says **completed**, run this later cell. If the status is still `running` or `saving`, wait and run it again:

```python
from IPython.display import display

print("Status:", saved.status, "Operation:", saved.operation_id)
print("Error:", saved.error)
if saved.status == "completed":
    saved_path = Path.cwd() / saved.media["path"]
    print("Saved file:", saved.media["path"])
    print("SHA-256 matches:", hashlib.sha256(saved_path.read_bytes()).hexdigest() == saved.media["sha256"])
    display(Image.open(saved_path).resize((80, 80)))
```

The displayed red image and matching hash come from the file that was saved. The notebook has the [save call](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-save-call), [later inspection](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-save-inspect), and [cleanup](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-cleanup) as separate cells. A direct call needs a live JupyterLab notebook and Python kernel, but it does not need an AI connection.

## Read the receipt

| Field | Meaning |
| --- | --- |
| `operation_id` | Identifies this operation for a later status check or cancellation. It can be `None` just after a Python call, before the browser registers the operation. |
| `status` | `waiting_for_user` needs a visible action; `running`, `paused`, and `saving` are active. `completed` means finished. `failed`, `cancelled`, and `expired` are terminal outcomes. |
| `result` | The completed Python value, such as a Pillow image, encoded audio/video `MediaClip`, decoded frames, a source ID, or small control data. It is not ready while the operation is pending. |
| `media` | One managed media descriptor, or a list for a batch. A descriptor can include an opaque `media_id`, MIME type, byte count, SHA-256, dimensions, duration, expiry, and a `path` **only after a successful save**. |
| `error` | A structured code and message when the operation fails, is cancelled, or expires. Read it before retrying. |

A completed `start_camera`, `start_microphone`, `start_share`, or `start_canvas` operation gives a `source_id`. **Completed means the source opened**, not that its camera, microphone, screen share, or canvas stream has stopped. Stop the source explicitly when finished. A recording has its own operation and can remain `running` or `paused` while that source stays live.

The receipt can update while Python is idle. If the kernel is busy, its browser messages may arrive only when the kernel can handle them again. Do not spin or block in the calling cell waiting for its receipt: that can prevent the update from being processed.

## AI answers and status checks

An AI browser-tool result is an **initial snapshot**, not a mutable Python receipt. The saved answer will not change when a permission is granted or a recording finishes. It may contain an operation ID and `waiting_for_user` or `running` even though the Media row later says **completed**. Complete the visible action, then ask a later AI question to call `operation_status` on that exact ID. If the status check still shows active work, check again later. The [save AI call](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-save-ai-question) and [follow-up status question](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-save-ai-ready) show both steps. AI questions use the notebook's selected AI connection.

Python can also request a status snapshot:

```python
from nbinlineai.tools import operation_status

lookup = operation_status(saved.operation_id)
# Inspect lookup.status and lookup.result in a later cell.
```

This lookup has **two states**. After `lookup.status == "completed"`, its `lookup.result["status"]` is the target operation's state *at the time of lookup*. The target may still be `running`, `saving`, or `waiting_for_user`. The lookup does not wait for it or fetch image/audio/video bytes. It also does not extend temporary media's expiry. See the notebook's [status call](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-status-call) and [later inspection](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-status-inspect).

## Memory, files, and ownership {#save-cancel-release-and-reopen}

For media-producing tools, `save_to=None` keeps bounded temporary media in memory. `save_to="auto"` requests a unique file in `media/` beside the initiating notebook; an explicit nonempty path is relative to the Jupyter server root. A path is reported only after the server confirms the save. A still image can also be returned as a Pillow object when a file was requested. Recordings saved to a file need not produce a second full `MediaClip` in Python.

`save_media(media, save_to="auto")` writes an existing result to a **new** file. Pass either an owned memory descriptor containing `media_id` or an exact saved-file reference with both `path` and `sha256`, as in the example. It never overwrites a file. `save_media` does not accept `save_to=None`; it is specifically a save operation. Check `browser_capabilities().result["file_media_supported"]` in a later cell before relying on local file saving. The capability check does not ask for device permission.

Managed bytes belong to the originating notebook tab, session, and kernel. Their descriptors have an `expires_at` time; the idle lifetime is 10 minutes, and merely checking status does not renew it. Closing the owner or changing kernels can expire pending work and memory IDs. A saved file survives that cleanup and can be reopened later using its current path and recomputed SHA-256. A Pillow image or `MediaClip` already delivered into Python remains an ordinary Python object while that kernel holds it.

`release_media(media_id)` frees the managed temporary bytes and invalidates uses of that ID, including dependent previews. It does **not** delete an already saved file or an image/clip already copied into Python. `cancel_operation(operation_id)` stops unfinished work; cancelling a completed operation does not erase its file or Python result. The Media row's **Stop** control stops live work in that notebook. See the notebook's [release](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-release-call) and [cancel](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-cancel-call) demonstrations. Remove only the disposable files you created when finished with the save example.

Device capture and screen sharing require visible browser permission or a share chooser. The result stays with the notebook and local Jupyter server; ordinary browser-tool text gives the AI bounded status and descriptors, not media bytes. Sending an image to the selected AI requires a separate, explicit [image attachment](browser-media-attachment.md). For complete workflows, continue with [camera and recording](browser-media-capture.md), [notebook outputs](browser-media-outputs.md), [import and playback](browser-media-playback.md), or [transformations](browser-media-transforms.md). Camera and microphone access from another device may require an HTTPS JupyterLab address.

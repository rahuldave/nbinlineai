---
title: Browser media receipts
---

# Browser media receipts

A browser tool starts work in the open notebook tab and returns to Python promptly. Its `BrowserReceipt` changes as the browser finishes. **Run the call, let the media row finish, then inspect the same receipt in a later cell before using its result.** The first printed receipt shows only its state at that moment.

This worked example makes a disposable two-pixel PNG and saves a separate copy. Run each code block as its own notebook cell with the kernel working directory at the Jupyter server root:

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
print(saved)  # An immediate snapshot; the save may still be running.
```

Look for the notebook's Media row. When it says **completed**, run this *later* cell. If it still says `running` or `saving`, leave file-dependent work for later and rerun this inspection cell after the row changes:

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

The displayed red image and matching hash come from the file the browser actually saved. The [foundation notebook's save call](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-save-call) and [later inspection](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html#media-save-inspect) walk through this sequence with cleanup. Do not block in the call cell waiting for its own result, and do not use Run All for dependent media cells: the next cell can execute while the browser is still asking for a click, recording, or saving.

## What the receipt fields mean

| Field | What to check |
| --- | --- |
| `operation_id` | The ID for this browser operation. It can be `None` immediately after the Python call, until the browser registers it. Use it for a later status lookup or cancellation. |
| `status` | `waiting_for_user` needs a visible action; `running`, `paused`, and `saving` are still active. `completed` means finished. `failed`, `cancelled`, and `expired` are terminal outcomes. |
| `result` | A successful typed Python result: for example, a Pillow image, an audio/video `MediaClip`, a list of decoded frames, or small control metadata. A pending receipt has no final result yet. |
| `media` | One owned descriptor, or a list of descriptors for a frame batch, when bytes were delivered or saved. Each can include a `media_id`, MIME type, SHA-256, size, and saved path. Keep an exact saved path and hash together. |
| `error` | A structured code and message when work fails, is cancelled, or expires. Read it before retrying. |

A model-initiated browser tool call behaves differently from a Python variable: its tool result is a **snapshot** at that instant. It does not update inside a saved AI answer. If it reports `running` or `waiting_for_user`, complete the visible action first, then ask a later AI question to call `operation_status` with the exact operation ID. Only the later result can establish whether work completed and returned a source ID, file, or other result. Never infer success from the initial snapshot.

`operation_status(operation_id)` also returns a new Python `BrowserReceipt`. Once that lookup receipt completes, **its** `result` is a one-time snapshot of the **target** operation. The two statuses are distinct: `lookup.status == "completed"` means the lookup finished, while `lookup.result["status"]` says whether the target is still running, paused, or completed. The lookup does not wait for the target or retrieve media bytes.

```python
from nbinlineai.tools import operation_status

if saved.operation_id:
    lookup = operation_status(saved.operation_id)
    # Inspect lookup.status and lookup.result in another cell after it finishes.
```

## Save, cancel, release, and reopen

`save_media(media, save_to="auto")` creates a new unused file beside the notebook in `media/`. It accepts an owned in-memory descriptor or an exact saved-file reference containing both `path` and `sha256`. An explicit destination is relative to the Jupyter server root; a conflicting path is rejected. A capture with `save_to=None` stays in memory, while `save_media` always writes a file. File saving is available only when a completed `browser_capabilities()` receipt reports `file_media_supported` in its result. Call it in one code cell and inspect that same receipt in a later cell; the check itself does not request device access.

`cancel_operation(operation_id)` stops unfinished work. Cancelling an already completed operation does not remove its saved file or delivered Python result. `release_media(media_id)` frees managed bytes; it does not delete a saved file or a Pillow image or `MediaClip` already delivered into Python. The Media row's **Stop** control acts on live work in that notebook.

Close the tab or change kernels and live operations or managed IDs can expire. The saved PNG above remains a normal file after reopening; a new notebook session can use its current path and recomputed SHA-256. A Python image or clip persists only while that Python kernel still holds it. When finished with the disposable example, remove the exact generated saved path and `source`; keep any real file you intentionally saved.

Camera and microphone access may require HTTPS when JupyterLab is reached from another device. The [capture](browser-media-capture.md), [outputs](browser-media-outputs.md), [playback](browser-media-playback.md), [transforms](browser-media-transforms.md), and [attachment](browser-media-attachment.md) guides use the same receipt pattern with their own permissions and result types.

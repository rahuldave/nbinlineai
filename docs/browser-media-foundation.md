---
title: Browser media operations
---

# Browser media operations

Browser operations belong to the open notebook tab and its current Python kernel. A direct Python call returns a mutable `BrowserReceipt` promptly. Its `operation_id` is filled after the browser registers the operation; check `status`, `result`, `media`, and `error` in a later cell. The receipt does not offer a blocking wait. The notebook media row shows active operations and a Stop button.

```python
from nbinlineai.tools import browser_capabilities
capabilities = browser_capabilities()
```

Run another cell to inspect `capabilities.result`. Capability checks observe browser support and any permission state the browser exposes; they do not ask for camera or microphone access. Insecure remote origins can still use notebook and file operations. Camera and microphone capture may require HTTPS on a phone connected to a Jupyter server on another computer.
Every registered operation appears in the compact `operations` availability map. When many families are installed, `omitted_details` counts optional reason or format descriptions left out of the bounded reply; the JSON remains complete and parseable.

An in-memory media result has a `media_id`, MIME type, byte count, SHA-256 and expiry. Its bytes stay on the local Jupyter server until release, idle expiry, or tab ownership loss. A capture's `save_to=None` keeps the result in memory. `save_media` always saves, so its `save_to=None` is invalid. `save_to="auto"` creates a unique file in `media/` beside the notebook as that request starts; an explicit path is relative to the server root and must be unused. A completed still image appears as a Pillow image in the Python receipt, audio and video as a `MediaClip`, and SVG as markup. Media is not sent to an AI model by capturing or previewing it.

Safe saving currently requires a filesystem backend with anchored directory operations and no-overwrite hard links. In-memory media remains available if that backend is unavailable; saving reports a failure without weakening path checks.

```python
from nbinlineai.tools import operation_status, cancel_operation, save_media, release_media
latest = operation_status(receipt.operation_id)   # one-shot snapshot in latest.result
saved = save_media(receipt.media, save_to="auto")  # choose this only when a file is wanted
cancelled = cancel_operation(receipt.operation_id)
release = release_media(receipt.media["media_id"])
```

These operations require the originating notebook tab. Closing the tab or changing its kernel ends live operations. Saved files remain in the Jupyter folder. A later Python cell can keep using a Pillow image or clip already delivered into Python.

`operation_status` itself completes after one lookup, even if the target is still running or paused. Its own receipt status becomes `completed`; `result` is the target's snapshot, including the target's `operation_id` and current `status`. It does not fetch media bytes or wait for the target to finish. The original media-producing receipt is the channel that delivers a typed Python result. `cancel_operation` leaves an already completed result and saved file in place. `release_media` frees managed bytes without deleting a saved file or an image already held in Python.

`save_media` accepts either an owned memory descriptor or an exact saved-file reference, such as `{"path": "source.png", "sha256": actual_hash}`. The [example notebook](../examples/browser-media-foundation.ipynb) creates a tiny PNG in a disposable project at the Jupyter server root, computes its real hash, and exercises all five controls cell by cell. It assumes the kernel working directory equals that server root; use a disposable local JupyterLab project for the example.

The current foundation establishes the operation, receipt, binary, and save contract. Capture, notebook output, playback, and editing tool families are added in their own implementation topics. The status row and capability result will reflect each family as it arrives. This implementation has not been released to PyPI.

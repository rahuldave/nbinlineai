---
title: Import, playback, and clipboard
---

# Import, playback, and clipboard

These tools work in the open nbinlineai notebook with its live Python kernel. A direct call returns a mutable `BrowserReceipt` immediately. Watch the notebook media row, then inspect the receipt's `status`, `result`, `media`, and `error` in a later cell. [The playback notebook](https://github.com/rahuldave/nbinlineai/blob/main/examples/browser-media-playback.ipynb) demonstrates all nine tools using a generated image, a two-second tone, and explicit copy and paste controls. This is source-only implementation work; the unchanged PyPI 0.1.15 package does not contain these tools.

`choose_file(accept="", multiple=False, save_to=None)` shows a standard file chooser. The selected bytes enter the notebook's owned media memory and the receipt receives an image or clip when supported. Selection alone does not create a file. `save_to="auto"` or an unused server-root-relative path requests a deliberate save. The chooser accepts up to 12 nonempty files, each at most 50 MiB; the current shared server limit is **16 MiB for an unsaved audio or video import**, so a larger clip needs an explicit save destination. Closing the chooser or pressing Cancel cancels the operation. Only choose disposable content you mean to share with this notebook. Media bytes are not included in model action text.

`open_media(media)` takes an owned `{"media_id": "..."}` descriptor or an exact saved reference `{"path": "...", "sha256": "..."}` and returns `result['preview_id']`. It verifies the bytes and hash, then checks actual browser decoding before showing a preview. PNG, JPEG, GIF, and WebP raster images, plus browser-supported MP4, WebM, Ogg, WAV, and MP3 clips are candidates. A matching filename or recording format alone does not establish codec support. SVG preview is unsupported because markup is not executed or silently rasterized. The media operation reports `unsupported` when the browser cannot decode the codec.

```python
from nbinlineai.tools import open_media, play_media, pause_media, seek_media, set_media_volume, close_media
opened = open_media({"path": "sample.wav", "sha256": actual_sha256})
# Run a later cell after opened completes:
preview_id = opened.result["preview_id"]
playing = play_media(preview_id)
paused = pause_media(preview_id)
seeked = seek_media(preview_id, 0.5)
volume = set_media_volume(preview_id, 0.25)
closed = close_media(preview_id)
```

Run those controls one at a time, inspecting each receipt before the next. Autoplay may require the visible Play button; until then `play_media` remains `waiting_for_user`. Seeking must stay within the decoded duration, and a browser can reject programmatic volume control. Closing a preview frees its decoder and temporary URL without deleting its source media or saved file. Release of an in-memory media ID or loss of the originating notebook/kernel also closes dependent previews.

The decoder caps a source at 50 MiB, an image or video frame at 4096 pixels on either side and 16 million pixels, clips at 300 seconds, and simultaneous previews at four per notebook. Decoded surfaces have a 32-million-pixel per-notebook budget and a 64-million-pixel tab budget. The actual available number of previews can be lower when the decoded budget is already used. A cancelled or stale operation releases its reservation.

`copy_text(text)` shows the bounded text and a Copy button; when browser clipboard writing is unavailable, select the text and use the usual copy shortcut. `paste_content(accept="text,image", save_to=None)` shows a visible paste box. Paste plain text or one raster image deliberately; it never reads the clipboard in the background. Pasted text is limited to 8,000 characters and cannot use `save_to`. The receipt returns the largest safe prefix that fits the server reply, plus `truncated` and `original_chars`, so inspect those fields before using a long paste. An image may be retained in memory or saved with an explicit `save_to`. Clipboard permissions and activation rules vary by browser and operating system, so the visible controls are the portable path.

The pinned headless Firefox test browser does not reach playable data for the notebook's valid WAV sample, so its full audio demonstration is unverified there. PNG import and preview, plus chooser cancellation and size-limit behavior, have been exercised in that browser. Chromium and WebKit completed the full notebook flow with the generated WAV.

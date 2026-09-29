---
title: Import, playback, and clipboard
---

# Import, playback, and clipboard

These tools work in the open nbinlineai notebook with its live Python kernel. A direct call returns a mutable `BrowserReceipt` immediately. Watch the notebook media row, then inspect the receipt's `status`, `result`, `media`, and `error` in a later cell. [The playback walkthrough](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html) pairs each request with a later inspection and uses visible copy and paste controls.

## Preview and play a clip

Start with an exact saved-file reference, using the path and SHA-256 from the earlier save or discovery step. The [walkthrough's open call](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-open-call) uses its verified `tone_ref`. Give the browser time to decode the file before using its preview ID:

The walkthrough generates a quiet 60-second WAV so you have time to try Play, Pause, Seek, and Volume. Confirm that the preview is actually playing before pausing it; a completed control receipt alone does not prove audio was still playing.

```python
from nbinlineai.tools import open_media, play_media, close_media
opened = open_media(tone_ref)
```

In a later cell:

```python
print(opened.status, opened.error)
assert opened.status == "completed", "Wait for the preview, then rerun this cell."
preview_id = opened.result["preview_id"]
playing = play_media(preview_id)
```

If `playing.status` says `waiting_for_user`, click the visible **Play** control. Inspect `playing` again in a later cell; once finished, use `close_media(preview_id)` and later inspect its receipt. The [AI open](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-open-ai-question) and [AI play](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-play-ai-question) questions use separate status checks before a dependent action.

## Import a file or use the clipboard

`choose_file(accept="", multiple=False, save_to=None)` shows a standard file chooser. The selected bytes enter the notebook's owned media memory and the receipt receives an image or clip when supported. Selection alone does not create a file. `save_to="auto"` or an unused server-root-relative path requests a deliberate save. The chooser accepts up to 12 nonempty files, each at most 50 MiB; the current shared server limit is **16 MiB for an unsaved audio or video import**, so a larger clip needs an explicit save destination. Closing the chooser or pressing Cancel cancels the operation. Only choose disposable content you mean to share with this notebook. Media bytes are not included in model action text.

## Preview controls and formats

`open_media(media)` takes an owned `{"media_id": "..."}` descriptor or an exact saved reference `{"path": "...", "sha256": "..."}` and returns `result['preview_id']`. It verifies the bytes and hash, then checks actual browser decoding before showing a preview. PNG, JPEG, GIF, and WebP raster images, plus browser-supported MP4, WebM, Ogg, WAV, and MP3 clips are candidates. A matching filename or recording format alone does not establish codec support. SVG preview is unsupported because markup is not executed or silently rasterized. The media operation reports `unsupported` when the browser cannot decode the codec.

After `playing` completes, call `pause_media(preview_id)`, `seek_media(preview_id, 0.5)`, `set_media_volume(preview_id, 0.25)`, or `close_media(preview_id)` as needed, inspecting each receipt before a dependent action. Autoplay may require the visible Play button; until then `play_media` remains `waiting_for_user`. Seeking must stay within the decoded duration, and a browser can reject programmatic volume control. Closing a preview frees its decoder and temporary URL without deleting its source media or saved file. Release of an in-memory media ID or loss of the originating notebook/kernel also closes dependent previews.

The decoder caps a source at 50 MiB, an image or video frame at 4096 pixels on either side and 16 million pixels, clips at 300 seconds, and simultaneous previews at four per notebook. Decoded surfaces have a 32-million-pixel per-notebook budget and a 64-million-pixel tab budget. The actual available number of previews can be lower when the decoded budget is already used. A cancelled or stale operation releases its reservation.

## Clipboard controls

`copy_text(text)` shows the bounded text and a Copy button; when browser clipboard writing is unavailable, select the text and use the usual copy shortcut. `paste_content(accept="text,image", save_to=None)` shows a visible paste box. Paste plain text or one raster image deliberately; it never reads the clipboard in the background. Pasted text is limited to 8,000 characters and cannot use `save_to`. The receipt returns the largest safe prefix that fits the server reply, plus `truncated` and `original_chars`, so inspect those fields before using a long paste. An image may be retained in memory or saved with an explicit `save_to`. Clipboard permissions and activation rules vary by browser and operating system, so the visible controls are the portable path.

Audio and video playback depend on the codecs available in your browser. If a clip cannot be decoded, the receipt reports an error; try a supported format or browser.

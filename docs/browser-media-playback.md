---
title: Import, playback, and clipboard
---

# Import, playback, and clipboard

Use these tools in an open JupyterLab notebook with a live kernel. [The playback notebook](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html) makes a small blue PNG and a quiet, 60-second WAV, then gives direct Python calls and AI questions for all nine tools. Run its cells in order, one operation at a time. The file picker, Play button, Copy button, and paste box need your click or paste.

## Read a browser receipt

A direct Python call returns a mutable `BrowserReceipt` immediately. Its first displayed line is only a snapshot; the same object changes as the browser works. Watch the notebook media row, then inspect `status`, `result`, `media`, and `error` in a later cell:

```python
selected = choose_file(accept="image/png")
# Select the notebook's generated blue PNG in the visible picker.
```

```python
print(selected.status, selected.error)
if selected.status == "completed":
    print(selected.media["media_id"], selected.media["sha256"])
```

`waiting_for_user` means the visible control still needs you; `running` means the browser is working. Use an ID or media result only after `completed`. For an AI question, the model receives an operation ID and a bounded status, then can call `operation_status` later. The first AI answer does not prove that a chooser was completed or a clip is playing. The notebook shows this pattern in the [file choice](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-choose-ai-question) and [follow-up status](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-choose-ai-ready) questions.

## Choose a file

Run the [notebook's `choose_file` call](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-choose-call), click **Choose file**, and select its generated `playback-*.png`. The [later inspection cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-choose-inspect) displays the imported image and its managed media ID and SHA-256. The file bytes enter memory owned by this notebook. Choosing a file alone does not save another copy; request `save_to="auto"` or an unused server-root-relative destination to save it. Cancel the picker or the visible operation to leave it unused.

`choose_file(accept="", multiple=False, save_to=None)` accepts up to 12 nonempty files, each at most 50 MiB. An unsaved audio or video import also meets the shared 16 MiB memory limit; use an explicit save destination for a larger eligible clip. Import only a file you intend to give this notebook. Media bytes are not included in the model's text result.

## Open and control a preview

`open_media(media)` accepts an owned `{"media_id": "..."}` or an exact saved reference `{"path": "...", "sha256": "..."}`. Obtain those values from a completed receipt or from your own file and its hash. The [notebook setup](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-setup) computes `tone_ref` from its generated WAV; the [open call](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-open-call) uses that exact reference. After its receipt completes, get `opened.result["preview_id"]` in the [inspection cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-open-inspect).

```python
opened = open_media(tone_ref)
```

In a later cell, after the media row completes:

```python
assert opened.status == "completed", opened.error
preview_id = opened.result["preview_id"]
playing = play_media(preview_id)
```

If `playing.status` is `waiting_for_user`, click the visible **Play** button and inspect the receipt again. The notebook's 60-second tone gives you time to hear it and try the [play](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-play-call), [pause](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-pause-call), [seek](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-seek-call), and [volume](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-volume-call) cells. Inspect each receipt before its next dependent call. Confirm the clip is still audibly playing before testing Pause; a completed Play receipt says the request started playback, not that playback is still in progress. `seek_media(preview_id, seconds)` must stay within the decoded duration; `set_media_volume(preview_id, level)` takes a value from 0 to 1 and reports when the browser disallows programmatic volume changes.

The notebook also has scoped [AI open](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-open-ai-question) and [AI play](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-play-ai-question) questions. They use the reference and preview ID obtained from prior completed steps. Use the notebook's configured AI connection, and handle any visible Play request yourself.

`open_media` checks the actual bytes, hash, and browser decoder before offering a preview. PNG, JPEG, GIF, and WebP images and browser-supported MP4, WebM, Ogg, WAV, and MP3 clips are candidates; a file extension alone cannot guarantee decoding. Unsupported codecs return an `unsupported` error. SVG markup is not previewed as an image.

## Copy and paste deliberately

The [copy cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-copy-call) calls `copy_text("nbinlineai disposable playback sample")`. Click **Copy** in the visible panel, or use the normal copy shortcut on its selected text if the browser blocks clipboard writing. The [paste cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-paste-call) calls `paste_content(accept="text")`; click its visible paste box and paste the sample. The next cells inspect the receipts. The notebook includes separate [AI copy](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-copy-ai-question) and [AI paste](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-paste-ai-question) questions with the same user controls. The tools never read the clipboard in the background.

`copy_text` accepts up to 8,000 characters. `paste_content(accept="text,image", save_to=None)` accepts plain text or one PNG, JPEG, GIF, or WebP image. Text paste accepts at most 8,000 characters and cannot use `save_to`; its result may contain a bounded prefix, `truncated`, and `original_chars`, so check those fields before using a long paste. An image paste returns owned media and saves it only when you specify `save_to`.

## Close and clean up

Run [the close cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-close-call) after the controls finish. `close_media(preview_id)` closes that preview and releases its decoder and temporary URL, while the original WAV remains. The notebook also releases the imported PNG from owned memory and [removes its two generated sample files](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html#playback-cleanup). Closing the originating notebook or releasing its in-memory media also closes dependent previews.

The decoder limits a source to 50 MiB, a decoded frame to 4096 pixels on either side and 16 million pixels total, and a clip to 300 seconds. It allows at most four previews per notebook, subject to decoded-pixel budgets. If a preview fails or a reference becomes stale, inspect the receipt's `error` and obtain a fresh exact reference before retrying.

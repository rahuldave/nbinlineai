---
title: Live notebook outputs and canvas
---

# Work with outputs in the open notebook

The output tools inspect **what the current notebook has already produced**. They read the live JupyterLab model, including unsaved and offscreen outputs, without running cells. Start with the [worked output notebook](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html): it creates a red PNG, a line of text, an SVG, structured data, and a small drawn canvas. Run the fixture cells before trying the calls below. Each direct Python call has a later inspection cell with a saved result. The completed AI sections show the question, answer, and observed tool call; running an AI question uses your selected connection and the `&` tool declaration in that question.

## Find and read an existing output

The notebook's [`output-text` cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-text) prints `Existing output text: red square and blue vector`. To discover that existing result, run the [listing call](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-list-call) and inspect the completed receipt in the next cell:

```python
from nbinlineai.tools import list_outputs, read_output

listing = list_outputs("output-text")
# In a later cell, after its Media row completes:
print(listing.status, listing.error)
text_ref = listing.result["outputs"][0]
```

Keep the returned `cell_id`, `output_id`, and `revision` together. The [read call](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-read-call) uses that reference, and its [saved result](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-read-inspect) contains the printed line:

```python
text_read = read_output(
    text_ref["cell_id"], text_ref["output_id"], text_ref["revision"],
    max_chars=120,
)
# In a later cell:
print(text_read.status, text_read.result, text_read.error)
```

The [AI listing question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-list-read) asks for an operation receipt first. Its [status question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-list-ready) obtains the real output reference. The [AI read question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-read) then uses that reference, and its [status answer](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-read-ready) quotes the existing text. A model can read the bounded text returned by `read_output`; it does not gain image pixels from an output listing.

`read_output` also supports existing Markdown, JSON, and data-resource JSON. If a result is longer than `max_chars`, continue from its `next_start`. Use that returned offset rather than guessing where a Unicode character ends. Large structured results can be refused; produce a smaller table in the notebook. The tool does not evaluate HTML or run the source cell. Listing cursors and output revisions become stale when the outputs change, so list again after rerunning or replacing a cell.

## Export a raster, SVG, or structured result

The [raster fixture](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-raster) and [SVG fixture](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-vector) create two different output types. The [direct export calls](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-export-call) use references discovered by `list_outputs`; the [inspection cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-export-inspect) displays the 8 × 8 PNG as a Pillow image and verifies that the SVG result equals its original markup. `export_output(..., mime="image/svg+xml")` preserves the vector markup; it does not turn a bitmap into a vector drawing.

```python
from nbinlineai.tools import export_output, list_outputs

listing = list_outputs("output-raster")
# In a later cell, after completion:
raster_ref = listing.result["outputs"][0]
# Then start the export in its own cell:
exported = export_output(
    raster_ref["cell_id"], raster_ref["output_id"], raster_ref["revision"],
    save_to=None,
)
# In a later cell, after completion:
from IPython.display import display
print(exported.status, exported.media, exported.error)
if exported.status == "completed":
    display(exported.result)  # A Pillow image in Python.
```

The [AI export question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-export) uses the discovered PNG reference. Its [status answer](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-export-ready) reports the actual 8 × 8 dimensions, MIME type, hash, and managed media ID. Those descriptors are text; the image itself stays in managed media until you explicitly [attach it to a question](browser-media-attachment.md). Capturing or exporting alone does not send pixels to a model.

The notebook also [exports an existing data-resource output](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#data-export-call). Its [inspection cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#data-export-inspect) checks exact UTF-8 JSON bytes and a newly saved `.json` path. PNG/JPEG export yields a Pillow image, SVG yields markup, and supported text or structured MIME exports yield UTF-8 bytes. HTML and script output cannot be exported this way.

## Read the notebook view or selected text

`read_notebook_view()` reports the originating notebook's active cell, selected cell IDs, and visible materialized range. The [direct call](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#view-call) and [AI question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-view-selection) show the same kind of snapshot. The AI [status answer](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-view-ready) describes the actual active and visible cells. It does not change selection or focus.

`read_selection(max_chars=2000)` reads text only when an editor **in that same notebook** is focused and has a selection. The notebook first shows an [empty-selection result](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#selection-inspect). Its [direct selected-line example](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#selection-nonempty-call) gives you time to select the line in the nearby code editor; the [saved inspection](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#selection-nonempty-inspect) reports that cell ID and `SELECT_ME = "blue square"`. The [AI selection question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-selection-nonempty) is a live exercise: select the text while its request is pending and use the following status question to see what the browser actually read. An empty result means the editor selection was unavailable; it is not a reason to infer text from notebook source. This tool does not read the global clipboard or another tab.

## Capture a notebook canvas

The [canvas fixture](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-canvas) draws red and blue blocks in an ordinary HTML output. First call `list_outputs("output-canvas")`, then pass its output reference to [`list_canvases`](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#canvas-list-call). The [saved result](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#canvas-list-inspect) found one 64 × 32 canvas with its own `canvas_id` and rendered-view revision. The [AI canvas listing](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-canvas-list-capture) and [status answer](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-canvas-list-ready) show the same discovery path.

Pass the returned canvas descriptor to [`capture_canvas`](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#canvas-capture-call) for an in-memory PNG. Its [saved inspection](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#canvas-capture-inspect) displays the image and samples a red pixel. [`export_canvas`](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#canvas-export-call) captures the same raster surface but defaults to a new saved file; pass `save_to=None` to keep it only in managed memory. The [AI capture](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-canvas-capture) and [AI export](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-canvas-export) questions have separate completed status answers with dimensions and hashes.

[`start_canvas`](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#canvas-start-call) opens a **video-only source** for the shared recorder. The [direct result](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#canvas-start-inspect) reports a source ID and actual frame rate; the [AI question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-canvas-start) has its own [status answer](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-canvas-start-ready). Pass a live source ID to `start_recording` if you want a clip, then stop it with `stop_source` when finished. A canvas source adds no microphone sound. Replacing or rerendering its output makes the descriptor stale and ends the source. Only a supported, materialized stock HTML output can expose a canvas here; widgets, iframes, unavailable renderers, and cross-origin-tainted canvases report an error.

## Capture a visible output region

Run the [nearby raster fixture](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#region-raster) and keep its output fully visible. The [direct region call](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#region-call) captures `['region-raster']`, and its [saved result](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#region-inspect) displays the 8 × 8 output image. The [AI region question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-region) uses a second nearby fixture; its [completed status answer](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-region-ready) reports an 8 × 8 managed image.

`capture_notebook_region(cell_ids, save_to=None, max_size=1280)` composes existing **output surfaces** at their displayed positions. It captures neither code nor input cells and opens no screen-share chooser. The supported matrix is fully visible stock PNG/JPEG/SVG output and one origin-clean canvas in an otherwise empty stock HTML output. Mixed HTML or text, widgets, iframes, offscreen or partly hidden output, and unsupported surfaces produce an explicit error with the cell ID. For an existing image output that need not be on screen, `export_output` is usually simpler.

## Follow the receipt and clean up

Direct calls return a `BrowserReceipt` promptly. Run the call in one cell and inspect **that same receipt** in a later cell after its Media row finishes. Check `status` and `error` before using `result` or `media`. AI calls may initially return `running`; a later question using `operation_status(operation_id)` establishes the completed result. An operation can finish after the first AI answer. See [browser media receipts](browser-media-foundation.md) for state meanings, expiry, saving, and cancellation.

`save_to=None` retains bounded managed media temporarily; `save_to="auto"` creates a unique file in `media/` beside the initiating notebook; an explicit path is server-root-relative. The path appears only after a successful save, and an existing file is never overwritten. The [notebook cleanup cells](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-cleanup) stop its canvas source, release managed media, and remove the disposable files it created. Releasing media does not erase an already delivered Pillow image or a saved notebook display.

Run the interactive sequence one step at a time. **Run All does not wait** for browser receipts, editor selection, or a visible output region before advancing to dependent cells. Recheck a reference after rerunning an output cell, and keep a canvas or region output visible when that operation requires a rendered surface.

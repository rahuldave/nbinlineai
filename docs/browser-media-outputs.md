---
title: Live notebook outputs and canvas
---

# Inspect and capture notebook outputs

These browser tools inspect the **open notebook that started the request**. They read live JupyterLab cell and output models, so unsaved and offscreen outputs can be listed without running a cell or opening a renderer. Direct calls in a code cell return a `BrowserReceipt` immediately. Run a later cell to inspect its `status`, `result`, `media`, or `error`; image exports arrive as Pillow images, and native SVG exports arrive as markup text. AI tool calls receive bounded JSON descriptors, never image bytes in the answer text.

Import the functions from `nbinlineai.tools`. Offer only the functions needed by a particular AI question using ordinary Markdown `&` references; importing them alone does not authorize a model call. The [output walkthrough](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html) pairs direct code-cell requests with later inspection cells and also includes AI questions. Direct calls do not need an AI connection; AI questions use the selected connection. See the [Tool catalog](tools.md) for the complete list and the [examples guide](examples.md) for declaration rules.

## Export a plot that is already in the notebook

Run a plotting cell first. In the [output walkthrough](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#output-raster), that code cell has ID `output-raster`. List its existing outputs without executing it again:

```python
from nbinlineai.tools import list_outputs, export_output
listing = list_outputs("output-raster")
```

When `listing` completes, inspect its references in a later cell and request the PNG output using the returned ID and revision:

```python
print(listing.status, listing.error)
assert listing.status == "completed", "Wait for the listing, then rerun this cell."
print(listing.result["outputs"])
image_ref = listing.result["outputs"][0]  # The walkthrough's first output is the PNG.
exported = export_output(image_ref["cell_id"], image_ref["output_id"], image_ref["revision"])
```

After `exported` completes, display its Pillow image in another cell. The [AI listing question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-list-read) and [AI export question](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html#outputs-ai-export) use the same discovered reference; an AI reply gets a descriptor, not image pixels.

```python
from IPython.display import display
print(exported.status, exported.error)
assert exported.status == "completed", "Wait for the export, then rerun this cell."
display(exported.result)
```

## What can be read or captured

| Tool | Existing state read or result |
| --- | --- |
| `read_notebook_view()` | Active/selected cell IDs and visible materialized range. |
| `read_selection(max_chars=2000)` | Selected text only from the focused editor in this notebook. |
| `list_outputs(cell_id, cursor="", limit=10)` | Existing `OutputRef` IDs, revisions, and MIME choices. |
| `read_output(cell_id, output_id, revision, mime="text/plain", start=0, max_chars=2000)` | Bounded existing text or structured JSON; `next_start` paginates. |
| `export_output(cell_id, output_id, revision, save_to=None, mime="")` | Existing PNG/JPEG as Pillow image, original SVG markup, or supported text/JSON/data-resource MIME as UTF-8 bytes. |
| `list_canvases(cell_id, output_id, revision, cursor="", limit=10)` | Canvas refs from supported materialized stock HTML output. |
| `capture_canvas(canvas, save_to=None, max_size=1280)` | Origin-clean PNG still and Pillow image. |
| `export_canvas(canvas, save_to="auto", max_size=1280)` | Same still, saved to a new file by default. |
| `start_canvas(canvas, frame_rate=30)` | Video-only source for the shared recorder, 1–60 requested fps. |
| `capture_notebook_region(cell_ids, save_to=None, max_size=1280)` | Output-only PNG composition for the supported visible renderer matrix. |

### Read an existing output

`read_notebook_view()` reports the active cell, selected IDs, and the first and last materialized cells visible in the notebook viewport. `read_selection(max_chars=2000)` returns text only when the active editor in that same notebook has focus; otherwise it returns an empty selection. Neither call changes focus or notebook content.

`list_outputs(cell_id, cursor="", limit=10)` lists existing output references and MIME choices, including outputs not on screen. Keep the returned `cell_id`, `output_id`, and `revision` together. `read_output(...)` returns bounded existing plain text, Markdown, JSON, or data-resource JSON with `next_start` for longer content. Offsets are JavaScript string positions; use the returned `next_start` so a Unicode character is not split between pages. It does not evaluate HTML or execute a cell. Very large structured tables are refused before serialization; produce a smaller output instead. `export_output(...)` exports an existing PNG, JPEG, SVG, plain text, Markdown, JSON, or Jupyter data-resource JSON MIME. PNG/JPEG becomes a Pillow image in Python; SVG stays original markup; text and structured MIME results are UTF-8 bytes with the actual MIME in `receipt.media`. Saving a data-resource result uses a new `.json` file. HTML and script MIME are not exported. If an output changes or is replaced, list it again, even if the new bytes happen to match. Pagination cursors expire when the output list changes.

### Capture a canvas or visible output region

`list_canvases(cell_id, output_id, revision)` passively finds `<canvas>` nodes only in a materialized, stock HTML output renderer of the originating cell. A canvas in a widget, iframe, custom app, or an offscreen/unrendered cell is unavailable. A `CanvasRef` names the exact output, rendered view, and DOM node. `capture_canvas(canvas, save_to=None, max_size=1280)` returns an origin-clean PNG still as a Pillow image; `export_canvas` defaults to `save_to="auto"`. `start_canvas(canvas, frame_rate=30)` opens a video-only source for the shared recorder. It requests 1–60 frames per second and reports the track's actual rate when available; background throttling may change the delivered rate. It never adds microphone audio. Removing or rerendering that canvas ends the source, including an active recording with `source_ended`. Stop an unneeded source with `stop_source(source_id)` when the recording tools are installed. A cross-origin-tainted canvas reports an error on readback.

`capture_notebook_region(cell_ids, save_to=None, max_size=1280)` composes only existing rendered **output surfaces** at their displayed positions. Its initial supported matrix is fully visible, materialized stock PNG/JPEG/SVG outputs and a single origin-clean canvas in an otherwise empty stock HTML output. The selected cells must have outputs and be visible; every output must be supported. Mixed HTML, text, widgets, iframes, unavailable/offscreen surfaces, and partially visible outputs cause an explicit error with the cell ID. It never starts a screen chooser, captures code/input, runs a cell, or silently omits a selected output. Existing SVG markup is rasterized only for this region image; `export_output(..., mime="image/svg+xml")` remains the vector-preserving path.

### Save or keep a capture in memory

For captures, `save_to=None` retains managed bytes temporarily and sends the image to Python. `save_to="auto"` saves a new file in `media/` beside the initiating notebook; an explicit nonempty path names a new server-root-relative file. Existing files are not overwritten. A saved path is reported only after the server confirms the save. Managed memory expires after idle time, while already delivered Pillow objects and saved files remain usable. File saving can be unavailable on a server backend without the required safe filesystem operations. Call `capabilities = browser_capabilities()` in one cell, then inspect `capabilities.result['file_media_supported']` in a later cell **after** `capabilities.status` becomes `completed`.

The [output walkthrough](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html) starts with rendered notebook outputs, then discovers their actual IDs before reading or exporting them. Canvas tools require a supported, materialized canvas in the open notebook; unsupported renderers report an error.

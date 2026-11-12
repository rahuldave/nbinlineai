---
title: Tool API reference
---

# Tool API reference

The reference below reads function signatures, types, parameter comments, return
comments and docstrings from the Python source. Use the [tool catalog](tools.md)
to choose tools and open their notebook examples. Use these pages to check
arguments, defaults, results and side effects before a call.

Import public tools and setup helpers from `nbinlineai.tools`. The reference
groups each function under the module that defines it. The source links open
that module on GitHub. The reference also includes two existing utilities,
`fetch_url_markdown` and `normalize_capture_action`. Use the catalog to identify
the 96 functions that nbinlineai registers as model tools.

| Module | Functions |
| --- | --- |
| [Tool setup and core tools](https://rahuldave.com/nbinlineai/api/tools.html) | Catalog groups, declarations, live cells, saved notebook reads, kernel names and URL notes. |
| [Files and callable documentation](https://rahuldave.com/nbinlineai/api/fastcore_tools.html) | Saved files, checked text edits and live callable documentation. |
| [Live notebook editing](https://rahuldave.com/nbinlineai/api/notebook_tools.html) | Search and edit cells in the open notebook. |
| [Saved search and documents](https://rahuldave.com/nbinlineai/api/source_tools.html) | Saved notebook and file search, static Python documentation, document sections and checked edits. |
| [Kernel inspection and skills](https://rahuldave.com/nbinlineai/api/inspection_tools.html) | Live objects, module imports, traces and registered skill instructions. |
| [Execution](https://rahuldave.com/nbinlineai/api/execution_tools.html) | Explicit subprocess and shell calls. |
| [Web pages](https://rahuldave.com/nbinlineai/api/web_tools.html) | Bounded public URL text and selected page sections. |
| [Browser operations](https://rahuldave.com/nbinlineai/api/browser_media_tools.html) | Capabilities, operation status, cancellation and managed media. |
| [Live outputs](https://rahuldave.com/nbinlineai/api/browser_output_tools.html) | Output selection, text and images from the open notebook. |
| [Capture](https://rahuldave.com/nbinlineai/api/browser_capture_tools.html) | Camera, microphone, screen and recording controls. |
| [Playback and clipboard](https://rahuldave.com/nbinlineai/api/browser_playback_tools.html) | Media previews, playback controls, copying and pasting. |
| [Transformations](https://rahuldave.com/nbinlineai/api/browser_transform_tools.html) | Frames, cropping and image annotation. |
| [Image attachment](https://rahuldave.com/nbinlineai/api/browser_attachment_tools.html) | A visible action to attach an image to an AI question. |

Browser functions return a Python receipt before the browser finishes. Inspect
the same receipt in a later cell. AI calls receive a fixed status snapshot.
See [browser receipts](browser-media-foundation.md) for the follow-up steps.

For model tools, the function docstring supplies the description. Docments parameter
comments supply argument descriptions when Fastcore can read the function's
source. If the kernel lacks Fastcore, the source is unavailable or parsing fails,
argument descriptions fall back to parameter names. Types and defaults still
come from the callable signature. See [Development](development.md) for the
source convention and documentation checks.

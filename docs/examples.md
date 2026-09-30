---
title: Notebook examples
---

# Notebook examples

Choose a [walkthrough](#walkthroughs) to follow a task or a [Tool catalog notebook](#tool-catalog-notebooks) to try a specific function. Open its editable `.ipynb` file in JupyterLab and make a copy before changing it. The notebooks use disposable inputs and put setup before the calls that depend on it. The [Tool catalog](tools.md) links each function to its exact demonstration cell.

The rendered notebook pages show outputs and AI answers saved in their source files; opening a page does not run the notebook. A direct Python call displays what the kernel returned. An AI question asks your selected ChatGPT connection or configured API provider to call an offered tool. In tool examples, an observed-tool table beside a saved answer records the actual call; a question without a following answer is ready for your own run. Ordinary nbinlineai answers do not automatically save a separate tool transcript, and an answer merely suggesting a call does not establish that it ran. Python-only setup needs no provider. Live editor tools have no direct Python-call equivalent; their comparison is an ordinary JupyterLab action on a second disposable copy.

## Work through a notebook

1. Read a rendered notebook from the gallery below, then get its editable `.ipynb` from that page's source link or the [GitHub examples folder](https://github.com/rahuldave/nbinlineai/tree/main/examples). Open a copy in JupyterLab. Keep `data/` beside it when the notebook uses a fixture.
2. Run setup code and read the next cell's instructions. For live browser actions, grant permission or use the visible chooser only when you want that action.
3. Run one AI question at a time. Inspect the answer and any observed-tool table before using an ID or result in the next question. Keep answers on when you want to preserve a completed tool action.
4. Run cleanup cells after you finish. They remove disposable files, active media sources, or managed bytes as the notebook specifies.

A browser-media Python call returns a **mutable receipt immediately**. Its first printed value can say `running` or `waiting_for_user`; that is an acknowledgement, not an image, recording, or saved file. Let the browser finish, then run the later inspection cell to read the same receipt's current `status`, `result`, and `media`. One media-producing operation can return several typed media items. An AI tool response is an **initial snapshot**; use `operation_status` in a later question to learn the terminal result. Status lookup itself returns one snapshot and does not wait. [Browser-media foundation](browser-media-foundation.md) explains the receipt and ownership rules.

Run All follows the notebook's ordinary execution order, but a browser receipt does not hold the kernel until permission, recording, or transfer finishes. Run interactive media calls and their dependent inspection cells separately. A generated `insert_code` cell remains editable and unexecuted; review it before choosing to run it yourself. The Codex ACP exercise intentionally begins with a failing diagnostic, which the exercise asks you to repair.

## Ask after declaring a tool

Import a tool into the live kernel, then put its `&` reference in an ordinary Markdown declaration above the AI question, or in the question itself. For example:

```python
from nbinlineai.tools import show_doc, tools_markdown
print(tools_markdown(["show_doc"]))
```

Paste the printed reference into an ordinary Markdown cell with **Tools** enabled. A later question can ask: “Use `show_doc` to explain the `encoding` parameter of `Path.read_text` and give one short example.” The declaration offers the callable; the question tells the model when to use it. An imported name alone is not offered. Keep the question's total offered tool and variable names within 20. [Variables and tools](manual/variables-and-tools.md) covers inheritance and live values.

`insert_tools(["show_doc"])` can insert an editable declaration below its Python call. It returns an asynchronous receipt and does not call a model; inspect the receipt later and save the notebook to keep the new note. The [live variables notebook](https://rahuldave.com/nbinlineai/notebooks/live-variables-and-tools.html) demonstrates this optional helper.

## Walkthroughs

These notebooks develop a task across several cells. The tools column names the functions actually called or offered in each notebook; custom functions and setup helpers are labeled. The application ideas are ways to adapt the demonstrated steps, not extra actions the notebook performs for you.

| Notebook | Tools shown | What you can make/do |
| --- | --- | --- |
| [Quick start](https://rahuldave.com/nbinlineai/notebooks/quickstart.html) | Custom `add_bonus`; live `$` value reference. | Ask about a current score and call a bonus function; adapt the pattern to a grade adjustment or simple budget calculation. |
| [Context selection](https://rahuldave.com/nbinlineai/notebooks/context-selection.html) | Custom `average_score`; Context preview and Tools checkbox are JupyterLab controls. | Check a live practice-score mean while deciding which notes a tutor may read; use the same preview to keep unrelated project notes out of a focused question. |
| [Live variables and tools](https://rahuldave.com/nbinlineai/notebooks/live-variables-and-tools.html) | Custom `record_bonus`, `average_score`; `insert_tools` setup helper. | Build a practice-score tutor that checks a mean and records a deliberate bonus; adapt the pattern to a running tally that you inspect before continuing. |
| [Socratic learning dialogue](https://rahuldave.com/nbinlineai/notebooks/socratic-learning-dialog.html) | No bundled tools; inline AI questions and notebook context. | Work through a guided lesson in which you revise your own attempt after each tutor response; adapt the turns to a coding explanation or exam practice. |
| [Bundled tools](https://rahuldave.com/nbinlineai/notebooks/bundled-tools.html) | `search_kernel_names`, `list_notebooks`, `find_notebook_cells`, `read_notebook_cell`, `insert_code`; `tools_markdown` setup helper. | Locate a live name and saved lesson cell, then request an editable code draft; use the same sequence to revisit an earlier exercise or prepare a small data-check cell. |
| [Live notebook tools](https://rahuldave.com/nbinlineai/notebooks/live-notebook-tools.html) | `list_cells`, `read_cell`, `insert_markdown`; `tools_markdown` setup helper. | Find an unsaved observation and add a reviewable field note; similarly annotate a draft analysis cell before saving. |
| [Python and web tools](https://rahuldave.com/nbinlineai/notebooks/python-and-web-tools.html) | `inspect_python`, `read_url`, `url_to_note`, custom `average_alias`; `tools_markdown` setup helper. | Explain a live function using its signature and source, then keep a source-linked public reference; compare a local calculation with a library guide. |
| [Fastcore tools](https://rahuldave.com/nbinlineai/notebooks/fastcore-tools.html) | `show_doc`, `path_info`, `list_files`, `view_file`, `create_file`, `file_str_replace`, `file_insert_line`, `file_replace_lines`; `tools_markdown` setup helper. | Document a small analysis function, create a text log, or revise an existing note after inspecting its current lines. |
| [Project tools](https://rahuldave.com/nbinlineai/notebooks/project-tools.html) | `search_files`, `search_notebooks`, `source_doc`, `document_outline`, `read_document_section`, `notebook_outline`, `file_strs_replace`, `view_file_hashes`, `file_replace_checked`; `tool_catalog` and `tools_markdown` setup helpers. | Trace a saved result across source, notebook, and Markdown notes; review a proposed correction and apply a digest-checked replacement only after checking it. |
| [Image from output to question](https://rahuldave.com/nbinlineai/notebooks/browser-media-integration.html) | `list_outputs`, `export_output`, `open_media`, `close_media`, `crop_image`, `save_media`, `attach_media`, `operation_status`, `release_media`. | Inspect a crop from a chart or lab image already shown as output, then explicitly confirm that derivative for a question about the visible trend or feature. |
| [Jupyter AI and nbinlineai together](https://rahuldave.com/nbinlineai/notebooks/jupyter-ai-and-nbinlineai.html) | `insert_code`; Jupyter AI chat is a separate UI. | Discuss an analysis refactor in chat, explain a nearby result inline, or request an unexecuted validation draft for your review. |
| [Codex ACP worked example](https://rahuldave.com/nbinlineai/notebooks/codex-acp-worked-example.html) | No bundled tools; optional Codex ACP persona in Jupyter AI chat. | Diagnose the intentional bug through separate agent chat, then ask inline why the repair works; adapt that division to another small debugging exercise. |

Jupyter AI's Codex sign-in is separate from nbinlineai's model connection. The combined-extension notebooks do not transfer chat history into an inline question automatically.

## Tool catalog notebooks

Every public tool has a demonstration in at least one notebook below. Related calls share a notebook when they form one workflow. The tools column also includes demonstrated status and cleanup calls. Direct Python examples and AI questions use the same disposable inputs where both routes exist; live editor tools compare an AI action with a manual JupyterLab edit on a second copy. Use the [Tool catalog](tools.md#function-index) for the full function list and links to individual cells.

### Python, files, notebooks, and web

| Notebook | Tools shown | What you can make/do |
| --- | --- | --- |
| [Live Python inspection](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-inspection.html) | `search_kernel_names`, `inspect_python`, `show_doc`, `api_names`, `search_docs`, `inspect_value`, `search_value`, `source_files`, `list_skills`, `read_skill`, `trace_function`. | Investigate a live calculation by finding values, API guidance, and source; trace a disposable call or inspect an installed skill's instructions. |
| [Saved files and source](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-files.html) | `path_info`, `list_files`, `view_file`, `create_file`, `file_str_replace`, `file_insert_line`, `file_replace_lines`, `search_files`, `source_doc`, `document_outline`, `read_document_section`, `file_strs_replace`, `view_file_hashes`, `file_replace_checked`; `tool_catalog` setup helper. | Audit a small saved project, locate a definition or document section, and make bounded text edits after checking file contents and hash. |
| [Saved notebooks](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-saved-notebooks.html) | `list_notebooks`, `search_notebooks`, `notebook_outline`, `find_notebook_cells`, `read_notebook_cell`. | Build a reading index across saved notebooks, or find a past observation by topic and quote its cell source using the stable ID. |
| [Live notebook cells](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-live-notebook.html) | `list_cells`, `read_cell`, `find_cells`, `insert_markdown`, `insert_code`, `replace_cell`, `cell_str_replace`, `cell_insert_line`, `cell_replace_lines`, `delete_cell`, `move_cell`, `copy_cell`, `split_cell`, `merge_cells`; `tools_markdown` setup helper. | Review unsaved scratch cells and make checked edits to the open notebook; reorganize a draft lesson or inspect inserted code before you choose to execute it. |
| [Public web pages](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-web.html) | `read_url`, `read_url_section`, `url_to_note`. | Read a public API guide, focus on a relevant section, or insert a bounded source-linked note for later comparison. |
| [Local processes](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-processes.html) | `run_python`, `run_shell`, `tmux_sessions`, `tmux_read`. | Check a disposable project's command output, run an isolated Python calculation, or inspect an existing tmux pane where installed. |

### Browser media

Browser actions can need a permission choice or a visible control. Their direct calls return receipts to inspect later, and their AI questions use `operation_status` to check a completed action where shown. The application ideas below require you to perform those visible steps and run dependent cells separately.

For the generated-file foundation, playback, and attachment notebooks, start JupyterLab with the copied notebook's working folder as the server root. Their filename-only media references assume that layout. If you launch from its parent folder, adjust each reference to a **server-root-relative path** and keep the exact file's SHA-256; an absolute path is not a media reference.

| Notebook | Tools shown | What you can make/do |
| --- | --- | --- |
| [Browser-media foundation](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html) | `browser_capabilities`, `save_media`, `operation_status`, `cancel_operation`, `release_media`. | Check browser readiness before a media task; save an exact disposable PNG and verify its final state before releasing managed bytes. |
| [Camera, microphone, and display](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html) | `list_media_sources`, `start_camera`, `capture_camera`, `start_microphone`, `read_audio_levels`, `start_recording`, `pause_recording`, `resume_recording`, `stop_recording`, `stop_source`, `record_camera`, `record_microphone`, `setup_share`, `start_share`, `capture_screen`, `capture_tool`, `stop_share`, `list_outputs`, `list_canvases`, `start_canvas`, `operation_status`, `release_media`. | With permission, collect a field still or short spoken note; capture a selected display frame for a demo, or pause and resume a recording. `setup_share` only presents the local Share control. |
| [Notebook outputs and canvas](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html) | `read_notebook_view`, `read_selection`, `list_outputs`, `read_output`, `export_output`, `list_canvases`, `capture_canvas`, `export_canvas`, `start_canvas`, `stop_source`, `capture_notebook_region`, `operation_status`, `release_media`. | Read a selected line or structured result, export a chart's exact output, or capture a supported visible canvas or output region for review. |
| [Import, playback, and clipboard](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html) | `choose_file`, `open_media`, `play_media`, `pause_media`, `seek_media`, `set_media_volume`, `close_media`, `copy_text`, `paste_content`, `operation_status`, `release_media`. | Choose a local image for inspection, review and seek within a generated audio clip, or exchange a short note through visible Copy and Paste controls. |
| [Media transformations](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html) | `extract_frames`, `crop_image`, `annotate_image`, `operation_status`, `release_media`. | Compare selected frames from a recording, crop a detail from a still, or mark and redact a separate image derivative while retaining the source. |
| [Attach an image](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html) | `attach_media`, `operation_status`. | After explicit **Attach image** confirmation, ask about a chart trend, a diagram relationship, a lab image feature, or a selected output or video frame. The sample confirms one generated still for one question; prepare an image first for those other uses. |

The media guides describe formats, limits, and cleanup: [capture](browser-media-capture.md), [outputs](browser-media-outputs.md), [playback](browser-media-playback.md), [transforms](browser-media-transforms.md), and [attachment](browser-media-attachment.md). `attach_media` confirmation alone does not run a question or call the provider; run the question when you are ready. Real device steps use the media you explicitly choose to share.

[User guide](user-guide.md) · [Tool catalog](tools.md) · [FAQ](faq.md)

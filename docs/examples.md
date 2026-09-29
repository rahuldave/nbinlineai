---
title: Notebook examples
---

# Notebook examples

Open a notebook from the [gallery](#walkthroughs) in JupyterLab and make a copy before editing it. Each example starts with disposable inputs. Run its setup cells, then work downward one step at a time. A normal Python call shows what the function returns in the kernel; a nearby AI question asks the model to use the same tool and records the answer in the notebook. The [Tool catalog](tools.md) links each function to its exact demonstration cell.

AI questions use your selected ChatGPT connection or configured API provider. A question can call an offered tool, so ask for a specific call when you want to observe it. These worked notebooks include an observed-tool table beside each saved answer to show what happened; ordinary nbinlineai answers do not automatically save a separate tool transcript. A suggested call in answer prose is not evidence that the tool ran. Python-only setup needs no provider. Some browser-backed tools have no direct Python-call equivalent: their normal comparison is an ordinary JupyterLab action on a second disposable copy.

## Work through a notebook

1. Copy the notebook and keep `data/` beside it when the notebook uses a fixture. The [GitHub examples folder](https://github.com/rahuldave/nbinlineai/tree/main/examples) has the editable `.ipynb` files. The gallery pages below let you read them first.
2. Run setup code and read the next cell's instructions. For live browser actions, grant permission or use the visible chooser only when you want that action.
3. Run one AI question at a time. Inspect its saved answer and the observed-tool table before using an ID or result in the next question. Keep answers on when you want to preserve a completed tool action.
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

These notebooks develop a task across several cells. Their setup uses disposable data; their AI questions are meant to be run and read in order.

| Notebook | What you will do |
| --- | --- |
| [Quick start](https://rahuldave.com/nbinlineai/notebooks/quickstart.html) | Read a live Python value, offer one custom function, and ask a first concise question. |
| [Context selection](https://rahuldave.com/nbinlineai/notebooks/context-selection.html) | Compare what each context choice sends and control a declaration cell with Tools. |
| [Live variables and tools](https://rahuldave.com/nbinlineai/notebooks/live-variables-and-tools.html) | Compare a live value with a function call and observe a change in Python state. |
| [Socratic learning dialogue](https://rahuldave.com/nbinlineai/notebooks/socratic-learning-dialog.html) | Answer a tutor turn by turn; edit your own attempt before continuing. |
| [Bundled tools](https://rahuldave.com/nbinlineai/notebooks/bundled-tools.html) | Find live names and inspect a supplied saved notebook; leave a generated code draft unrun. |
| [Live notebook tools](https://rahuldave.com/nbinlineai/notebooks/live-notebook-tools.html) | Read unsaved cells and insert an editable hint in the open notebook. |
| [Python and web tools](https://rahuldave.com/nbinlineai/notebooks/python-and-web-tools.html) | Inspect Python help and source, read a public page, and add a source-linked note. |
| [Fastcore tools](https://rahuldave.com/nbinlineai/notebooks/fastcore-tools.html) | Inspect documentation and make checked edits to temporary text files. |
| [Project tools](https://rahuldave.com/nbinlineai/notebooks/project-tools.html) | Search a disposable source project and preview digest-checked changes. |
| [Image from output to question](https://rahuldave.com/nbinlineai/notebooks/browser-media-integration.html) | Export, preview, and crop a disposable output, then explicitly confirm one image for one AI question. |
| [Jupyter AI and nbinlineai together](https://rahuldave.com/nbinlineai/notebooks/jupyter-ai-and-nbinlineai.html) | Compare optional Jupyter AI chat work with inline learning questions. |
| [Codex ACP worked example](https://rahuldave.com/nbinlineai/notebooks/codex-acp-worked-example.html) | Diagnose and repair an intentional teaching bug, then explain the result inline. |

Jupyter AI's Codex sign-in is separate from nbinlineai's model connection. The combined-extension notebooks do not transfer chat history into an inline question automatically.

## Tool catalog notebooks

These notebooks give every registered tool a concrete demonstration. Their normal Python examples and concise AI questions use the same disposable inputs where both routes exist. The live editor tools instead compare the AI action with a manual JupyterLab edit on a second copy.

| Notebook | What you will try |
| --- | --- |
| [Live Python inspection](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-inspection.html) | Inspect disposable kernel values, callable signatures, docs, and traces. |
| [Saved files and source](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-files.html) | Search temporary files and make bounded, checked source edits. |
| [Saved notebooks](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-saved-notebooks.html) | Find and read a temporary notebook by its saved stable cell ID. |
| [Live notebook cells](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-live-notebook.html) | Read and edit separate scratch cells in a copied open notebook. |
| [Public web pages](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-web.html) | Read a public page and insert a bounded note with its source link. |
| [Local processes](https://rahuldave.com/nbinlineai/notebooks/tool-catalog-processes.html) | Run bounded commands and inspect a disposable tmux pane when available. |
| [Browser-media foundation](https://rahuldave.com/nbinlineai/notebooks/browser-media-foundation.html) | Check capabilities and exercise save, status, cancel, and release on a tiny PNG. |
| [Camera, microphone, and display](https://rahuldave.com/nbinlineai/notebooks/browser-media-capture.html) | Use real permission controls and later receipts for captures and recordings. |
| [Notebook outputs and canvas](https://rahuldave.com/nbinlineai/notebooks/browser-media-outputs.html) | Read existing outputs and capture supported canvas or visible regions. |
| [Import, playback, and clipboard](https://rahuldave.com/nbinlineai/notebooks/browser-media-playback.html) | Import a generated file, preview a WAV, and use visible copy/paste controls. |
| [Media transformations](https://rahuldave.com/nbinlineai/notebooks/browser-media-transforms.html) | Extract real video frames and make source-preserving crops and annotations. |
| [Attach an image](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html) | Confirm a generated still image for one question, inspect it, and remove it. |

The media guides describe formats, limits, and cleanup: [capture](browser-media-capture.md), [outputs](browser-media-outputs.md), [playback](browser-media-playback.md), [transforms](browser-media-transforms.md), and [attachment](browser-media-attachment.md). `attach_media` confirmation alone does not run a question or call the provider; run the question when you are ready. Real device steps use the media you explicitly choose to share.

[User guide](user-guide.md) · [Tool catalog](tools.md) · [FAQ](faq.md)

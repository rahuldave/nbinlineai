# Notebook examples

**START HERE:** [Starter tools tutorial](https://rahuldave.com/nbinlineai/notebooks/starter-tools-tutorial.html) inserts 19 default tool declarations and uses selected tools. Open a copy of [starter-tools-tutorial.ipynb](starter-tools-tutorial.ipynb) in JupyterLab. Run `insert_tool_catalog()` in its setup cell, inspect the inserted declaration, then try the AI questions with your connection. They practice disposable files, a saved notebook, live unsaved cells, insertion, and review. The five questions include real saved answers and observed-tool tables. Follow the notebook's fresh-run instructions to repeat them.

Choose a complete application below to see how several tools fit together, or use the [gallery](https://rahuldave.com/nbinlineai/examples.html) for another lesson. Open a copy of its `.ipynb` in JupyterLab; keep `data/` beside the notebooks that use it, and keep `media/owned-notebook-tab-2087303b97be.webm` beside the transforms notebook for offline use. The HTML pages let you read saved content without running it, while the editable originals are in this folder.

The application notebooks include saved AI answers and Python outputs from an isolated JupyterLab run. The saved media applications used a generated canvas and silent audio, not a physical device or real defect:

- [Receipts to Python values](https://rahuldave.com/nbinlineai/notebooks/application-receipts-to-values.html) uses actual images and clips from receipts in ordinary Python and checks AI status snapshots.
- [Presenter kit](https://rahuldave.com/nbinlineai/notebooks/application-presenter-kit.html): capture a person, a screen, and narration, then assemble a local HTML presentation with written notes.
- [Screen bug report](https://rahuldave.com/nbinlineai/notebooks/application-screen-bug-report.html): capture a short reproduction, mark a still, ask a confirmed visual question, and produce an evidence report.
- [Data investigation](https://rahuldave.com/nbinlineai/notebooks/application-data-investigation.html): investigate fabricated data with live values, checks, and a written report.
- [Project handoff](https://rahuldave.com/nbinlineai/notebooks/application-project-handoff.html): compare source with a method note, make a checked repair, verify it, and create a project handoff.

The [application guide](https://rahuldave.com/nbinlineai/tool-applications.html) explains how the pieces fit together. The [dated audit](https://rahuldave.com/nbinlineai/example-audit.html) records earlier example runs and their limits. The browser-media examples work with the published nbinlineai 0.1.18 package. For development, use the [main source setup](https://rahuldave.com/nbinlineai/development.html#set-up-from-source).

The [complete catalog](https://rahuldave.com/nbinlineai/examples.html) lists all 30 gallery notebooks and the [supporting ecosystem fixture](https://github.com/rahuldave/nbinlineai/blob/main/examples/data/ecosystem-lesson.ipynb). Each gallery page links its editable notebook source.

Run setup code first. A normal Python call shows the kernel result; a nearby AI question asks the model to use the same tool. Some notebooks include observed-tool tables beside saved answers; ordinary nbinlineai answers do not automatically save a separate transcript. The starter tutorial also includes five worked questions.

Importing a tool alone does not offer it to the model. Keep the relevant `&` declaration in an ordinary Markdown cell above the question or in the question itself. The 15 tools for reading or editing live cells act on the open notebook, including unsaved changes. Ask the AI to call one, such as `read_cell` or `insert_code`; calling it directly in Python raises an error with that instruction. Their examples compare the AI action with a manual edit in a second disposable notebook copy, so the first edit does not change the other route's starting cells.

Browser-media calls return mutable receipts immediately. A `running` or `waiting_for_user` receipt is not a finished capture or save. Complete the visible permission or chooser action, then run the later inspection cell. AI tool results are initial snapshots; a later `operation_status` question checks the terminal result.

Run interactive cells one at a time, including when you otherwise use Run All. Some media notebooks ask for the absolute Jupyter server root. The [media setup guide](https://rahuldave.com/nbinlineai/examples.html#browser-media) explains how to use the folder shown after `Serving notebooks from local directory:` in the Jupyter startup log. If someone else runs the server, ask them for that folder. It can differ from the kernel's working folder. Clean up disposable media and files with the notebook's final cells.

The [Tool catalog](https://rahuldave.com/nbinlineai/tools.html) links every public function to a precise notebook cell. The [examples guide](https://rahuldave.com/nbinlineai/examples.html) explains the walkthroughs and the tool-catalog notebooks. Each notebook uses disposable inputs. Run a live AI question with your configured connection; direct Python setup does not require one.

The optional [Codex ACP exercise](https://rahuldave.com/nbinlineai/notebooks/codex-acp-worked-example.html) uses a separate Jupyter AI chat. Its failing diagnostic is intentional, and generated code drafts remain unexecuted for your review. Jupyter AI's Codex sign-in and nbinlineai's model connection are separate.

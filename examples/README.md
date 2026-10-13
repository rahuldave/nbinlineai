# Notebook examples

Start with a complete application below to see how several tools fit together, or use the [gallery](https://rahuldave.com/nbinlineai/examples.html) to choose an introductory or tool-catalog notebook. Open a copy of its `.ipynb` in JupyterLab; keep `data/` beside the notebooks that use it, and keep `media/owned-notebook-tab-2087303b97be.webm` beside the transforms notebook for offline use. The HTML pages let you read the examples without running them, while the editable originals are in this folder.

The new application notebooks are unrun tutorials, with empty outputs ready for your results:

- [Receipts to Python values](https://rahuldave.com/nbinlineai/notebooks/application-receipts-to-values.html): use actual images and clips from receipts in ordinary Python, and check AI status snapshots.
- [Presenter kit](https://rahuldave.com/nbinlineai/notebooks/application-presenter-kit.html): capture a person, a screen, and narration, then assemble a local HTML presentation with written notes.
- [Screen bug report](https://rahuldave.com/nbinlineai/notebooks/application-screen-bug-report.html): capture a short reproduction, mark a still, ask a confirmed visual question, and produce an evidence report.
- [Data investigation](https://rahuldave.com/nbinlineai/notebooks/application-data-investigation.html): investigate fabricated data with live values, checks, and a written report.
- [Project handoff](https://rahuldave.com/nbinlineai/notebooks/application-project-handoff.html): compare source with a method note, make a checked repair, verify it, and create a project handoff.

The [application guide](https://rahuldave.com/nbinlineai/tool-applications.html) explains how the pieces fit together. The [audit](https://rahuldave.com/nbinlineai/example-audit.html) reviews all 25 original notebooks; none has been removed. The browser-media examples require nbinlineai 0.1.16 or a Git-source installation containing those tools. If 0.1.16 is not yet available from PyPI, use the [main source setup](https://rahuldave.com/nbinlineai/development.html#set-up-from-source); 0.1.15 does not include these additions.

The [complete catalog](https://rahuldave.com/nbinlineai/examples.html) lists all 29 gallery notebooks and the [supporting ecosystem fixture](https://github.com/rahuldave/nbinlineai/blob/main/examples/data/ecosystem-lesson.ipynb). Each gallery page links its editable notebook source.

Run setup code first. A normal Python call shows the kernel result; a nearby AI question asks the model to use the same tool. These worked notebooks add an observed-tool table beside saved answers; ordinary nbinlineai answers do not automatically save a separate transcript. Importing a tool alone does not offer it to the model: keep the relevant `&` declaration in an ordinary Markdown cell above the question or in the question itself. The 15 live-editor tools have a manual JupyterLab comparison because their direct Python stubs cannot perform the editor action.

Browser-media calls return mutable receipts immediately. A `running` or `waiting_for_user` receipt is not a finished capture or save. Complete the visible permission or chooser action, then run the later inspection cell. AI tool results are initial snapshots; a later `operation_status` question checks the terminal result. Run interactive cells one at a time, including when you otherwise use Run All. The six original media notebooks that read or save files ask for the absolute Jupyter server root in setup; enter the folder JupyterLab serves, even if the kernel is working in a nested notebook folder. Clean up disposable media and files with the notebook's final cells.

The [Tool catalog](https://rahuldave.com/nbinlineai/tools.html) links every public function to a precise notebook cell. The [examples guide](https://rahuldave.com/nbinlineai/examples.html) explains the walkthroughs and the tool-catalog notebooks. Each notebook uses disposable inputs. Run a live AI question with your configured connection; direct Python setup does not require one.

The Codex ACP exercise intentionally starts with a failing diagnostic, and generated code-draft cells remain unexecuted for your review. Jupyter AI's Codex sign-in and nbinlineai's model connection are separate.

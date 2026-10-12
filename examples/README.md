# Notebook examples

Start with a complete application below to see how several tools fit together, or use the [gallery](https://rahuldave.com/nbinlineai/examples.html) to choose an introductory or tool-catalog notebook. Open a copy of its `.ipynb` in JupyterLab; keep `data/` beside the notebooks that use it. The HTML pages let you read the examples without running them, while the editable originals are in this folder.

The new application notebooks are unrun tutorials, with empty outputs ready for your results:

- `application-receipts-to-values.ipynb`: use actual images and clips from receipts in ordinary Python, and check AI status snapshots.
- `application-presenter-kit.ipynb`: capture a person, a screen, and narration, then assemble a local HTML presentation with written notes.
- `application-screen-bug-report.ipynb`: capture a short reproduction, mark a still, ask a confirmed visual question, and produce an evidence report.
- `application-data-investigation.ipynb`: investigate fabricated data with live values, checks, and a written report.
- `application-project-handoff.ipynb`: compare source with a method note, make a checked repair, verify it, and create a project handoff.

The [application guide](https://rahuldave.com/nbinlineai/tool-applications.html) explains how the pieces fit together. The [audit](https://rahuldave.com/nbinlineai/example-audit.html) reviews all 25 original notebooks; none has been removed. These additions use current Git-source tools. The published PyPI 0.1.15 package does not include the browser-media additions; use a source installation containing them, as described by the media guides.

Run setup code first. A normal Python call shows the kernel result; a nearby AI question asks the model to use the same tool. These worked notebooks add an observed-tool table beside saved answers; ordinary nbinlineai answers do not automatically save a separate transcript. Importing a tool alone does not offer it to the model: keep the relevant `&` declaration in an ordinary Markdown cell above the question or in the question itself. The 15 live-editor tools have a manual JupyterLab comparison because their direct Python stubs cannot perform the editor action.

Browser-media calls return mutable receipts immediately. A `running` or `waiting_for_user` receipt is not a finished capture or save. Complete the visible permission or chooser action, then run the later inspection cell. AI tool results are initial snapshots; a later `operation_status` question checks the terminal result. Run interactive cells one at a time, including when you otherwise use Run All. Clean up disposable media and files with the notebook's final cells.

The [Tool catalog](https://rahuldave.com/nbinlineai/tools.html) links every public function to a precise notebook cell. The [examples guide](https://rahuldave.com/nbinlineai/examples.html) explains the walkthroughs and the tool-catalog notebooks. Each notebook uses disposable inputs. Run a live AI question with your configured connection; direct Python setup does not require one.

The Codex ACP exercise intentionally starts with a failing diagnostic, and generated code-draft cells remain unexecuted for your review. Jupyter AI's Codex sign-in and nbinlineai's model connection are separate.

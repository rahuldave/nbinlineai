# Notebook examples

Start with the [gallery](https://rahuldave.com/nbinlineai/examples.html) to choose a walkthrough or a complete tool-catalog notebook. Open a copy of its `.ipynb` in JupyterLab; keep `data/` beside the notebooks that use it. The HTML pages let you read the examples without running them, while the editable originals are in this folder.

Run setup code first. A normal Python call shows the kernel result; a nearby AI question asks the model to use the same tool. These worked notebooks add an observed-tool table beside saved answers; ordinary nbinlineai answers do not automatically save a separate transcript. Importing a tool alone does not offer it to the model: keep the relevant `&` declaration in an ordinary Markdown cell above the question or in the question itself. The 15 live-editor tools have a manual JupyterLab comparison because their direct Python stubs cannot perform the editor action.

Browser-media calls return mutable receipts immediately. A `running` or `waiting_for_user` receipt is not a finished capture or save. Complete the visible permission or chooser action, then run the later inspection cell. AI tool results are initial snapshots; a later `operation_status` question checks the terminal result. Run interactive cells one at a time, including when you otherwise use Run All. Clean up disposable media and files with the notebook's final cells.

The [Tool catalog](https://rahuldave.com/nbinlineai/tools.html) links every public function to a precise notebook cell. The [examples guide](https://rahuldave.com/nbinlineai/examples.html) explains the walkthroughs and the tool-catalog notebooks. Each notebook uses disposable inputs. Run a live AI question with your configured connection; direct Python setup does not require one.

The Codex ACP exercise intentionally starts with a failing diagnostic, and generated code-draft cells remain unexecuted for your review. Jupyter AI's Codex sign-in and nbinlineai's model connection are separate.

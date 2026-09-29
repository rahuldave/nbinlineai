# nbinlineai

Ask AI questions inside a JupyterLab notebook. Each question and answer is an editable Markdown cell that stays with the notebook. You can refer to live Python values, offer selected functions as tools, inspect notebook cells and files, and choose when an image is attached to one question.

![Notebook AI defaults, a question, and its saved answer](https://raw.githubusercontent.com/rahuldave/nbinlineai/main/docs/images/overview.png)

## Start in JupyterLab

1. Install **nbinlineai** in the environment that runs JupyterLab. In Extension Manager, search for nbinlineai and install it; then restart the whole Jupyter server. In a uv project, use `uv add jupyterlab nbinlineai` and launch with `uv run jupyter lab`.
2. Open a Python notebook and choose **Configure AI**. Sign in with ChatGPT or save an OpenAI or Anthropic API key. Set the notebook's connection and model in **AI defaults**.
3. Select a cell, click **+ AI Prompt**, ask a question, and press **Shift+Enter** or **Run AI**. The answer appears in its own Markdown cell below the question.

The [setup chapter](https://rahuldave.com/nbinlineai/manual/setup.html) covers connections, model choices, and hosted JupyterLab installs. ChatGPT uses your account allowance; API providers bill their own requests. The extension does not silently switch to a paid API connection.

## Ask about live notebook work

Run a Python cell:

```python
score = 7

def add_bonus(value: int) -> int:
    """Add a bonus to the live score."""
    return score + value
```

Then put this in an AI question:

```text
What is $`score`? Call &`add_bonus` with value 3 and explain the result briefly.
```

`$` reads a live value from the notebook's current Python kernel. `&` offers a function for the model to call; ask for the call explicitly when it matters. You can put tool declarations in an ordinary Markdown note above several questions. The [variables and tools chapter](https://rahuldave.com/nbinlineai/manual/variables-and-tools.html) explains what is available and how to keep declarations selective.

Questions use the notebook's **Context** choice and can include earlier code, notes, and completed AI exchanges. **Details → Check context** previews the current selection without contacting a provider. A saved answer can be edited like any other Markdown; turn off **Keep answer** before rerunning its question. JupyterLab's **Run All Cells** includes AI questions in order, while kept completed answers avoid repeating their tool actions. [Read the manual](https://rahuldave.com/nbinlineai/user-guide.html) for context, editing, and Run All.

## Explore the tool catalog and examples

The [Tool catalog](https://rahuldave.com/nbinlineai/tools.html) lists each function and links to a normal Python or JupyterLab demonstration and a concise AI-tool question. The [notebook examples](https://rahuldave.com/nbinlineai/examples.html) include task walkthroughs and complete tool-catalog notebooks using disposable inputs. Open a copy before editing it. Generated code cells are left unexecuted for your review.

Browser-media tools can inspect selected outputs, capture from a source you approve, play or transform media, and attach an image to one question with explicit confirmation. A direct Python call returns a **mutable receipt promptly**; run its later inspection cell after permission, recording, or transfer finishes. An AI tool reply is an initial snapshot, so ask `operation_status` later before using a result ID. A capture or preview does not silently send its pixels to the model. [Browser media operations](https://rahuldave.com/nbinlineai/browser-media-foundation.html) explains receipts and cleanup.

## Where your work lives

Questions, answers, and notebook defaults are saved in the `.ipynb` file. API keys are saved outside notebooks in the Jupyter server user's configuration; ChatGPT sign-in is managed by its account runtime. Tool calls can read or change files and kernel state with that user's permissions, so offer only the functions your question needs. A confirmed image attachment belongs to one question, and confirmation alone does not run it. [Saved notebooks and privacy](https://rahuldave.com/nbinlineai/manual/saving-and-privacy.html) has the details.

[Documentation](https://rahuldave.com/nbinlineai/) · [FAQ](https://rahuldave.com/nbinlineai/faq.html) · [Development](https://rahuldave.com/nbinlineai/development.html) · [Report an issue](https://github.com/rahuldave/nbinlineai/issues)

Licensed under GPL-3.0-only.

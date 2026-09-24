---
title: nbinlineai
---

# AI conversations inside your notebook

**nbinlineai** adds AI prompt cells to JupyterLab. Ask about the code and notes above a cell, refer to live Python values, and let a model call functions you explicitly name. Prompts and answers stay in the notebook as readable Markdown.

## Start here

1. Install **nbinlineai** from JupyterLab's Extension Manager, then restart the whole Jupyter server.
2. Open a Python notebook and use **Configure AI** to sign in with ChatGPT or save an OpenAI or Anthropic API key.
3. Choose your notebook's model and style in **AI defaults**.
4. Click **+ AI Prompt**, write a question, and press **Shift+Enter**.

For a uv project:

```bash
uv add jupyterlab nbinlineai
uv run jupyter lab
```

![Notebook defaults, an AI prompt, and its saved answer](images/overview.png)

## User guide chapters

The [user guide index](user-guide.md) shows the reading order. Open the chapter you need:

1. [Install and connect](manual/setup.md) — install, sign in with ChatGPT, or save an API key.
2. [Write and run AI questions](manual/prompts.md) — prompts, answers, code copying, and insertion.
3. [Models, styles, and effort](manual/models-and-styles.md) — notebook and cell choices.
4. [Edit, rerun, and run notebooks](manual/editing-and-running.md) — Keep answer, corrections, and Run All.
5. [Choose notebook context](manual/context-selection.md) — cell choices, previews, and provider budgets.
6. [Live values and tools](manual/variables-and-tools.md) — kernel references and declared functions.
7. [Saved notebooks and privacy](manual/saving-and-privacy.md) — cells, keys, and account state.
8. [Troubleshooting and limits](manual/troubleshooting.md) — common failures and size limits.

## Read more

| Guide | What you will find |
| --- | --- |
| [User guide index](user-guide.md) | The reading order and links to all eight chapters. |
| [Tools reference](tools.md) | Import and declare tools; check the 51 functions, groups, and limits. |
| [Examples guide](examples.md) | Try task walkthroughs and downloadable teaching notebooks. |
| [FAQ](faq.md) | Run All and cell toggles, correcting answers, kernel loss, restarts, cancellation, and other edge cases. |
| [Architecture](architecture.md) | How the browser, Jupyter Server, notebook kernel, and model provider work together; saved data and tool schemas. |
| [Development](development.md) | Set up with uv, build the extension, run the tests, and maintain these docs. |

## New in version 0.1.13

- Use a ChatGPT subscription for inline questions through a connection owned by the Jupyter server. Sign in through a browser or device code, inspect account models and usage, then choose **Use for this notebook**. No separate Codex installation or API key is needed for this connection.
- ChatGPT and API billing stay separate. Saved notebook choices remain explicit when a connection or model becomes unavailable; there is no automatic switch to an API provider.
- The notebook owns submitted context, declared tools, Keep answers, execution order, and cancellation. Built-in ChatGPT file, shell, and browser actions are off; enabled notebook tools keep their normal Python permissions.

## Added in version 0.1.12

- The 51 optional tools keep the eight task groups and 19-tool starter note. Source and saved-notebook search now use bounded Python matching with nested ignore rules; Markdown and Python outlines have copied addresses that expire after any file change.
- Four 0.1.11 syntax search/rewrite tools are deferred. The 0.1.11 native search and document dependencies are replaced with `pathspec` and `markdown-it-py`.

## Added in version 0.1.11

- Search saved project files and notebooks, inspect static Python source documentation, navigate document sections, and make checked text edits.
- Find and edit ordinary cells in the live notebook by stable ID, including unsaved and offscreen cells. Edits do not execute or save them automatically.
- Extract a public web-page section, inspect live values or skill descriptions, trace a live function, and run bounded shell or Python subprocesses with kernel-user permissions.
- Try the [disposable project notebook](https://github.com/rahuldave/nbinlineai/blob/main/examples/project-tools.ipynb).

## Added in version 0.1.10

- Questions and answers have distinct backgrounds that adapt to light and dark themes.
- Empty questions offer editable starters. Shared instructions and cell-position landmarks help focus explanations on the requested cell while retaining useful earlier context.
- Offer `insert_code` to let the AI add an ordinary, unexecuted code cell below its answer. The question and answer remain intact.
- Try the [Jupyter AI + nbinlineai example](https://github.com/rahuldave/nbinlineai/blob/main/examples/jupyter-ai-and-nbinlineai.ipynb), and read the [FAQ](faq.md) for tool-registration, insertion, prompt starters, and coexistence details.

## Added in version 0.1.9

The Context toolbar now shows just the notebook mode and **Details**, with one disclosure arrow. Question-specific information and the optional **Check context** action are inside Details. A check shows progress, then cell/tool counts and a completion time, or a visible failure reason. Running an AI question always calculates context automatically.

Each cell's Context/Tools controls now sit above its content, aligned with the text. AI question controls move above the question too, and the current question is plainly labeled as always included.

## Added in version 0.1.8

Version 0.1.8 adds selectable notebook context.

- Choose Default, Full notebook, All above, 10 above, 10 above + below, Custom or Current question only, with separate text/tool checkboxes and an authoritative first-round preview.
- Save Custom choices while keeping inherited tools independent of selected text. Try the [context-selection example](https://github.com/rahuldave/nbinlineai/blob/main/examples/context-selection.ipynb).

## In version 0.1.7

- Declare tools once in ordinary Markdown or an AI question; later AI questions inherit them, even when the declaration text no longer fits in context.
- Keep the nearest preceding notes, code, and complete AI exchanges within a shared character budget, after accounting for tools and the current question.
- See when context was trimmed, and try the updated examples with shared declarations and real function calls.

## Notebook conversations

- Set provider, model, style, and effort once per notebook, with optional cell overrides.
- Edit the built-in **Compact**, **Full**, and **Learning** instructions in Configure AI.
- Choose **Keep AI answers** once per notebook, with optional cell overrides. Turn it off during active development and pin answers you want to preserve.
- Run code and AI cells in order with JupyterLab's normal **Run All Cells** command. Manually corrected answers become context for later prompts when they run.

ChatGPT subscription use has account limits and may use additional credits. OpenAI and Anthropic API requests are billed separately by those providers.

[Install from PyPI](https://pypi.org/project/nbinlineai/) · [Source on GitHub](https://github.com/rahuldave/nbinlineai) · [Report an issue](https://github.com/rahuldave/nbinlineai/issues)

Licensed under GPL-3.0-only, matching ai-jup.

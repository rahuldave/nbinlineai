---
title: nbinlineai
---

# AI conversations inside your notebook

**nbinlineai** adds AI prompt cells to JupyterLab. Ask about the code and notes above a cell, refer to live Python values, and let a model call functions you explicitly name. Prompts and answers stay in the notebook as readable Markdown.

## Start here

1. Install **nbinlineai** from JupyterLab's Extension Manager, then restart the whole Jupyter server.
2. Open a Python notebook and use **Configure AI** to save your OpenAI or Anthropic API key.
3. Choose your notebook's model and style in **AI defaults**.
4. Click **+ AI Prompt**, write a question, and press **Shift+Enter**.

For a uv project:

```bash
uv add jupyterlab nbinlineai
uv run jupyter lab
```

![Notebook defaults, an AI prompt, and its saved answer](images/overview.png)

## Read more

| Guide | What you will find |
| --- | --- |
| [User guide](user-guide.md) | Illustrated setup, notebook defaults, styles, thinking effort, editing and rerunning, context, variables, tools, and troubleshooting. |
| [Tools reference](tools.md) | Import and declare tools; check the 55 functions, groups, and limits. |
| [Examples guide](examples.md) | Try task walkthroughs and downloadable teaching notebooks. |
| [FAQ](faq.md) | Run All and cell toggles, correcting answers, kernel loss, restarts, cancellation, and other edge cases. |
| [Architecture](architecture.md) | How the browser, Jupyter Server, notebook kernel, and model provider work together; saved data and tool schemas. |
| [Development](development.md) | Set up with uv, build the extension, run the tests, and maintain these docs. |

## New in version 0.1.11

- Choose from 55 optional tools, organized into task groups. The default starter note stays at 19; `tool_catalog()` lists the groups without offering functions.
- Search saved project files and notebooks, inspect Python syntax and source documentation, navigate document sections, and make checked text edits.
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

This version supports OpenAI and Anthropic API keys. API usage is billed by the provider; ChatGPT subscription sign-in is not included.

[Install from PyPI](https://pypi.org/project/nbinlineai/) · [Source on GitHub](https://github.com/rahuldave/nbinlineai) · [Report an issue](https://github.com/rahuldave/nbinlineai/issues)

Licensed under GPL-3.0-only, matching ai-jup.

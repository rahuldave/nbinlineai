# nbinlineai user manual

This guide describes nbinlineai 0.1.1. It explains everyday use, what is saved in your notebook, and exactly what the AI can see.

## 1. Install and set up

You need JupyterLab 4, Python 3.11 or newer, and an OpenAI or Anthropic **API key**.

1. Open JupyterLab's **Extension Manager**, search for **nbinlineai**, and install it.
2. Save your notebooks and **stop and restart the whole Jupyter server**. Refreshing the browser or restarting a notebook kernel is insufficient.
3. Open a Python notebook. Click **Configure AI** at the far right of the notebook toolbar, beside the kernel name.
4. Paste your key into its provider's password field and click **Save**. The provider should show **Saved on this computer**.

For a project managed by uv, install and launch with:

```bash
uv add jupyterlab nbinlineai
uv run jupyter lab
```

Install the extension in the environment running JupyterLab. Installing it only in a different notebook kernel's environment will not load its server component.

API usage is billed by your provider. ChatGPT subscription sign-in is not supported in this version.

## 2. Create and run an AI cell

1. Select the cell after which you want to ask a question.
2. Click **+ AI Prompt** in the notebook toolbar.
3. Write your prompt, for example: `Explain the code above and suggest a simpler approach.`
4. Choose a provider and model.
5. Press **Shift+Enter** or click **Run AI**.

The answer streams into a separate Markdown cell, normally created immediately below the prompt. Ordinary code cells keep their usual execution behavior.

An active Python kernel is required. nbinlineai does not automatically run the code above your prompt; run the definitions yourself before referring to live values or functions.

### Provider and model choices

- A provider without a configured key is marked **API key required** and cannot be selected.
- If only one provider is configured, a new prompt uses that provider automatically.
- Choose a listed model, **Default**, or **Custom model…** to enter another model ID.
- Bundled defaults are `gpt-6-sol` for OpenAI and `claude-sonnet-5` for Anthropic. A default you set in JupyterLab's nbinlineai settings takes precedence.
- Listed models are suggestions, not a live account-access check. Your API account must have access to the chosen model.
- Choosing a model or running a prompt saves its effective provider in the cell. An existing saved provider/model is not silently replaced when you add or remove a key.
- Changing providers clears that cell's previous model choice. Existing cells whose provider loses its key show setup guidance and cannot run until you add the key or select an available provider.

## 3. Edit, rerun, and save

**Prompts are editable.** Select the prompt cell and edit its text. If it is displayed as rendered Markdown, double-click it to enter the editor. Press **Shift+Enter** or **Run AI** to run the revised prompt.

**A rerun updates the paired answer.** It clears the previous answer as the new run starts, then writes the new response into that same answer cell. It does not append another answer each time. To keep an old answer for comparison, copy its text into an ordinary Markdown cell before rerunning.

Each run uses the notebook's current preceding code, available earlier AI conversations, selected model, and current kernel state. It is a new API request and can produce a different result. Editing an earlier cell does not automatically rerun later AI cells. If you change an earlier AI prompt, rerun it before continuing below so its saved answer matches its revised question.

Click **Cancel** to stop an active response. Cancelling does not undo function calls that have already changed your notebook state. A partial answer may remain; cancelled and failed answers are not used as completed conversation history.

Save the notebook normally to keep the prompt and answer text. Reopening it restores the cells and their saved choices. Python variables and functions are kernel state: after restarting the kernel, rerun the code that defines them.

## 4. What context does the AI receive?

nbinlineai takes a snapshot at the moment you run a prompt. It uses notebook order, not execution order.

| Information | Included? |
| --- | --- |
| The current prompt text | Yes. |
| Code cell source above the prompt | Yes, within size limits. This can include unexecuted or edited code. |
| Earlier AI prompts and their completed, paired answers | Yes, when both are above the current prompt, within the history limit. |
| Ordinary Markdown notes or raw cells above the prompt | No, currently. Paste relevant notes into your prompt if needed. |
| Printed output, tracebacks, tables, plots, or images from code cells | No, currently. Include relevant text explicitly or refer to a prepared variable. |
| Cell source below the prompt | No. |
| Every variable in memory | No. Explicit `$` references retrieve selected values. |
| Files in the project folder | No automatic file reading. |

For example:

```text
Code A
AI prompt 1
AI answer 1
Code B
AI prompt 2   <- receives Code A, Code B, and the completed prompt 1 / answer 1 pair
Code C        <- its source is not included
```

**Live kernel state is a separate source of information.** A referenced variable or function can have been created by a cell below the prompt, by a cell run out of order, or by code that has since been edited or deleted. The “above the prompt” boundary applies to notebook source and conversation history; it does not restrict where live Python values originally came from.

There is no separate persistent chat history: earlier conversation is reconstructed from the notebook cells on each run. Keep prompts and their answers together. Moving cells changes the context available on the next run.

## 5. Reference live variables and functions

Run this ordinary Python cell first:

```python
score = 7

def add_bonus(value: int) -> int:
    """Return the score plus a bonus."""
    return score + value
```

Then put this in an AI Prompt cell:

```text
What is $`score`? Call &`add_bonus` with value 3, then explain the result.
```

| Syntax | Meaning |
| --- | --- |
| ``$`score` `` | Read the live value of `score` from the notebook's Python kernel and include its text representation in this request. |
| ``&`add_bonus` `` | Make `add_bonus` available as a function tool for this request. |

References must be simple Python names, not expressions such as `df.head()` or `obj.attribute`. Assign an expression to a named variable first if you want to reference its result.

Only functions explicitly named with `&` in the current prompt are exposed as tools. The extension reads their signatures and docstrings, describes them to the model, checks returned arguments, and calls them in the same notebook kernel. These are real function calls and can change variables or perform other actions implemented by your function. A reference permits a call; it does not guarantee that the model will choose to make one.

Use normal synchronous Python functions with named parameters, simple type annotations, and a helpful docstring. Async functions and signatures using positional-only parameters, `*args`, or `**kwargs` are not supported. Function output sent back to the model combines captured standard output and the return value's text representation.

If a live value seems wrong, run its defining cell again. Reading code source does not execute it or synchronize it with the kernel.

## 6. How cells are stored

Both kinds of AI cell are **standard Markdown cells inside the `.ipynb` file**:

| Cell | Saved text | nbinlineai metadata |
| --- | --- | --- |
| Prompt | Your editable question in the cell's `source` | `isPromptCell`, and provider/model choices when set |
| Answer | The generated Markdown in the cell's `source` | `isOutputCell`, `promptCellId`, and run status |

The fields live under `metadata.nbinlineai`. The answer's `promptCellId` links it to the prompt's notebook cell ID. This lets a rerun find and update its existing answer. If you delete the answer cell, the next run creates one again.

An AI answer is **not** an entry in a code cell's `outputs` array. Consequently, Jupyter's normal code-output clearing does not remove its Markdown text. Delete the answer cell to remove it; delete the prompt separately if you want to remove the whole exchange.

Someone opening the saved notebook without nbinlineai can still read the Markdown prompts and answers. The extension supplies their AI controls and execution behavior. API keys are not stored in the notebook. Tool-call arguments and results are used during the request; nbinlineai does not save a separate structured tool transcript in notebook metadata.

## 7. Where keys are stored

**Configure AI** saves keys in a private per-user JSON file on the computer running Jupyter Server:

- macOS/Linux: `~/.config/nbinlineai/credentials.json` by default.
- An absolute `XDG_CONFIG_HOME` changes that to `$XDG_CONFIG_HOME/nbinlineai/credentials.json`.
- Windows: the user's AppData configuration location, unless overridden by an absolute `XDG_CONFIG_HOME`.

The storage folder is created automatically. Different project environments running under the same OS user share these saved keys. Removing a saved key affects those environments too. The file is protected by file permissions, not encrypted; notebook code running as the same OS user can read that user's files.

A saved key takes precedence over a server environment key. Removing it can therefore reveal an environment-provided key rather than making that provider unavailable. A `.env` file is optional for development, not required for normal student setup.

## 8. How it works underneath

```text
JupyterLab interface
    | prompt + preceding cell snapshot
    v
nbinlineai extension inside Jupyter Server
    |-- FastLLM --> OpenAI or Anthropic API
    |-- kernel connection --> your separate Python kernel
    |
    +-- streamed text/events --> paired Markdown answer in JupyterLab
```

The TypeScript frontend creates the controls, reads the notebook model, and updates the answer cell. The Python server extension builds the model context, reads credentials, and manages provider requests and function-tool rounds. FastLLM adapts those requests to the providers. Live variable inspection and function execution happen in the notebook's existing Python kernel, which is a separate process.

The AI networking runs asynchronously in Jupyter Server and streams results back over HTTP. There is no extra AI daemon, nested notebook event loop, or Codex process required for this API-based version. There is also no new notebook cell type or cell magic: AI behavior is attached to Markdown cells through their metadata.

## 9. Troubleshooting and limits

| Symptom | What to do |
| --- | --- |
| **Configure AI** or **+ AI Prompt** is missing | Open a notebook, confirm installation in the server environment, restart the whole server, and refresh the page. |
| Server endpoint unavailable / 404 | Try **Retry** in Configure AI. If you just installed or updated, restart the whole server; browser reload alone may leave the server component unloaded. |
| Provider unavailable / Run disabled | Save that provider's key, or select one already configured. |
| Name is not defined | Run the Python cell defining the referenced variable or function in this notebook's kernel. |
| AI misses your notes or a plot | Ordinary Markdown notes and code outputs are not currently included; add relevant text to the prompt. |
| Old answer disappeared after rerunning | Reruns replace the paired answer. Copy text into an ordinary Markdown cell beforehand to preserve another version. |
| Model unavailable / key rejected / quota reached | Check the selected provider and model, then the key and account's API access or quota. |

Current size limits are deliberately bounded:

| Item | Limit and behavior |
| --- | --- |
| Preceding cells | More than 200 preceding cells rejects the request; this count includes all cell types. |
| Code source | Up to 50,000 source characters, collected from the top downward; excess code is omitted. |
| Conversation history | Up to 16,000 characters across complete prompt/answer pairs, starting with the newest pair and stopping when the next pair does not fit. |
| Current prompt | Up to 16,000 characters before live-value substitution. |
| Live references | Up to 20 distinct variable/function names per prompt. |
| Variable representation | Up to 2,000 characters per value. |
| Function result | Up to 4,000 characters per tool result. |
| Tool rounds | Default 5; configurable from 0 to 10 in nbinlineai's JupyterLab settings. |

This version supports text prompts and Python kernels. It does not automatically include rich outputs or images, execute generated code, or provide ChatGPT subscription sign-in.

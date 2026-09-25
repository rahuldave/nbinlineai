---
title: Saved notebooks and privacy
---

# Saved notebooks and privacy

[Manual](../user-guide.md) · [Previous: Live values and tools](variables-and-tools.md) · [Next: Troubleshooting and limits](troubleshooting.md)

## How cells are stored

Both kinds of AI cell are **standard Markdown cells inside the `.ipynb` file**:

| Cell | Saved text | nbinlineai metadata |
| --- | --- | --- |
| Prompt | Your editable question in the cell's `source` | `isPromptCell`, optional Keep answer override, and any provider/model/style/effort overrides |
| Answer | The generated Markdown in the cell's `source` | `isOutputCell`, `promptCellId`, and run status |

The fields live under `metadata.nbinlineai`. The answer's `promptCellId` links it to the prompt's notebook cell ID. This lets a rerun find and update its existing answer. If you delete the answer cell, the next run creates one again.

Notebook-level choices, including Keep AI answers, live under the notebook's `metadata.nbinlineai.defaults`, separately from cell metadata. An absent cell Keep answer choice inherits the notebook default. The preferred connection for notebooks without saved choices and custom style instructions live in JupyterLab user settings. API keys live in a private server-side credential file; ChatGPT sign-in is managed by its runtime. None of those credentials or instructions is stored in the notebook.

An AI answer is **not** an entry in a code cell's `outputs` array. Consequently, Jupyter's normal code-output clearing does not remove its Markdown text. Delete the answer cell to remove it; delete the prompt separately if you want to remove the whole exchange.

Someone opening the saved notebook without nbinlineai can still read the Markdown prompts and answers. The extension supplies their AI controls and execution behavior. API keys and ChatGPT credentials are not stored in the notebook. Tool-call arguments and results are used during the request; nbinlineai does not save a separate structured tool transcript in notebook metadata.

## Where keys are stored

**Configure AI** saves keys in a private per-user JSON file on the computer running Jupyter Server:

- macOS/Linux: `~/.config/nbinlineai/credentials.json` by default.
- An absolute `XDG_CONFIG_HOME` changes that to `$XDG_CONFIG_HOME/nbinlineai/credentials.json`.
- Windows: the user's AppData configuration location, unless overridden by an absolute `XDG_CONFIG_HOME`.

The storage folder is created automatically. Different project environments running under the same OS user share these saved keys. Removing a saved key affects those environments too. The file is protected by file permissions, not encrypted; notebook code running as the same OS user can read that user's files.

A saved key takes precedence over a server environment key. Removing it can therefore reveal an environment-provided key rather than making that provider unavailable. A `.env` file is optional for development, not required for normal student setup.

ChatGPT sign-in is separate from this key store. The account runtime owns its login and refresh state; nbinlineai does not copy its tokens into notebooks or API-key files. Choosing **Disconnect** detaches this Jupyter server and does not clear sign-in in another app or project.

## How it works underneath

```text
JupyterLab interface
    | prompt + preceding cell snapshot
    v
nbinlineai extension inside Jupyter Server
    |-- FastLLM --> OpenAI or Anthropic API
    |-- owned ChatGPT runtime --> ChatGPT account allowance
    |-- kernel connection --> your separate Python kernel
    |
    +-- streamed text/events --> paired Markdown answer in JupyterLab
```

The TypeScript frontend creates the controls, reads the notebook model, and updates the answer cell. The Python server extension builds the model context and manages requests and notebook-tool rounds. FastLLM adapts API requests; the ChatGPT runtime uses its account connection. The host chooses the notebook text and declared tools in each submitted request, then validates and executes returned tool groups. The runtime may make internal inference or recovery requests within one host round; those are outside the 64,000-character submitted-request estimate. Live variable inspection and ordinary function execution happen in the notebook's existing Python kernel, which is a separate process. Built-in live notebook tools use an authenticated request/reply interface between the server and the original notebook panel; they do not block the Python kernel while waiting for the browser.

The AI networking runs asynchronously in Jupyter Server and streams results back over HTTP. API model requests go through FastLLM; ChatGPT model requests use a private native runtime supplied by the installed Python dependency, with no separate student installation. Neither mode nests a notebook event loop. There is no new notebook cell type or cell magic: AI behavior is attached to Markdown cells through their metadata.

For the request lifecycle, tool schemas, module map, and event-loop details, see [Architecture](../architecture.md).

[Manual](../user-guide.md) · [Previous: Live values and tools](variables-and-tools.md) · [Next: Troubleshooting and limits](troubleshooting.md)

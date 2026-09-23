# nbinlineai

Write AI prompts directly in JupyterLab notebooks. Each prompt has its own OpenAI or Anthropic model choice, and its answer appears in a paired markdown cell below it. Prompts and answers stay in the notebook when you save and reopen it.

## Quick start

You need Python 3.11 or newer and JupyterLab 4.

1. **Install:** open **Extension Manager** (the puzzle icon), search for **nbinlineai**, and click **Install**. **Restart the Jupyter server**; refreshing the browser alone is insufficient.
2. **Set up a key:** open a Python notebook, click **Configure AI** in its toolbar, and save an OpenAI or Anthropic API key. You can configure either provider or both.
3. **Create an AI cell:** select a cell and click **+ AI Prompt** in the toolbar. Write a question, such as "Explain the code above."
4. **Run it:** choose a provider and model, then press **Shift+Enter** or click **Run AI**. **Default** uses the configured default model shown in the picker. The answer appears in a paired Markdown cell below the prompt.

| To… | Do this |
| --- | --- |
| Ask about earlier code | Write an ordinary question. The AI sees code above the prompt and earlier AI turns. |
| Read a live Python value | Include a reference such as ``$`score` ``. Run the cell defining the variable first. |
| Let the AI call a Python function | Include a reference such as ``&`add_bonus` ``. Run its definition first; only explicitly named functions are exposed. |
| Revise an answer | Edit the prompt and run it again; its existing answer is updated. |
| Stop a response | Click **Cancel**. Calls already performed cannot be undone. |
| Keep the conversation | Save the notebook; prompts and answers are saved with it. |

Ordinary code cells keep their normal execution behavior. See the runnable example below for variable and function references.

## Choose a model

Each AI cell has a **Model** dropdown. Choose a listed model, use **Default**, or choose **Custom model…** and enter another model ID supported by that provider. Your choice is saved with the cell; changing providers clears the previous provider's model choice.

Providers without a configured API key are marked unavailable. If you have only an Anthropic key, new AI cells select Anthropic automatically (and likewise for OpenAI). Existing cells keep their saved provider and model; if that provider's key is missing, add it through **Configure AI** or switch to a configured provider before running the cell.

| Provider | Bundled default | Other listed choices |
| --- | --- | --- |
| OpenAI | `gpt-6-sol` | `gpt-6-luna`, `gpt-6-astra` |
| Anthropic | `claude-sonnet-5` | `claude-haiku-4-5-20251001`, `claude-opus-5-5`, `claude-fable-5-1` |

These are bundled suggestions, not a live list of your account's model access. The IDs were checked against the [OpenAI model catalog](https://developers.openai.com/api/docs/models) and [Anthropic model catalog](https://platform.claude.com/docs/en/models/overview) for version 0.1.1. Existing cells keep any explicitly selected model; select **Default** to use the current default. A provider default set in JupyterLab's nbinlineai settings takes precedence over the bundled default.

## Installation and API keys

Keys are saved in your user configuration, outside notebooks. On macOS and Linux the default is `~/.config/nbinlineai/credentials.json`; Windows uses its user configuration directory. An absolute `XDG_CONFIG_HOME` changes the location when set. No `.env` file is needed.

Your school or hosted Jupyter service may manage extensions centrally. If Extension Manager is unavailable, ask the administrator to install the package in the Python environment running Jupyter Server and restart that server. For a self-managed environment using `pip`, the equivalent command is:

```bash
python -m pip install nbinlineai
```

If you launch JupyterLab from a project managed by `uv`, add the extension as a project dependency so future `uv sync` runs keep it installed:

```bash
uv add jupyterlab nbinlineai
uv run jupyter lab
```

Some `uv` environments omit `pip`, which the JupyterLab Extension Manager may need for its Install button. In that case, use `uv add` as above, or add `pip` to the environment before using the panel.

If **Configure AI** reports that its server endpoint is unavailable (404), click **Retry**. If you just installed or updated the extension and the error persists, save your notebooks, stop the whole Jupyter server, start it again with your usual command, and refresh the browser. Restarting only a notebook kernel is insufficient. The extension must be installed in the environment running the server. The key storage folder is created automatically; you do not need to create it yourself.

API provider usage is billed by the provider separately from JupyterLab. You can replace or remove a saved key through **Configure AI**. A server administrator can also provide `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the Jupyter server environment; a key you save in the UI takes precedence for that provider.

Saved keys are shared by JupyterLab environments under the same operating-system account. A Python kernel running as that account can read that account's files, including its saved keys; use a separate OS account for notebooks you do not trust.

## Example: variables and tools

In a Python notebook, run this code cell:

```python
score = 7

def add_bonus(value: int) -> int:
    """Return the score plus a bonus."""
    return score + value
```

Insert an AI Prompt cell below it and ask:

```text
What is $`score`? Call &`add_bonus` with value 3, then explain the result.
```

The source distribution also includes `examples/quickstart.ipynb` with these cells.

`$` followed by a backtick-quoted Python name uses its **live value from the running kernel**. This can differ from what the notebook source currently says. To let the model call a function you defined in the kernel, name it with `&`, for example ``Call &`add_bonus` with value 3``. Only functions named in that prompt are made available as tools. This release supports ordinary synchronous Python functions with named parameters and simple annotations. Function calls can change notebook state; cancelling a prompt cannot undo an earlier call.

The model sees bounded code source from cells **above** the prompt and earlier AI turns. It does not see later cells. Only AI Prompt cells use the new Shift+Enter behavior; ordinary code cells run normally. Re-running a prompt updates its paired answer cell instead of adding another one.

This release supports text prompts and Python kernels. It does not send notebook images or rich outputs as model context, and it does not offer ChatGPT subscription sign-in.

## Develop from source

This section is for contributors. Installing the published package does not require Node.js or a source checkout. Development requires Python 3.11+, Node.js 22.12+ (or 20.19+), `uv`, and JupyterLab 4.

```bash
uv sync --python 3.12 --group dev --no-install-project
uv run --no-sync jlpm install
uv run --no-sync jlpm build:prod
uv sync --python 3.12 --group dev
uv run --no-sync jupyter-builder develop . --overwrite
uv run jupyter lab
```

The backend reads provider keys saved by **Configure AI**. For a developer-only environment, it can also read `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` from the server environment or a project-root `.env` file. Never put keys in a notebook.

Run tests and packaging checks:

```bash
uv run --no-sync pytest
uv run --no-sync jlpm test:unit
uv run --no-sync jlpm build:prod
uv run --no-sync jupyter-builder develop . --overwrite
uv run --no-sync jlpm test:e2e
uv build
```

The browser suite starts its own JupyterLab on `127.0.0.1:8897`, uses a real Python kernel from the project environment, and replaces only the model provider with a deterministic test implementation. It refuses port 8888, disables port retries, and keeps notebooks, Jupyter settings, and saved fake keys in temporary directories. Use `NBINLINEAI_E2E_PORT=8899` to select another free port. Install Chromium once if Playwright asks: `uv run --no-sync jlpm playwright install chromium`.

An optional live smoke sends one small prompt to each configured API provider and verifies variable lookup plus a function call:

```bash
NBINLINEAI_E2E_LIVE=1 uv run --no-sync jlpm test:e2e
```

A tool round can make multiple provider API calls within one prompt. These live requests incur provider usage.

## License

GPL-3.0-only. The full license text is included in the package.

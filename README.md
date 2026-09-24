# nbinlineai

Write AI prompts directly in JupyterLab notebooks. Connect a ChatGPT subscription or use an OpenAI or Anthropic API key, then choose a model for the notebook and override it in individual prompts when needed. Each answer appears in a paired Markdown cell below its prompt. Prompts, answers, and notebook defaults stay in the notebook when you save and reopen it.

## User manual

The full [user manual](https://rahuldave.github.io/nbinlineai/user-guide.html) covers setup, editing and rerunning cells, context boundaries, live variables and tools, saved notebook data, and troubleshooting. It is included in the source archive and installed under `share/doc/nbinlineai/docs/user-guide.md` in the Python environment. The [FAQ](https://rahuldave.github.io/nbinlineai/faq.html) covers Run All, cell toggles, corrections, kernel loss, and other edge cases. The [documentation site](https://rahuldave.github.io/nbinlineai/) also includes architecture and contributor guides. The quick start below is self-contained.

## Quick start

You need Python 3.12 or newer and JupyterLab 4.2 or newer.

1. **Install:** open **Extension Manager** (the puzzle icon), search for **nbinlineai**, and click **Install**. **Restart the Jupyter server**; refreshing the browser alone is insufficient.
2. **Configure AI:** open a Python notebook, click **Configure AI**, and either sign in with ChatGPT or save an OpenAI or Anthropic API key. ChatGPT needs no separately installed Codex app or command.
3. **Create an AI cell:** select a cell and click **+ AI Prompt** in the toolbar. Write a question, or choose an editable starter such as **Explain code above**.
4. **Set notebook defaults:** use the **AI defaults** row at the top of the notebook to choose provider, model, response style, and thinking effort. Compact and Model default effort are the starting choices.
5. **Run it:** press **Shift+Enter** or click **Run AI**. The answer appears in a paired Markdown cell below the prompt. Use the cell's **Override** control only when it needs different settings.

![Notebook AI defaults and a prompt with its answer](https://raw.githubusercontent.com/rahuldave/nbinlineai/main/docs/images/overview.png)

Questions have a blue tint and answers a green tint in light and dark themes. Empty questions offer a few starters; choosing one inserts editable text without running it.

| To… | Do this |
| --- | --- |
| Ask about earlier code or notes | Write an ordinary question. Default uses nearby earlier source and completed AI turns; Context modes and checkboxes choose other cells. |
| Read a live Python value | Include a reference such as ``$`score` ``. Run the cell defining the variable first. |
| Let the AI call a Python function | Include a reference such as ``&`add_bonus` ``. Run its definition first; only explicitly named functions are exposed. |
| Correct an answer yourself | Double-click its Markdown text below the Context control and edit it. Later AI prompts read the corrected text when they run. |
| Ask for a revised answer | Edit the prompt, turn off **Keep answer**, and run it again; its existing answer is replaced. |
| Work through a saved notebook | Leave the notebook's **Keep AI answers** on. Completed answers are preserved without another API call. |
| Develop a notebook with fresh answers | Turn notebook **Keep AI answers** off. Pin any answer you are happy with using that cell's **Keep answer**. |
| Run the whole notebook | Use JupyterLab's **Run All Cells**. Code and eligible AI prompts finish in order; each prompt respects its Keep answer choice. |
| Learn through questions | Choose **Learning** in the notebook defaults. Answer each tutor question in a new AI Prompt cell below its response. |
| Use suggested code | Click the copy icon on a code block in an AI answer, then paste into a code cell. |
| Ask for a new code cell | Import and register `insert_code`, then ask the AI to insert code below its answer. The new code is editable and unexecuted. See the [insertion FAQ](https://rahuldave.github.io/nbinlineai/faq.html#how-do-i-ask-for-a-new-code-cell-while-keeping-the-ai-answer). |
| Stop a response | Click **Cancel**. Calls already performed cannot be undone. |
| Keep the conversation | Save the notebook; prompts and answers are saved with it. |

Ordinary code cells keep their normal execution behavior. See the runnable example below for variable and function references.

**Keep AI answers** is on by default for the notebook. Cells inherit it unless you explicitly change their **Keep answer** checkbox; the cell's reset control restores inheritance. A new prompt can still run once, and failed, cancelled, empty, or deleted answers can be retried. Keep protects completed answers; it does not disable all provider requests.

Editing an earlier answer changes the history available to later prompts, but does not regenerate their existing answers. Rerun affected prompts with Keep answer off. Pin a manually corrected answer to preserve it when running the notebook again. See the [rerun and Run All edge cases](https://rahuldave.github.io/nbinlineai/user-guide.html#3-edit-rerun-and-save), including kernel restarts and tool side effects. Native Run All support starts in 0.1.5; earlier releases rendered AI Markdown without calling the provider.

## Choose a response style

Choose a style in the notebook's **AI defaults** row:

| Style | How the AI responds |
| --- | --- |
| **Compact** (default) | Very succinct answers, with code when useful. |
| **Full** | Detailed explanations and code when useful. |
| **Learning** | A Socratic tutor: focused questions, hints, and feedback on your attempts. It is instructed to avoid complete solutions and use at most 3 lines of code per response, only when needed as a hint. It may suggest documentation to read. |

Notebook defaults are saved with the `.ipynb`. Cells inherit them unless you choose an **Override**; returning a cell to notebook defaults clears its overrides. Reruns use the current effective settings. A run already in progress keeps the choices it started with.

In **Configure AI**, expand the style instructions to edit Compact, Full, or Learning. Each editor starts with our bundled instructions. **Save** stores your custom wording in JupyterLab user settings; **Reset** restores the bundled instructions. Your custom wording applies when that style is selected. It is separate from the notebook's saved style choice.

In **Learning**, start with a question such as “Help me understand why this loop skips an item.” When the tutor asks a question, insert another AI Prompt cell **below its answer**, write your reply, and run it. Earlier exchanges provide the conversation history. Repeat as you work through the problem. To replace an earlier exchange, turn off Keep answer and rerun that prompt.

In **Compact** and **Full**, the AI is instructed to put code in fenced Markdown blocks. Code blocks in AI answers have a **Copy code** button: click it, create or select an ordinary code cell, and paste. Copying does not execute code. If the browser blocks clipboard access, select and copy the code manually. These styles guide the model; Learning is not an enforced assessment restriction.

## Cells and context at a glance

- **Storage:** AI prompts and their paired answers are separate standard Markdown cells, identified by `metadata.nbinlineai`. Both texts are saved in the `.ipynb`; an answer is not a code-cell output.
- **Editing and rerunning:** edit questions or answers directly. Rerunning a prompt replaces its paired answer, including manual edits. Each run reads the current notebook and kernel state. Later AI cells do not rerun automatically when earlier content changes.
- **Context (0.1.8):** choose Default, Full notebook, All above, 10 above, 10 above + below, Custom, or Current question only. Per-cell checkboxes choose notebook text; the backend preview identifies included, partial and omitted cells. Every mode uses the shared character budget. Separate Tools checkboxes enable declaration cells; enabled tools remain available even when their text is unchecked. Raw cells, code outputs and image data are omitted.
- **Live values:** explicit variable/function references use the running kernel, including values created by code executed out of order or below the prompt. The source-code boundary and live kernel state are separate.
- **Architecture:** the JupyterLab interface talks to a Python extension inside Jupyter Server. API providers use FastLLM; ChatGPT uses an owned native runtime. The extension reads variables and calls declared functions through the notebook's separate Python kernel.

The Context toolbar shows the notebook mode and **Details**. Click an AI question to inspect its context; **Details → Check context** optionally shows counts and a check time without asking the AI. Each cell's Context and Tools choices appear above that cell's content, aligned with its text. Running a question always calculates context automatically.

## Choose a model

The notebook's **AI defaults** row has a model dropdown. Choose a listed model or **Default**. For an API connection, **Custom model…** accepts another model ID supported by that API provider. ChatGPT offers only runtime-supported models available to your account; an unavailable saved ID remains visible but cannot run. Most notebooks can use one model throughout. Individual AI cells expose their own choices under **Override**. Changing providers clears the previous provider's model choice.

API providers without a configured key are marked unavailable. If you have only an Anthropic key, a notebook without saved AI defaults starts with Anthropic (and likewise for OpenAI). ChatGPT is selected deliberately with **Use for this notebook** or a saved notebook/cell choice; it is never substituted for an API provider, and a disconnected ChatGPT choice never falls back to API billing. Saved provider/model choices remain visible when unavailable. Cells created by older versions keep their saved choices until you return them to notebook defaults.

| Provider | Bundled default | Other listed choices |
| --- | --- | --- |
| OpenAI | `gpt-6-sol` | `gpt-6-luna`, `gpt-6-astra` |
| Anthropic | `claude-sonnet-5` | `claude-haiku-4-5-20251001`, `claude-opus-5-5`, `claude-fable-5-1` |
| ChatGPT subscription | From your connected account | Models and reasoning effort come from the connection; unavailable saved choices stay selected. |

The API rows are bundled suggestions, not a live list of account model access. Their IDs were checked against the [OpenAI model catalog](https://developers.openai.com/api/docs/models) and [Anthropic model catalog](https://platform.claude.com/docs/en/models/overview) for version 0.1.1. ChatGPT lists runtime-supported models available to your connected account and their efforts. Existing cells keep any explicitly selected model; select **Default** to use the current default. A provider default set in JupyterLab's nbinlineai settings takes precedence over the bundled default.

### Thinking effort

The effort selector starts at **Model default** and offers the levels supported by the selected model. For example, GPT-6 Sol supports None, Low, Medium, High, Extra high, and Max; Claude Sonnet 5 supports Low through Max. Effort affects the model's reasoning and can increase latency and token usage. It is independent of style: **Compact + High** can produce a carefully reasoned short answer. See the [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-sol) and [Claude effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort).

Unknown custom model IDs and models without this effort control use Model default. nbinlineai does not guess unsupported API parameters. A cell can override effort through the same **Override** control.

## Installation and connections

In **Configure AI**, choose **ChatGPT subscription**, then **Sign in with ChatGPT**. If browser sign-in cannot reach the server, choose **Use device code**. After the connection reports an available model, choose its effort and click **Use for this notebook**. Opening the dialog, checking status, or signing in does not change the notebook. ChatGPT uses your account allowance, which has limits; additional credits may apply. API requests are billed separately, and switching between them is always explicit. **Disconnect** stops this Jupyter server's connection without signing you out of other apps or projects.

For direct ChatGPT operations, **ChatGPT file access** currently shows **Notebook tools only**: built-in file, shell, and browser actions are off. Enabled notebook tools still run in Python with its normal user permissions. The displayed notebook folder supplies location context; it does not change the Python kernel's working directory or confine its tools.

API keys are saved in your user configuration, outside notebooks. On macOS and Linux the default is `~/.config/nbinlineai/credentials.json`; Windows uses its user configuration directory. An absolute `XDG_CONFIG_HOME` changes the location when set. ChatGPT credentials are managed by the runtime, never copied into this key file or notebook metadata. No `.env` file is needed.

![Simulated connected ChatGPT setup with model, effort, usage, and Use for this notebook](https://raw.githubusercontent.com/rahuldave/nbinlineai/main/docs/images/configure-ai.png)

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

The [example notebooks](https://github.com/rahuldave/nbinlineai/tree/main/examples) teach live variables, tools, and step-by-step learning conversations. Copies are included in the package under `share/doc/nbinlineai/examples/`.

`$` followed by a backtick-quoted Python name in the current question uses its **live value from the running kernel**. This can differ from what the notebook source currently says. To offer a function, name it with `&`, for example ``Call &`add_bonus` with value 3``. From **0.1.7**, tool references in ordinary Markdown and AI questions above also carry forward: declare a tool once, then use it in later AI questions without repeating the reference. AI answers do not register tools. This release supports ordinary synchronous Python functions with named parameters and simple annotations. Function calls can change notebook state; cancelling a prompt cannot undo an earlier call.

### Bundled tools

Version **0.1.13** offers 51 optional tools. Import the functions you need and declare them in an ordinary Markdown cell above the AI question. The default `tools_markdown()` note contains the 19-tool **starter** group; `tool_catalog()` lists all groups and names without declaring them.

```python
from nbinlineai.tools import search_files, source_doc, tool_catalog, tools_markdown

print(tool_catalog("code"))
print(tools_markdown(["search_files", "source_doc"]))
```

Paste the printed references into a Markdown cell and delete any unwanted lines. `insert_tools(["search_files", "source_doc"])` can request that note directly below its calling code cell. Each eligible AI question below inherits enabled declarations. Up to 20 distinct tool and variable names may appear in one request. The [tools reference](https://rahuldave.com/nbinlineai/tools.html) lists all exact signatures; the [examples guide](https://rahuldave.com/nbinlineai/examples.html) includes a disposable project notebook.

Tools can inspect live Python objects, search saved source files and notebooks, read or edit the current unsaved notebook by stable cell ID, extract public web-page sections, make checked text-file edits, and run bounded subprocesses. Saved-file paths resolve on the selected **kernel machine** from its current working directory, which may differ from the notebook folder. Source-file documentation uses static parsing; an explicit live-module inspection import runs module initialization. Live notebook edits never execute code or save the notebook automatically. Subprocess tools have real kernel-user permissions and no sandbox. Keep answer prevents a completed prompt from repeating its tool actions.

By default, the model sees bounded earlier code, ordinary Markdown and completed AI pairs. Wider Context modes can include cells below as clearly labeled source. Custom choices save with the notebook; the current question and all its linked answers are always excluded from optional context. Only AI Prompt cells use the new Shift+Enter behavior; ordinary code cells run normally. Re-running a prompt updates its paired answer cell instead of adding another one.

This release supports text prompts and Python kernels. It does not send notebook images or rich outputs as model context. The host builds at most 64,000 characters for each submitted question or notebook-tool round; the ChatGPT runtime can make internal recovery requests within a round. **Maximum tool steps** counts returned groups of declared notebook-tool calls, which the host validates and executes; internal model requests do not consume that setting.

## Develop from source

This section is for contributors. Installing the published package does not require Node.js or a source checkout. Development requires Python 3.12+, Node.js 22.12+ (or 20.19+), `uv`, and JupyterLab 4.2 or newer.

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

A notebook-tool round may contain several calls to declared tools. Live API tests incur provider usage; ChatGPT has separate account limits. The deterministic browser tests do not contact either provider.

## License

GPL-3.0-only. The full license text is included in the package.

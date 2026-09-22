# nbinlineai

AI prompt cells for JupyterLab 4 notebooks. A prompt cell is a markdown cell with durable `nbinlineai` metadata. Run it with **Shift+Enter** or **Run AI**; the answer appears in a paired markdown cell directly below it. Re-running the prompt updates that answer cell.

## What the MVP does

- Sends source from code cells **above the prompt** and earlier AI prompt/answer turns as context. Code below the prompt is excluded. Notebook source can be unexecuted or different from the live kernel state.
- Substitutes `` $`name` `` references using a bounded text representation from the current Python kernel namespace. For example, ``What is $`total`?`` sends the live value of `total`.
- Registers a callable Python function named with `` &`name` `` as a model tool. The model can call it in the current notebook kernel; the answer includes the tool result. This MVP supports ordinary named synchronous functions with simple parameter annotations. Cancellation stops the request but may not undo a tool's earlier side effect.
- Lets each prompt choose OpenAI API or Anthropic API and an optional model. Blank model uses the configured provider default, then the server default. A running prompt can be cancelled.
- Keeps provider and model choices, prompt/answer pairing, and conversation content in notebook cell metadata and source so they survive saving and reopening.

This version supports text prompts and Python kernels. ChatGPT subscription sign-in and multimodal notebook outputs are planned separately; see [the design notes](internal_docs/fastllm_and_chatgpt_subscription.md).

## Install and configure

Requirements: Python 3.11+, Node.js 22.12+ (or 20.19+), `uv`, and a JupyterLab 4 environment.

```bash
uv sync --python 3.12 --group dev
uv run --no-sync jlpm install
uv run --no-sync jlpm build:prod
uv sync --python 3.12 --group dev
uv run --no-sync jupyter-builder develop . --overwrite
uv run jupyter lab
```

Set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` in the Jupyter server's environment. For local development, put them in a project-root `.env` file; the server reads it without returning credentials to the browser. The model defaults are `gpt-5.4-mini` for OpenAI and `claude-haiku-4-5-20251001` for Anthropic. A provider without a configured key is unavailable when a prompt runs.

Open a Python notebook, select the cell whose context should precede the prompt, and click **AI Prompt** in the notebook toolbar. The same action is available as **Insert AI Prompt Cell** in the command palette. Write a prompt, choose a provider, and run it. Ordinary code cells continue to use the notebook's normal execution shortcuts.

## Development and tests

The Python suite covers request validation, bounded context, live namespace lookup, and tool dispatch. The browser suite uses a separate JupyterLab server and a **real Python kernel**, with a deterministic model replacement loaded only by the test server process. It creates temporary notebooks and never uses API keys or the user's JupyterLab session.

```bash
uv run --no-sync pytest
uv run --no-sync jlpm test:unit
uv run --no-sync jlpm build:prod
uv run --no-sync jupyter-builder develop . --overwrite
uv run --no-sync jlpm test:e2e
```

Browser tests use `127.0.0.1:8897` by default, refuse port 8888, and disable port retries. Choose another free port with `NBINLINEAI_E2E_PORT=8899 uv run --no-sync jlpm test:e2e`. The test runner starts and stops its own server and stores notebooks in temporary storage. Install Chromium once if Playwright requests it: `uv run --no-sync jlpm playwright install chromium`.

To make one small **live** request to each configured provider, using the project `.env` and the same isolated JupyterLab and real Python kernel:

```bash
NBINLINEAI_E2E_LIVE=1 uv run --no-sync jlpm test:e2e
```

The live smoke tests skip providers without a configured key. Each sends one prompt that includes a live variable and asks the model to call a function, then checks the kernel mutation. A tool round can make multiple API calls within that prompt. Unlike the deterministic suite, these requests incur provider usage.

To build distributions and check extension discovery:

```bash
uv run --no-sync jlpm build:prod
uv build
uv run jupyter labextension list
uv run jupyter server extension list
```

## License

GPL-3.0. See [LICENSE](LICENSE).

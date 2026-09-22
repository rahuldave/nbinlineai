# nbinlineai

A JupyterLab 4 extension project for AI prompt cells. This repository is at the extension-foundation stage: it installs a JupyterLab frontend and a Jupyter Server extension, adds a command and toolbar button to insert metadata-backed AI prompt cells, and contains the tool-schema bridge for a later `fastllm` runtime. Prompt execution and ChatGPT sign-in are not wired up yet. See the design notes in [`internal_docs`](internal_docs).

The API backends will use FastLLM. ChatGPT subscription mode will use the official Codex App Server as a separate process; the architecture, installation and event-loop plan are in [the FastLLM and subscription design](internal_docs/fastllm_and_chatgpt_subscription.md).

## Development with uv

Prerequisites: Python 3.11+, Node.js 18+, `uv`, and `jlpm` (provided by JupyterLab).

```bash
uv sync --python 3.12 --no-install-project
jlpm install
uv sync
uv run jupyter lab
```

Open a notebook and choose **Insert AI Prompt Cell** from the command palette, or use the **AI Prompt** toolbar button. The inserted cell is an ordinary markdown cell marked by `metadata.nbinlineai.isPromptCell`.

To build the installable wheel and source distribution:

```bash
jlpm build:prod
uv build
```

To verify both Jupyter extension entry points:

```bash
uv run jupyter labextension list
uv run jupyter server extension list
```

## Optional Codex CLI for subscription mode

The future ChatGPT subscription backend requires the Codex CLI executable on the Jupyter Server host. It is separate from the `uv` environment. Install it using [OpenAI's Codex CLI instructions](https://github.com/openai/codex#quickstart), then check `codex --version` and `codex app-server --help`. The backend will launch `codex app-server` over local stdin/stdout and let Codex manage browser or device-code sign-in. This mode is not yet implemented.

## License

GPL-3.0, matching [`ai-jup`](https://github.com/AnswerDotAI/ai-jup). See [LICENSE](LICENSE). This repository's implementation is independent; `ai-jup` and `fastllm` are referenced for interoperability research.

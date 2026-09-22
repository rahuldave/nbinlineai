# API prompt-cell MVP implementation and verification

The JupyterLab extension stores AI prompts and their paired markdown answers in notebook cells with `metadata.nbinlineai`. The frontend selects preceding cells, sends one authenticated prompt request to the Jupyter Server, reads streamed SSE events, and renders the answer in the paired cell. A rerun updates that cell. Only AI prompt cells intercept Shift+Enter; ordinary code cells continue through JupyterLab.

The server resolves the notebook session to its Python kernel. It presents bounded code source above the prompt and earlier AI turns to FastLLM, substitutes `$` references from the live kernel namespace, and exposes only explicitly named `&` functions as tools. Tool calls are checked against the run's allowlist and executed in that same kernel with JSON arguments. OpenAI and Anthropic API keys remain server-side. The browser receives provider availability and model defaults, not credential values. A cancelled run can stop subsequent work but cannot reverse a function side effect already performed.

## Verification on 2026-09-22

- Python backend suite: 27 passing focused tests, including authorization, context and tool validation, SSE, kernel execution, and cancellation.
- Frontend unit suite: 4 passing tests; TypeScript production build passes.
- Deterministic browser suite: 5/5 passing against a separate JupyterLab on port 8897 with a real Python kernel from this repository's `.venv`. The test server alone substitutes a deterministic provider. It covers Shift+Enter, visible rendered answer, context boundary, live variable after source edit, function side effect, provider choice, ordinary code execution, save/reload metadata, rerun pairing, error, and cancel.
- Live provider smoke: one OpenAI API prompt and one Anthropic API prompt each passed independently. Each referenced a live variable, called a function tool, and proved the kernel value changed from 6 to 7. The first combined test run reached OpenAI but its second notebook raced kernel attachment before any Anthropic request; the harness now waits for a notebook session, and Anthropic then passed in an isolated rerun. No credentials were printed.

The user's existing JupyterLab on port 8888 was not used. The test runner refuses that port, disables port retries, and uses temporary notebook, config, runtime, data, and kernelspec directories.

## Current scope

The MVP handles text prompts and bounded text tool results in Python notebooks. It does not send rich outputs or images as context and does not implement ChatGPT subscription sign-in. The subscription architecture remains in [the FastLLM and ChatGPT design](fastllm_and_chatgpt_subscription.md).

# API prompt-cell MVP implementation and verification

The JupyterLab extension stores AI prompts and their paired markdown answers in notebook cells with `metadata.nbinlineai`. The frontend selects preceding cells, sends one authenticated prompt request to the Jupyter Server, reads streamed SSE events, and renders the answer in the paired cell. A rerun updates that cell. Only AI prompt cells intercept Shift+Enter; ordinary code cells continue through JupyterLab.

The server resolves the notebook session to its Python kernel. It presents bounded code and ordinary Markdown source above the prompt, plus earlier completed AI turns, to FastLLM in notebook order. It substitutes `$` references from the live kernel namespace and exposes only explicitly named `&` functions as tools. Tool calls are checked against the run's allowlist and executed in that same kernel with JSON arguments. OpenAI and Anthropic API keys stay outside notebooks: users can save them through Configure AI in an XDG-compatible per-user file, or set server environment variables. The browser receives provider availability, key source, and model defaults, never credential values. A cancelled run can stop subsequent work but cannot reverse a function side effect already performed.

## Verification on 2026-09-22

- Python backend suite: 34 passing focused tests, including authorization, credential storage and redaction, context and tool validation, SSE, kernel execution, and cancellation.
- Frontend unit suite: 4 passing tests; TypeScript production build passes.
- Deterministic browser suite: 6/6 passing against a separate JupyterLab on port 8897 with a real Python kernel from this repository's `.venv`. The test server alone substitutes a deterministic provider. It covers Shift+Enter, visible rendered answer, context boundary, live variable after source edit, function side effect, provider choice, ordinary code execution, save/reload metadata, rerun pairing, error, cancel, and Configure AI save/replace/remove/reopen with fake keys and no notebook or response leakage.
- Live provider smoke: one OpenAI API prompt and one Anthropic API prompt each passed independently. Each referenced a live variable, called a function tool, and proved the kernel value changed from 6 to 7. The first combined test run reached OpenAI but its second notebook raced kernel attachment before any Anthropic request; the harness now waits for a notebook session, and Anthropic then passed in an isolated rerun. No credentials were printed.

The user's existing JupyterLab on port 8888 was not used. The test runner refuses that port, disables port retries, and uses temporary notebook, Jupyter config, XDG key storage, runtime, data, and kernelspec directories.

## Version 0.1.1 verification before release

- Python backend suite: 38 passing tests; frontend unit suite: 11 passing tests; production frontend build passes.
- Deterministic browser suite: 10/10 passing against a separate JupyterLab on port 8897. The new cases verify the model picker against both providers' model lists, default and custom model selection, custom ID persistence after reopening, and model IDs sent with requests. They verify that a sole Anthropic key makes new prompts select Anthropic, while unavailable providers cannot be run; an explicit Anthropic model remains pinned if an OpenAI key is later added. Removing a key after a completed run replaces stale Done with key guidance. They also verify that a temporary settings 404 disables key saving until Retry succeeds, that a successful key POST remains reported as saved and enables Run even if a later status GET returns 404, and that an HTML prompt 404 is replaced with readable guidance rather than notebook HTML.
- Direct provider API smoke: the new defaults `gpt-6-sol` and `claude-sonnet-5` each completed a two-call function-tool cycle. These calls did not involve the Jupyter browser suite. No further live provider calls were made during 0.1.1 browser verification.

The 0.1.0 Extension Manager install was discoverable and installed correctly, but its package metadata did not declare the companion server extension for JupyterLab's installation guidance. Version 0.1.1 adds that discovery metadata and checks it in both release archives. This confirms a missing restart hint in the installation path; it does not establish the exact cause of the user's earlier intermittent key-save 404.

## Version 0.1.2 verification before release

The server now includes ordinary Markdown above an AI prompt together with code source, in notebook order under one 50,000-character source budget. It excludes ordinary Markdown below the prompt, raw cells, and AI prompt/answer cells from source context. Only completed AI pairs enter conversation history, once. Backend tests cover the source and history boundaries; all 41 Python tests pass.

The 0.1.2 frontend production build passes. Two focused browser tests passed against an isolated JupyterLab on port 8897 with a real Python kernel and deterministic fake provider: the existing prompt/answer rerun and saved-pair smoke, plus a new Markdown test. The fake provider echoed the server-assembled message, proving that earlier Markdown appeared before later code and that Markdown below the prompt was absent from the answer. No live provider request was made.

## Current scope

The MVP handles text prompts and bounded text tool results in Python notebooks. It does not send rich outputs or images as context and does not implement ChatGPT subscription sign-in. The subscription architecture remains in [the FastLLM and ChatGPT design](fastllm_and_chatgpt_subscription.md).

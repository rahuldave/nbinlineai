---
title: Development
---

# Development

Students can install the prebuilt package without this setup. Contributors need Python 3.12+, Node.js 22.12+ (or 20.19+), uv, and JupyterLab 4.2 or newer.

## Install the ongoing experimental branch in a JupyterLab project

Notebook-agent execution experiments live on the long-running
[`codex/agentic-notebook-experiments` branch](https://github.com/rahuldave/nbinlineai/tree/codex/agentic-notebook-experiments).
From the directory of the **uv project that starts your Jupyter server**, run:

```bash
uv add git+https://github.com/rahuldave/nbinlineai.git --branch codex/agentic-notebook-experiments
uv run jupyter labextension list
uv run jupyter server extension list
uv run jupyter lab
```

If the directory has no `pyproject.toml`, create a uv project there first with
`uv init`. The `uv add` command also replaces a prior PyPI `nbinlineai`
dependency in that project with the Git source. It installs JupyterLab as a
dependency of nbinlineai. Run JupyterLab through the same uv project so that
its server sees both the Python and frontend extensions. If a Jupyter server
is already running, restart that server after installation; refreshing the
browser or restarting only a notebook kernel will not load the new server
extension.

This Git install builds the Python package and its prebuilt JupyterLab
frontend **from source**. Have Node.js 22.12+ (or 20.19+) available for the
frontend build. It does not require `jupyter labextension install`, which is
the source-extension route, and it does not select the published PyPI package.

`uv.lock` pins the exact Git commit it installed. After new commits are pushed
to the branch, update that one dependency in your JupyterLab project with:

```bash
uv lock --upgrade-package nbinlineai
uv sync
```

Then restart your Jupyter server. Commit the consuming project's
`pyproject.toml` and `uv.lock` if you want to reproduce its chosen branch
commit. Branch installs remain experimental and are separate from releases
published on PyPI.

## Set up from source

```bash
git clone https://github.com/rahuldave/nbinlineai.git
cd nbinlineai
uv sync --python 3.12 --group dev --no-install-project
uv run --no-sync jlpm install
uv run --no-sync jlpm build:prod
uv sync --python 3.12 --group dev
uv run --no-sync jupyter-builder develop . --overwrite
uv run jupyter lab
```

Use Configure AI to save a key or connect a ChatGPT account, or supply `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the server environment. A project-root `.env` file is supported for API development. Never commit credentials or place them in notebook cells.

## Tests

```bash
uv run --no-sync pytest
uv run --no-sync jlpm test:unit
uv run --no-sync jlpm build:prod
uv run --no-sync jupyter-builder develop . --overwrite
uv run --no-sync jlpm test:e2e
```

| Layer | What it checks |
| --- | --- |
| Python | Authentication, credentials, context selection and preview/run parity, inherited declarations and opt-outs, nearest-first character accounting, tool execution, provider payloads, insertion receipts, styles, effort, and cancellation. |
| Frontend unit tests | Context windows and saved choices, defaults and overrides, Keep answer, code-copy behavior, live model actions, context reports, insertion request validation, and asynchronous event ordering. |
| Browser tests | A real JupyterLab interface and Python kernel: all Context modes, accessible text/tool choices, stale previews, shared tool declarations, direct helper insertion and Run All ordering, settings, saving/reopening, live-cell actions, styles, and rerun protection. |

The default browser suite substitutes a deterministic API provider, so it does not incur API charges. It starts its own JupyterLab on `127.0.0.1:8897`, uses temporary notebooks/configuration/fake keys, refuses port 8888, and disables automatic port retries. Set `NBINLINEAI_E2E_PORT` to use another free port. Install Chromium if requested:

```bash
uv run --no-sync jlpm playwright install chromium
```

The subscription UI has stateful browser tests that intercept only the account routes. To exercise the real Jupyter Server, notebook kernel, declared tools, Run All, Keep and cancellation through a deterministic offline ChatGPT manager, run the focused suite separately after rebuilding and relinking:

```bash
NBINLINEAI_E2E_SUBSCRIPTION=1 uv run --no-sync jlpm exec playwright test tests/e2e/subscription-run.spec.ts
```

That fixture uses no personal sign-in, provider key, or network model call. Run this after the default suite has stopped its isolated server; do not run two builds or browser servers against the same assets at once.

An optional live check sends a small tool-using prompt to each configured provider and incurs API usage:

```bash
NBINLINEAI_E2E_LIVE=1 uv run --no-sync jlpm test:e2e
```

## Build a distribution

```bash
uv build
uvx twine check --strict dist/*
uv run --no-sync python scripts/check_release_artifacts.py dist
```

Use an output directory containing exactly one version's wheel and source archive for the archive checker. The build can rebuild frontend assets; do not run it alongside browser tests. Archives include the prebuilt frontend, server-extension registration, license, and illustrated documentation.

## Maintain the documentation

The site source is the repository's `docs/` folder. GitHub Pages publishes `main:/docs` using Jekyll and the Minimal theme, with a white documentation layout and small local style overrides. No separate documentation release command is needed: push a documentation change to `main`, then check the **Pages build and deployment** run on GitHub.

- Write pages in Markdown with a title in YAML front matter.
- Keep links to other pages relative, such as `user-guide.md` from a root page or `../faq.md` from a manual chapter; Jekyll's relative-links plugin adapts them for the website.
- Keep the short `docs/user-guide.md` index and the eight `docs/manual/` chapters in reading order. Link each chapter from the site homepage, and keep the chapter's Manual, Previous, and Next links current. When moving a section, update cross-links and the legacy fragment redirect map in the index.
- Keep screenshots in `docs/images/` and reference them as `images/filename.png` from root documentation pages or `../images/filename.png` from nested manual chapters.
- The README uses absolute GitHub image URLs so its images also render on PyPI. Keep it to at most two screenshots.
- Use the isolated demonstration setup for screenshots. Do not capture personal notebooks, API keys, or login tokens.

After a frontend build and relink, refresh the core notebook screenshots with `uv run --no-sync jlpm exec node tests/support/capture_docs.mjs`. Refresh the simulated connected ChatGPT dialog separately with `NBINLINEAI_CAPTURE_DOCS=1 uv run --no-sync jlpm playwright test tests/e2e/subscription-setup.spec.ts --grep 'capture the simulated connected ChatGPT setup'`. Run these sequentially: each owns an isolated server on port 8897 and refuses an occupied port. The core helper leaves `configure-ai.png` to the dedicated ChatGPT capture.

The same Markdown and image files are installed under `share/doc/nbinlineai/docs/` in the Python environment for offline use. Example notebooks and their data fixture are installed under `share/doc/nbinlineai/examples/`; keep their relative layout intact. Internal release records and future design notes remain in `internal_docs/` and are excluded from published package archives and the documentation site.

See [GitHub's publishing-source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the hosting configuration, and [Architecture](architecture.md) for the source map.

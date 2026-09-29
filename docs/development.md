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
`uv init`. The `uv add` command also replaces an earlier `nbinlineai`
dependency in that project with the Git source. It installs JupyterLab as a
dependency of nbinlineai. Run JupyterLab through the same uv project so that
its server sees both the Python and frontend extensions. If a Jupyter server
is already running, restart that server after installation; refreshing the
browser or restarting only a notebook kernel will not load the new server
extension.

This Git install builds the Python package and its prebuilt JupyterLab
frontend **from source**. Have Node.js 22.12+ (or 20.19+) available for the
frontend build. It does not require `jupyter labextension install`, which is
the source-extension route.

`uv.lock` pins the exact Git commit it installed. After new commits are pushed
to the branch, update that one dependency in your JupyterLab project with:

```bash
uv lock --upgrade-package nbinlineai
uv sync
```

Then restart your Jupyter server. Commit the consuming project's
`pyproject.toml` and `uv.lock` if you want to reproduce its chosen branch
commit. `jupyter labextension list` shows the package version; `uv.lock`
identifies the exact Git commit used by this project.

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

Browser media checks have a separate, opt-in configuration. After rebuilding and
relinking the frontend, install the pinned Playwright engines into a dedicated
cache and run each engine separately. Each command starts and stops its own
isolated server on port 8897; wait for one command to finish before starting the
next. The regular browser suite and CI still use Chromium only.

```bash
export PLAYWRIGHT_BROWSERS_PATH="${XDG_CACHE_HOME:-$HOME/.cache}/nbinlineai-media-playwright"
uv run --no-sync jlpm exec playwright install chromium firefox webkit
uv run --no-sync jlpm exec playwright test --config=playwright.media.config.ts --project=chromium
uv run --no-sync jlpm exec playwright test --config=playwright.media.config.ts --project=firefox
uv run --no-sync jlpm exec playwright test --config=playwright.media.config.ts --project=webkit
```

This focused configuration selects `browser-media-*.spec.ts` tests. Synthetic
media fixtures can check browser/server/kernel integration, PNG capture and
transfer, and operation receipts without provider calls or physical devices.
They do not verify camera, microphone, screen-sharing, recording hardware or OS
permission prompts. Playwright WebKit is not a real Safari or iOS/iPadOS run;
those device and mobile checks remain separate.

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

The site source is the repository's `docs/` folder. Quarto **1.8.26** renders its Markdown into `docs/_site/` using [`docs/_quarto.yml`](_quarto.yml), then renders the original top-level `examples/*.ipynb` directly to HTML under `docs/_site/notebooks/`. Only the HTML output is generated. To check a change locally:

```bash
quarto render docs
python3 scripts/render_example_notebooks.py
python3 scripts/check_docs_site.py docs/_site
quarto preview docs
```

The notebook filter in `scripts/quarto_notebook_filter.py` reads each original notebook during rendering, adds its page title and description from notebook text, and styles Markdown cells marked as AI prompts or responses by `metadata.nbinlineai`. The filter runs in memory; it never creates or changes `.ipynb` files. The render script passes `--no-execute`, so it displays saved outputs and answers without making new model calls or running code. [Notebook examples](examples.md) links to these HTML pages. The `examples/data/` notebook is a support fixture, not a guide entry. For a new top-level notebook, add a clear first `#` heading and introductory paragraph, a link and short description in the guide, and a full `https://rahuldave.com/nbinlineai/notebooks/name.html` URL in public Markdown. Each HTML page links to its source notebook for download.

The checker verifies required core pages, every rendered HTML page's local links and anchors, one guide link and rendered page per top-level notebook, AI panel counts, and each public tool row against the maintained notebook coverage map. The `docs/.nojekyll` marker is copied into the rendered site so GitHub Pages serves Quarto's files directly. The **Documentation site** workflow builds on every PR and publishes the rendered site to GitHub Pages after a push to `main`; the repository's Pages source is **GitHub Actions**. Check that workflow's build and deployment jobs after merge, then inspect the live [Notebook examples](examples.md) and [Tool catalog](tools.md).

- Write pages in Markdown with a title in YAML front matter. Quote titles containing a colon so Quarto can parse them.
- Keep links to other pages relative, such as `user-guide.md` from a root page or `../faq.md` from a manual chapter; Quarto rewrites them to `.html` for the website.
- Keep the short `docs/user-guide.md` index and the eight `docs/manual/` chapters in reading order. Link each chapter from the site homepage, and keep the chapter's Manual, Previous, and Next links current. When moving a section, update cross-links and the legacy fragment redirect map in the index.
- Keep screenshots in `docs/images/` and reference them as `images/filename.png` from root documentation pages or `../images/filename.png` from nested manual chapters.
- The README uses absolute GitHub image URLs so its images also render on PyPI. Keep it to at most two screenshots.
- Use the isolated demonstration setup for screenshots. Do not capture personal notebooks, API keys, or login tokens.

After a frontend build and relink, refresh the core notebook screenshots with `uv run --no-sync jlpm exec node tests/support/capture_docs.mjs`. Refresh the simulated connected ChatGPT dialog separately with `NBINLINEAI_CAPTURE_DOCS=1 uv run --no-sync jlpm playwright test tests/e2e/subscription-setup.spec.ts --grep 'capture the simulated connected ChatGPT setup'`. Run these sequentially: each owns an isolated server on port 8897 and refuses an occupied port. The core helper leaves `configure-ai.png` to the dedicated ChatGPT capture.

The same Markdown and image files are installed under `share/doc/nbinlineai/docs/` in the Python environment for offline use. Example notebooks and their data fixture are installed under `share/doc/nbinlineai/examples/`; keep their relative layout intact. Internal release records and future design notes remain in `internal_docs/` and are excluded from published package archives and the documentation site.

See [GitHub's custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) for the hosting configuration, and [Architecture](architecture.md) for the source map.


## Branches and worktrees

Approved pre-work research, specifications and task prompts live on `main`.
Record the committed main revision used to read them, normally from the primary
checkout's `internal_docs/` (on the maintainer's machine,
`/Users/rahul/Projects/nbinlineai/internal_docs/`). If that checkout is dirty,
behind or unavailable, read the selected committed revision without changing
its working tree. Author pre-work updates in owned main-based topic worktrees
and PR them to `main`. Implementation handoffs and verification records travel
with the branch containing their code and its PR target; promote those records
to `main` with the implementation. Public docs, examples and code documentation
also follow their code so packaged instructions match the installed version.
The [documentation workflow](https://github.com/rahuldave/nbinlineai/blob/main/internal_docs/workflow.md#documentation-by-branch)
explains revision selection and cross-branch records.

Keep the primary checkout on `main`. Develop changes in separate topic
worktrees, using a temporary `codex/*` branch based on the intended integration
target. Stable fixes and release preparation start from `main` and return there
through reviewed pull requests.

`codex/agentic-notebook-experiments` is a persistent integration branch. Develop
individual changes on temporary `codex/*` topics created from it, then use
reviewed pull requests **back to that branch**. The same PR and CI discipline
applies to `main`. Promoting an experiment to `main` is a separate decision.

After integration, remove only the completed task's clean worktrees and verified
merged temporary branches. Preserve the primary checkout, the experimental
branch, and other tasks' worktrees. Record any unfinished or uncommitted work
before considering cleanup.
Keep the experimental branch after promotion so future work can continue there.

The project-local Gest skills and the repository's internal workflow notes
record issue scope, independent adversarial review, verification and cleanup.
`just lint`, `just typecheck`, `just test`, and `just browser` map existing
commands; `just browser` rebuilds and relinks first. CI additionally checks
built archives and fresh wheel installation. The source commit in `uv.lock`
identifies the installed snapshot even when the package version is unchanged.

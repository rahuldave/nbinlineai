---
title: Development
---

# Development

Students can install the prebuilt package without this setup. Contributors need Python 3.11+, Node.js 22.12+ (or 20.19+), uv, and JupyterLab 4.2 or newer.

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

Use Configure AI to save a key, or supply `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the server environment. A project-root `.env` file is supported for development. Never commit keys or place them in notebook cells.

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
| Python | Authentication, credential handling, bounded context, tool schemas and execution, provider payloads, style instructions, effort, and cancellation. |
| Frontend unit tests | Choice resolution, defaults and overrides, Keep answer, and code-copy behavior. |
| Browser tests | A real JupyterLab interface and Python kernel: prompt execution, settings, saving/reopening, tools, context, styles, and rerun protection. |

The default browser suite substitutes a deterministic provider, so it does not incur API charges. It starts its own JupyterLab on `127.0.0.1:8897`, uses temporary notebooks/configuration/fake keys, refuses port 8888, and disables automatic port retries. Set `NBINLINEAI_E2E_PORT` to use another free port. Install Chromium if requested:

```bash
uv run --no-sync jlpm playwright install chromium
```

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

The site source is the repository's `docs/` folder. GitHub Pages publishes `main:/docs` using Jekyll and the Cayman theme. No separate documentation release command is needed: push a documentation change to `main`, then check the **Pages build and deployment** run on GitHub.

- Write pages in Markdown with a title in YAML front matter.
- Keep links to other pages relative, such as `user-guide.md`; Jekyll's relative-links plugin adapts them for the website.
- Keep screenshots in `docs/images/` and reference them as `images/filename.png` from documentation pages.
- The README uses absolute GitHub image URLs so its images also render on PyPI. Keep it to at most two screenshots.
- Use the isolated demonstration setup for screenshots. Do not capture personal notebooks, API keys, or login tokens.

The same Markdown and image files are installed under `share/doc/nbinlineai/docs/` in the Python environment for offline use. Internal release records and future design notes remain in `internal_docs/` and are excluded from published package archives and the documentation site.

See [GitHub's publishing-source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the hosting configuration, and [Architecture](architecture.md) for the source map.

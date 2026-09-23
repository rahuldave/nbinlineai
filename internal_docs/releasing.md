# Releasing nbinlineai to PyPI

The first public release is `0.1.0`. The PyPI package is named `nbinlineai`. No public repository URL is set until a repository exists. The package README is written for students installing from JupyterLab or into their own `uv` project; developer and release details remain here.

## Before building

1. Confirm the version matches in `pyproject.toml`, `package.json`, and `nbinlineai/__init__.py`.
2. Run Python and frontend tests, then the isolated JupyterLab browser suite. The browser suite must not use port 8888 or user notebooks.
3. Build the final TypeScript bundle and source-linked extension:

```bash
uv run --no-sync pytest
uv run --no-sync jlpm test:unit
uv run --no-sync jlpm build:prod
uv run --no-sync jupyter-builder develop . --overwrite
uv run --no-sync jlpm test:e2e
```

The optional live provider smoke makes billable API calls and is not required for every release build. It has already verified the initial OpenAI and Anthropic paths.

## Build and inspect

```bash
rm -rf dist
uv build
uvx twine check dist/*
uv run --no-sync python scripts/check_release_artifacts.py dist
```

Inspect the wheel and source archive if any check fails. The source archive must contain the GPL license, Python and TypeScript source, build metadata, lockfiles, examples, and prebuilt labextension. It must exclude `.env`, credential files, virtual environments, dependencies, build caches, test artifacts, and private `internal_docs`. The wheel must include the frontend bundle, server extension configuration, and license. `uv build` may invoke the frontend build hook, so do not run it concurrently with browser tests.

For a fresh-install check, install the built wheel in a disposable Python environment with JupyterLab 4, then confirm `jupyter labextension list` and `jupyter server extension list` show `nbinlineai` enabled. Open the quickstart notebook in a separate JupyterLab server and verify **Configure AI** and **AI Prompt** appear.

## Publish

Publishing is done by a maintainer with PyPI credentials configured outside the repository. Do not put credentials in shell history, source files, notebook metadata, or release logs. Check that `https://pypi.org/project/nbinlineai/0.1.0/` is still available immediately before the initial upload; PyPI will not allow replacing an uploaded version.

```bash
uv publish dist/*
```

After upload, verify the PyPI project page, README rendering, package files, and a fresh `pip install nbinlineai` in an isolated environment. Confirm JupyterLab discovers both extension entry points. For later changes, increment the version before building; PyPI releases are immutable.

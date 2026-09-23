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

Publishing is done by a maintainer with PyPI credentials configured outside the repository. Do not put credentials in shell history, source files, notebook metadata, or release logs. Before each upload, check that the version does not already exist on PyPI; PyPI will not allow replacing an uploaded version.

```bash
uv publish dist/*
```

After upload, verify the PyPI project page, README rendering, package files, and a fresh `pip install nbinlineai` in an isolated environment. Confirm JupyterLab discovers both extension entry points. For later changes, increment the version before building; PyPI releases are immutable.

## Version 0.1.0 verification

Version `0.1.0` was published from source commit `89e63b3` and tagged `v0.1.0`. The published wheel SHA256 is `622a131bc8fbcfee4c7cbb9e2393c712123c9ae9120c932392b42d558042cfa7`; the source archive SHA256 is `375a95c36b528be3c17f8e4470bf7cc4befdfb0244514f4dcd04d7385a1de595`. Both hashes matched the public PyPI JSON metadata and the locally checked artifacts.

A clean JupyterLab 4.6.4 environment discovered `nbinlineai` through its PyPI Extension Manager search. Clicking **Install** in that panel installed version `0.1.0` into the clean environment. After restarting only that isolated JupyterLab server, the `nbinlineai` server extension loaded, `/nbinlineai/status` and `/nbinlineai/settings/keys` returned HTTP 200, and a new notebook displayed **AI Prompt** and **Configure AI** in its toolbar. No provider key was entered and no paid provider request was made for this install check. The temporary server was stopped after verification.

## Version 0.1.1 preparation

The 0.1.0 Extension Manager panel showed only frontend reload guidance after installation. Its `package.json` lacked `jupyterlab.discovery.server`, which JupyterLab uses to recognize that the pip package also provides a server extension. Version 0.1.1 declares that companion server package, and `scripts/check_release_artifacts.py` checks the metadata in both source and wheel manifests. The user's intermittent key-save 404 has not been traced to one definitive cause; the UI now handles settings and prompt 404 responses with recovery guidance and keeps successful key saves visible even if a later status request fails.

Before the 0.1.1 build, 38 backend tests, 11 frontend unit tests, and 10 isolated browser tests passed. The browser suite included real Python kernels and fake provider responses, tested both model lists and custom IDs, sole-provider availability, recovery from settings 404, and confirmed HTML 404 pages do not enter notebooks. Direct live provider checks of the new `gpt-6-sol` and `claude-sonnet-5` defaults completed one function-tool round each. The published 0.1.1 archives and Extension Manager upgrade remain to be verified after upload.

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

## Version 0.1.1 verification

The 0.1.0 Extension Manager panel showed only frontend reload guidance after installation. Its `package.json` lacked `jupyterlab.discovery.server`, which JupyterLab uses to recognize that the pip package also provides a server extension. Version 0.1.1 declares that companion server package, and `scripts/check_release_artifacts.py` checks the metadata in both source and wheel manifests. The user's intermittent key-save 404 has not been traced to one definitive cause; the UI now handles settings and prompt 404 responses with recovery guidance and keeps successful key saves visible even if a later status request fails.

Before the 0.1.1 build, 38 backend tests, 11 frontend unit tests, and 10 isolated browser tests passed. The browser suite included real Python kernels and fake provider responses, tested both model lists and custom IDs, sole-provider availability, recovery from settings 404, and confirmed HTML 404 pages do not enter notebooks. Direct live provider checks of the new `gpt-6-sol` and `claude-sonnet-5` defaults completed one function-tool round each.

Version `0.1.1` was published from source commit `fd067f2` and tagged `v0.1.1`. The published wheel SHA256 is `be3bf824a5e7e293ee7e0b23497550c52bd8e32a3a60327dd64a940bd2b2f0a2`; the source archive SHA256 is `a355d22480bd5f3b067134d27d58de637248a51f8ac5755b7d8be5619f394b43`. Both matched the checked local artifacts and public PyPI metadata.

In a separate JupyterLab 4.6.4 environment, the Extension Manager offered **Update to 0.1.1** for its existing 0.1.0 install. The first actual update response was HTTP 201 with `needs_restart` containing both `frontend` and `server`; JupyterLab displayed a restart dialog and the installed card showed 0.1.1. After stopping and restarting only that disposable server, `/nbinlineai/status` returned HTTP 200 with version 0.1.1 and the new model lists. A fresh notebook showed **AI Prompt**, **Configure AI**, the model dropdown, and no-key guidance with Run disabled. The key endpoint returned HTTP 200 with both providers unconfigured. No real key or paid API request was used. The disposable server was stopped after verification.

## Version 0.1.2 preparation

Version `0.1.2` adds ordinary Markdown above an AI prompt to the bounded notebook source context. The backend suite passed 41 tests, including context ordering and AI history boundaries. The production frontend build passed, and two focused browser tests passed on isolated port 8897: the existing prompt/answer save and rerun flow, plus a fake-provider response that proved earlier Markdown and later code reached the assembled model message in order while Markdown below the prompt did not. No paid provider call was made. The version is synchronized in Python, JavaScript, and `uv.lock`; publication and archive verification remain with the maintainer.

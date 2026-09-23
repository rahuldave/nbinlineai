# Releasing nbinlineai to PyPI

The first public release is `0.1.0`. The PyPI package is named `nbinlineai`, and its public repository is [rahuldave/nbinlineai](https://github.com/rahuldave/nbinlineai). The package README is written for students installing from JupyterLab or into their own `uv` project; developer and release details remain here.

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

## Version 0.1.2 verification

Version `0.1.2` adds ordinary Markdown above an AI prompt to the bounded notebook source context. The backend suite passed 41 tests, including context ordering and AI history boundaries. The production frontend build passed, and two focused browser tests passed on isolated port 8897: the existing prompt/answer save and rerun flow, plus a fake-provider response that proved earlier Markdown and later code reached the assembled model message in order while Markdown below the prompt did not. No paid provider call was made. The version is synchronized in Python, JavaScript, and `uv.lock`.

Version `0.1.2` was published from source commit `db1e098` and tagged `v0.1.2`. The published wheel SHA256 is `0b2a3ba4778472096ffeef9baea9eaee0587b945b4975e6513d464813e163ec0`; the source archive SHA256 is `bea87f8f3e0ccbbb6a2677bce991c1cb6baf77ff4c44ff06bea0c03b01b150bf`. Both matched the checked local artifacts and public PyPI metadata. Strict Twine metadata validation, archive content checks, and credential content scans passed. Both archives include `USER_GUIDE.md`; the wheel installs it under `share/doc/nbinlineai/USER_GUIDE.md`. The existing server discovery metadata is preserved. The isolated browser server was stopped, and the user's port 8888 server was left untouched.

## Version 0.1.3 verification

Version `0.1.3` is synchronized in Python, JavaScript, and `uv.lock`. It adds Compact, Full, and Learning response styles saved through JupyterLab settings and sent on every AI run or rerun. Rendered fenced code answers gain Copy code without changing saved notebook Markdown. An unconfirmed style save keeps the last confirmed mode until Retry reconciles the setting.

Before packaging, 50 backend tests and Ruff passed. Fourteen frontend unit tests and the production build passed. The isolated browser run passed 13 of 14 tests; the remaining test needed to enter edit mode after JupyterLab rendered a Markdown cell on reload, and its focused rerun passed. All 14 distinct browser checks therefore passed, and a focused copy-code rerun also passed. No paid provider calls were made. The port 8897 test server was stopped; the user's port 8888 server was not used.

Version `0.1.3` was published from source commit `855d4e9` and tagged `v0.1.3`. The published wheel SHA256 is `9c93ff7476b2976b128da688871fa2258bf322916f45b6049c0291328fc9bc45`; the source archive SHA256 is `c966f01b41a2b01adb6a6d73da3e2ab15723cb2e8c935cfb0c51340aa66542bb`. Both matched the checked local artifacts and public PyPI metadata. Strict Twine metadata validation, archive content checks, and credential content scans passed. The updated user guide is included in both archives. Root reviewed screenshots of Configure AI and the copy control; code remained readable beneath the control.

## Version 0.1.4 verification

Version `0.1.4` is synchronized in Python, JavaScript, and `uv.lock`. Notebook-wide defaults are saved in notebook metadata; a prompt cell inherits them unless its Override controls specify provider, model, style, or effort. The first AI insert snapshots effective defaults while an ordinary notebook open leaves AI metadata untouched. Keep answer defaults on and blocks completed-answer reruns until unchecked. Configure AI permits editing and resetting bundled style instructions, and a failed settings confirmation keeps the previous confirmed instructions until Retry. The model catalog exposes supported reasoning effort choices; an explicit cell Model default omits the request effort even when the notebook specifies High.

Before packaging, 60 backend tests and Ruff passed, 21 frontend unit tests passed, and the production frontend build passed. The full isolated browser run passed 18 of 21 tests. Three checks still used old UI labels or expected the Override panel to remain open after reload; their corrected focused reruns all passed, so 21 distinct browser checks are green. A focused geometry assertion also passed after fixing the clipped notebook defaults header. Nine illustrative documentation screenshots were captured under `docs/images/` against the isolated server and deterministic fake provider; no real key or paid provider call was used. The port 8897 server was stopped, and the user's port 8888 server was not touched. Strict Twine validation, archive content checks, screenshot packaging checks, and credential-content scans passed before publication.


Version `0.1.4` was published from source commit `33b124b` and tagged `v0.1.4`. The wheel SHA256 is `e07d928e6c5fab184a552ea12f8ac7927c77f7d5d0693ead7c6c152757fe039a`; the source archive SHA256 is `e32d88d62683f44d1036445acf12637457793d24d70e883cbd7af2a1aa83edbd`. Both match the public PyPI project JSON's `releases["0.1.4"]` entries and the local artifacts. The simple index lists 0.1.4. Immediately after upload the version-specific JSON route still returned a cached 404 while project metadata already showed the release; verification therefore used the public project release map.

The guide moved to `docs/user-guide.md`. Both archives include the documentation pages and all nine guide screenshots; the wheel installs them under `share/doc/nbinlineai/docs/`. The README contains two HTTPS image links, both verified publicly. Root visually reviewed the final images, including the corrected defaults header, normal kernel label, and key-dialog framing.

GitHub Pages is configured to build `main:/docs` using native Jekyll and Cayman. The first deployment (run `35812355263`) passed. The live site is https://rahuldave.com/nbinlineai/ because the account's existing domain is inherited; https://rahuldave.github.io/nbinlineai/ redirects there. HTTPS is enforced for this project. Home, User guide, Architecture, and Development returned HTTP 200, all nine screenshot URLs returned HTTP 200, internal anchors and relative-link rewriting passed, and the landing page was visually checked in the browser. The repository homepage points to the live site. Future pushes to main trigger GitHub's Pages build automatically.

## Version 0.1.5 verification

Version `0.1.5` is synchronized in Python, JavaScript, `uv.lock`, and `yarn.lock`. The minimum JupyterLab version is 4.2 because the native `INotebookCellExecutor` service used for Run All was introduced there. The notebook Keep AI answers default, per-cell overrides and reset, native mixed Run All sequencing, error/cancel stop behavior, and edited-answer history were tested in a separate JupyterLab 4.6.4 server with a real Python kernel and deterministic fake provider. No real provider key or paid request was used.

The Python release gate passed 60 tests. The final frontend unit suite passed 26 tests and the production bundle built. In the first full browser run, 27 of 28 checks passed; one style test had shared-settings contamination from another test, so it now resets its own instructions. Its focused rerun passed. Additional focused checks passed for three-way Keep precedence, Python error before AI, and overlapping Run All cancellation; the final focused run passed 11 checks. All 31 distinct browser checks passed. The capture helper refreshed the relevant `docs/images/` screenshots. Port 8897 was stopped after each run; the user's port 8888 was untouched. Strict Twine metadata validation, archive content checks (including the FAQ and nine guide images), and credential-content scans passed before publication.


Version `0.1.5` was published from source commit `e61621e` and tagged `v0.1.5`. The wheel SHA256 is `6ede0df522ad9d25933d6999850b4f14453621d2900f8b21f2d6c7c6c1afc1f9`; the source archive SHA256 is `ee86447428a8524875a4ce6c45df0baab3460090334934d4db1d5641b5cc2a81`. Both match the public version-specific PyPI JSON metadata and the locally checked artifacts.

GitHub Pages deployment `35814287217` passed for the release source. The live Home, User guide, FAQ, Architecture, and Development pages returned HTTP 200, their internal anchors/rewritten Markdown links passed, and all nine screenshot URLs returned HTTP 200. Root visually checked the new Keep controls and the published FAQ. Architecture now documents frontend cell ordering/IDs versus live kernel state. Future whole-notebook, ±10-cell, and per-cell context controls are documented in `internal_docs/cell_kernel_model_and_context_selection.md` only; none were implemented in this release.

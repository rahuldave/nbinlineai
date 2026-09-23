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
uv build --out-dir dist/release-VERSION
uvx twine check --strict dist/release-VERSION/*
uv run --no-sync python scripts/check_release_artifacts.py dist/release-VERSION
```

Inspect the wheel and source archive if any check fails. The source archive must contain the GPL license, Python and TypeScript source, build metadata, lockfiles, examples, and prebuilt labextension. It must exclude `.env`, credential files, virtual environments, dependencies, build caches, test artifacts, and private `internal_docs`. The wheel must include the frontend bundle, server extension configuration, and license. `uv build` may invoke the frontend build hook, so do not run it concurrently with browser tests.

For a fresh-install check, install the built wheel in a disposable Python environment with JupyterLab 4, then confirm `jupyter labextension list` and `jupyter server extension list` show `nbinlineai` enabled. Open the quickstart notebook in a separate JupyterLab server and verify **Configure AI** and **AI Prompt** appear.

## Publish

Publishing is done by a maintainer with PyPI credentials configured outside the repository. Do not put credentials in shell history, source files, notebook metadata, or release logs. Before each upload, check that the version does not already exist on PyPI; PyPI will not allow replacing an uploaded version.

```bash
uv publish dist/release-VERSION/*
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


## Version 0.1.6 verification

Version `0.1.6` adds the authenticated frontend action/reply interface, ten opt-in bundled tools, editable Markdown note insertion, public documentation reads/notes, Python inspection, and six teaching notebooks plus one data fixture. Tools are registered only by references in the current AI prompt. Special functions are recognized by callable identity, including aliases; ordinary custom functions continue working in separate kernel environments without the package installed there. The implementation contract is in `internal_docs/bundled_tools.md`.

The final Python suite passed 97 tests, including every example's ordinary code cells in real kernels, special-tool alias/shadowing behavior, reply authentication/binding, expiry/cancellation, and bounded web conversion. The frontend suite passed 31 tests and the production build passed. The isolated full browser run passed 37 of 38 tests. The remaining native Run All cancellation/retry test had matched `Cancelling…` as if cancellation had completed; it now waits for final `Cancelled` and a disabled Cancel button before beginning a later batch, and its focused rerun passed. All 38 distinct browser checks passed, including unsaved live reads, insertion/persistence, duplicate delivery, notebook focus changes, cancellation, and existing Keep/settings/Run All behavior. Production cancellation behavior was preserved; the FAQ describes waiting for completion before retrying.

Three tools-page screenshots were captured against deterministic provider responses and actual kernel/frontend operations, then visually reviewed. The web-note screenshot uses sample page content. A separate real HTTP fetch of the public Python statistics documentation succeeded, returned a bounded 8,000-character excerpt, and retained its source URL. No paid provider calls were needed. The user's server on port 8888 was not used.

Strict Twine metadata validation, wheel/source content checks (including every example and all tools-page images), and credential-content scans passed. A fresh uv environment inside the project installed the final wheel, imported all ten tools, found all seven notebook files and the illustrated documentation, and discovered both the prebuilt JupyterLab extension and server extension enabled at 0.1.6 under JupyterLab 4.6.4. The isolated browser server was stopped.

Version `0.1.6` was published from source commit `752bf3887e0bd930194fff654aea02856632c08e` and tagged `v0.1.6`. The wheel SHA256 is `d42ee925797e66b8cb7758edbb747d088070126a34f0f20d24338ab05cafe2cc`; the source archive SHA256 is `a462f7fddaa886f39e0ce37e6ce1df4ae99e11453b4b413bb107bacc9f4a8304`. Both match the public PyPI release metadata and the checked local artifacts; PyPI reports 0.1.6 as the latest version.

GitHub Pages deployment `35818084770` passed for the release source. Home, User guide, Tools and examples, FAQ, Architecture, and Development returned HTTP 200 with the new Tools navigation link. The new tools, FAQ, and architecture pages show version 0.1.6, and all three new screenshot URLs returned HTTP 200. All examples, docs, tests, and source are committed on the public repository.


## Version 0.1.7 verification

Version `0.1.7` adds cumulative tool declarations from preceding ordinary Markdown and AI questions, a shared 64,000-character request estimate with nearest-first context selection, visible context-trimming reports, and `insert_tools()` for direct creation of a Markdown declaration note from Python. AI answers, code/raw cells, and later cells do not declare tools; live `$` values still resolve only in the current question. Tool schemas are accounted for before optional context, and every provider round re-budgets the original snapshot while preserving executed tool messages. The implementation and remaining token-counting limitations are documented in the public architecture and internal context notes.

The integrated Python suite passed 114 tests and Ruff. All 36 frontend unit tests and the production build passed. The full isolated JupyterLab browser run passed 43 of 45 checks; the two new fixture checks were corrected for a shifting last-cell locator and missing AI-answer metadata/diagnostic separators, and their focused reruns passed. All 45 distinct checks are green, including state-changing inherited tools, early declarations beyond 200 cells, nearest-first truncation, current-only variable lookup, direct helper insertion, focus changes, save/reload without replay, and native Run All insertion ordering. Real Python kernels and deterministic provider responses were used; no paid API request was needed.

The examples now demonstrate declarations shared by multiple lower questions and validate every offered function against a real kernel namespace. Only the explicitly tagged optional UI helper cell is skipped during headless example execution. The tools guide has a new natural-language screenshot showing a declared custom function changing Python state, with its simulated-provider origin identified in the caption. The README, guide, FAQ, tools page, architecture, and internal design notes were checked for stale current-question-only registration instructions.

Runtime requirements now explicitly include `comm>=0.2,<1` and `ipykernel>=6.18`, because the direct helper needs ipykernel's integration with the extracted comm package. The helper binds its request to the actual code execution and returns an asynchronous receipt; it never starts a nested event loop or makes a provider request.

Version `0.1.7` was published from source commit `e8cdacf32539109ff5f019b2e6cacd71c8025068` and tagged `v0.1.7`. The wheel SHA256 is `f31e3d614894616dc934e848aeaa721672c57b91cea363c8e1d66e1abe0fa58f`; the source archive SHA256 is `f26907043287851fb70ec2b6122d65b3c1acc00b6aa62e0fc7c402371a4d149f`. Both match the checked local artifacts and public PyPI metadata, which reports 0.1.7 as the latest release.

Strict Twine validation, archive content checks, and credential-content scans passed. A fresh uv environment inside the project installed the checked wheel, imported all ten bundled tools and the separate `insert_tools()` helper, found all seven example notebooks and the updated screenshot, and discovered both the JupyterLab and server extensions enabled at 0.1.7 under JupyterLab 4.6.4. The final documentation screenshots were visually reviewed. All isolated test servers were stopped; the user's port 8888 server was untouched.

GitHub Pages deployment `35823341101` succeeded for the release source. The public home page reports 0.1.7, the tools page documents direct declaration-note insertion, and the FAQ describes the 64,000-character budget. The source, tests, examples, and documentation are committed on the public repository.

## Version 0.1.8 verification

Version `0.1.8` packages the context-selection feature from commit `5387ead`: seven notebook Context modes, persistent per-cell text choices, independent declaration-cell Tools toggles, authenticated first-round context preview, and explicit included/omitted/partial reporting. The current-question-only mode keeps enabled tools while omitting optional notebook text. The version is synchronized in Python, JavaScript and `uv.lock`; the illustrated public documentation now identifies this behavior as 0.1.8.

The implementation task completed **140 Python tests, 44 frontend unit tests and an uninterrupted 57/57 isolated browser run**, plus Ruff, production build, package checks and a clean installation. Those functional results apply to feature commit `5387ead`; the release preparation changes only version metadata and documentation. The source task used a real Python kernel and deterministic provider without paid API calls, and stopped its owned servers. Publication preparation does not repeat the full browser suite for these metadata-only changes. Root reviewed the new context-selection and expanded-details screenshots, and local documentation link targets resolve. Port 8888 remains untouched.

The final 0.1.8 production build, strict Twine metadata validation, archive-content checks (126 source files; 62 wheel files), manifest-version checks, and scans for credential patterns and actual development key values passed. A fresh uv environment under this project installed the final wheel and verified version 0.1.8, all seven context modes, ten bundled tools, the insertion helper, eight example notebooks and the illustrated docs. JupyterLab 4.6.4 discovered both the prebuilt frontend and server extension enabled/OK at 0.1.8. No JupyterLab server was started during this packaging check.

Version `0.1.8` was published from source commit `9f1aa11b813bf7a343cf5b9c2214e8dab0950c2b` and tagged `v0.1.8`. The wheel SHA256 is `26dcd6bdeeaef8c11e0f596519918fd1d3b1966b58c85f252ca305a8250aff3b`; the source archive SHA256 is `19183839147d9c77749fb50a0804bb411a17810df156890618ab4f92c893ac68`. Both match public version-specific PyPI metadata and the checked local files. The project-wide JSON initially returned cached older release data immediately after upload, so the version-specific endpoint was used for initial hash verification.

GitHub Pages deployment `35866244300` succeeded for the release source. The public source now includes the previously local feature commit together with the versioned release, documentation and examples. The public home, user guide and FAQ report 0.1.8; PyPI's project metadata also reports 0.1.8 as latest.

## Version 0.1.9 verification

Version `0.1.9` simplifies the Context row to mode plus one-arrow Details. Target, optional Check context, help and reporting live inside Details; a check visibly reports pending, successful counts/time, or failure. Repeated select-question instructions are removed. Every cell's Context/Tools controls now appear above its content and align with its editor/text; AI action controls also sit above the question. The current question shows a plain always-included label. Selection, saved context metadata, provider requests and kernel execution semantics are preserved.

The frontend changes were committed as `167c909` and `94c5fdd`. TypeScript, **44 frontend unit tests** and production builds passed. The full Chromium browser run passed **58/59**; its remaining Learning test clicked the relocated header when it intended to edit question text. A corrected double-click on the rendered text passed its focused rerun. An additional first-click checkbox regression passed, giving **60 distinct passing Chromium checks**, not an uninterrupted 60/60 full-suite run.

Focused WebKit testing found a real lost first click on Override after editing earlier Markdown: JupyterLab rendered that earlier cell during mousedown and moved the button before mouseup. The scoped primary-mousedown guard on AI action buttons preserves the click without changing keyboard activation or select/text input handling. On the rebuilt assets, geometry/reload and first-click tests passed **2/2 in Chromium and 2/2 in WebKit**, including exactly one provider request for one Run click, one-click Override, and lower Context/Tools/Keep checkboxes. Checkbox testing did not reproduce a product failure, so no additional checkbox event guard was added. Earlier focused tests also verified one disclosure marker in both engines, pending/success/error feedback, same-count check completion, and stale reply rejection.

The unchanged backend retains the 0.1.8 evidence of **140 Python tests**; it was not rerun for this frontend/documentation patch. Tests use isolated JupyterLab on 8897 with real Python kernels and deterministic provider replies. All owned servers were stopped; the user's port 8888 was untouched and no paid provider request was made.

All **15 documentation screenshots** are current: the capture helper regenerated eleven illustrations and tool browser tests refreshed four. Root and the documentation worker visually reviewed the new layout, checked Default state, expanded Details, question/answer controls, and tool examples. README retains two images. The guide, FAQ, architecture and internal handoff cover placement, editing text below the controls, Default checked/mixed/disabled states, stale estimates, checkbox changes entering Custom, rechecking staying in Custom, returning to presets, and preserved choices. Local Markdown/image links and `git diff --check` pass.

The final production artifacts in `dist/release-019` passed strict Twine metadata validation, archive-content checks (126 source files; 62 wheel files), manifest versions, compiled top-control asset checks, credential-content scanning and byte-for-byte comparison of all 15 packaged screenshots against the reviewed files. A newly created uv environment installed the final wheel and verified version 0.1.9, all seven modes, ten tools, the insertion helper, eight examples and the illustrated documentation. JupyterLab 4.6.4 discovered both frontend and server extensions enabled/OK. No server was started for this installation check.

Version `0.1.9` was published from source commit `c080d07b933b39799e67ef5721252967f38f5250` and tagged `v0.1.9`; source and tag are pushed. The wheel SHA256 is `04f3969d06f0b8e010db5048d525824751951f4aca6701f418d44d319396b3a6`, and source archive SHA256 is `02694d23bf99109eeabcffdbb6a1c7106cd75fc543c9a8f1bde95073de45e3d6`. Both match the checked local artifacts and the public version-specific PyPI metadata; neither file is yanked.

GitHub Pages deployment `35875670314` succeeded for the release source. Home, user guide, FAQ, architecture and tools pages were verified live; all 15 public screenshot files match the reviewed local images byte for byte. The public PyPI install index lists both 0.1.9 artifacts. The ordinary project JSON briefly served cached 0.1.8 metadata after publication; a fresh query returned 0.1.9 as latest, while the version-specific hashes and install index already confirmed availability. If JupyterLab retains an old installed-extension card, refresh its Installed list or upgrade through the environment's package manager, then restart the whole Jupyter server.

## Version 0.1.10 verification

Version `0.1.10` adds distinct Light/Dark AI question and answer backgrounds, four editable starters in empty questions, shared focus instructions with budget-aware cell landmarks, and the `insert_code` tool. Code drafts retain their question and answer, start unexecuted, and remain outside the already-running Run All batch. Tool discovery and context selection retain their existing boundaries. New example notebooks demonstrate Jupyter AI alongside nbinlineai, including a Codex ACP teaching exercise. The user guide, FAQ, tools page, architecture and internal handoff describe these changes.

The final Python suite passed **155 tests**, including headless checks for all **ten example notebooks** (nine lessons plus the data fixture); the intentionally buggy Codex lesson is checked for its expected initial diagnostics. Ruff, production builds and **45 frontend unit tests** passed. The full isolated Chromium run passed **61/63**. Its two remaining checks needed maintenance: the bundled-tools example now has four questions instead of three, and a Contents API read raced native autosave. The corrected fixture-derived count and bounded read retry passed both focused reruns, so **all 63 distinct Chromium scenarios passed**, not an uninterrupted 63/63 run. Focused **WebKit checks passed 2/2**, covering Light/Dark rendering, native editors, first-click starter insertion, keyboard/undo and persistence. The new code-insertion Run All/save/reload scenario passed. All deterministic extension tests used real kernels and a fake provider; none needed paid API requests.

All **18 documentation screenshots** are current: thirteen helper captures, four tool illustrations, and a Dark-theme view. The new starter and unexecuted-code illustrations were visually reviewed. README retains two screenshots. Local Markdown file/image links and `git diff --check` passed.

The [Jupyter AI compatibility report](jupyter_ai_compatibility.md) pins official source versions and records a real isolated co-install. Native Run All ordering, Keep, single-cell command differences and metadata preservation passed with a fake provider. Current 0.1.10 frontend assets were separately checked alongside Jupyter AI 3.2.0 in Light/Dark, including explicit display of its normally hidden cell footer: the empty footer appears above our controls without overlapping them. Extra footer items, other themes, RTC and simultaneous agent mutations remain outside that check.

The [Codex ACP run record](codex_acp_example_run.md) documents a separate **successful authenticated ChatGPT-login agent trial**, using published nbinlineai 0.1.9 and Jupyter AI 3.2.0. Codex read the exercise, edited only its draft Python function, and ran the three explicitly named code cells; all checks passed. Inline questions remained untouched and unrun. The committed template retains the starting bug for students. This verifies the separate Jupyter AI chat route, not an inline subscription backend. The separate task's two files were integrated from commit `bc76f5f` as `a56358f`.

Owned servers on 8897, 8898/3001 and 8899/3002 were stopped; port 8888 was not touched.

Final artifacts in `dist/release-0110` passed strict Twine metadata validation, archive-content checks (**137 source files; 68 wheel files**), manifest-version checks, credential-pattern scanning, and byte-for-byte comparisons of all ten packaged notebooks and eighteen screenshots. A fresh project-local uv environment installed the checked wheel, imported the 0.1.10 package and focus module from its own site-packages, found eleven tools, ten notebook files and eighteen images, and discovered both JupyterLab and server extensions enabled/OK under JupyterLab 4.6.4. No server was started for that clean-install check.

Version `0.1.10` was published from source commit `03967c8233d3aff269c4272a014d05ab2001a711` and tagged `v0.1.10`; both source and tag are pushed. Wheel SHA256: `4e621425f5d98cd3e97239a54ed0a913ce70f3189f1621c5e72c2fee5223b2de`. Source archive SHA256: `f209b1a7723efcf332c1ed5616bdac281e5560f1b00b7c9af89c2892f7949fb8`. Both match public version-specific and project release metadata and are not yanked. PyPI reports 0.1.10 as latest, and its public simple install index lists both artifacts; initially cached 404/older metadata cleared on a fresh verification query.

GitHub Pages deployment `35905085246` succeeded for the release source. Public home, user guide, FAQ, tools and architecture pages show the new release/examples; all eighteen public screenshot files match the reviewed local images byte for byte.

## Version 0.1.11 verification

Version `0.1.11` expands the registry to **55 opt-in tools** in eight selectable groups: starter, files, code, inspect, notebook, saved_notebooks, web and execution. It adds fastcore/docments documentation rendering, static source documentation, bounded ripgrep and AST searches, guarded text-file replacements, source and document outlines, value/API/skill inspection, function tracing, separate Python/shell processes, local tmux reads, web section extraction and ordinary live-cell editing. Fifteen tools use the existing browser action transport. Tool references and variables retain the combined twenty-name guard and separate 64,000-character estimate. Search paths default to the selected kernel's cwd; they are not filesystem sandboxes. Model-driven execution of live notebook cells and Solveit-specific facilities remain deferred.

Public Tools reference and Examples are now separate pages. Two new disposable-file/project notebooks bring the total to **twelve notebook files**, including the data fixture. All 18 existing screenshots remain byte-identical to 0.1.10. README retains two illustrations. Runtime dependencies explicitly include fastcore, rgapi, remold, exhash, pyskills and Beautiful Soup; the package does not depend on dialoghelper or Solveit.

The final Python suite passed **207 tests**, including actual-kernel schemas for all 55 tools and headless execution of all twelve example templates. Ruff and the lockfile check passed. The frontend suite passed **49 tests**, TypeScript checked, and production assets were rebuilt/relinked before browser tests. The full isolated Chromium run passed **63/67**. One existing context-selection test needed its rendered-Markdown editing interaction corrected; the three new edit scenarios initially waited for Done although Keep had correctly changed the status to Answer kept. The rebuilt focused run passed 10/12 and exposed a real move acknowledgement bug: Jupyter replaces the moved cell's wrapper, so reading its ID afterward produced undefined. Capturing the ID before the move fixed the message. The final rebuilt live-edit run passed **3/3**, including unsaved/stale source, output clearing, protected AI cells, split/merge/copy/move/delete, Keep/no repeated effects, line edits and saving. The line rendering assertion was also corrected to inspect CodeMirror line elements rather than flattened textContent. **All 67 distinct scenarios passed across the full run and focused reruns**; this was not an uninterrupted 67/67 run.

The deterministic tests used isolated JupyterLab on 8897 with real Python kernels and no paid provider requests. Their owned server stopped after each run. Port 8888 was untouched.

A fresh Python 3.11 installation exposed an inherited upstream compatibility defect: aidialog 0.0.35 declares Python >=3.11 but its `msg_parts.py` uses a backslash within an f-string expression (line 141), which requires Python 3.12. The import fails before nbinlineai starts. Version 0.1.11 therefore corrects `Requires-Python` and current setup documentation to **Python >=3.12**, removes the inaccurate 3.11 classifier, and verifies the final wheel in a fresh Python 3.12 environment. No third-party source was patched.

Final artifacts in `dist/release-0111` passed strict Twine validation, archive checks (**155 source files; 77 wheel files**), version checks, credential-content scanning, and byte-for-byte comparisons with all twelve notebooks, eighteen screenshots and public Markdown pages. The initial broad credential pattern matched a public FAQ anchor containing `ask-`; the token-boundary-aware pattern and exact development-secret scan passed. The final wheel SHA256 is `aba471de94853c60d34758acb11d5915f84f7f7a80caf935805e7b237675d0eb`; the source archive SHA256 is `8d9efe14fa5a2031673ccc865bef85c3cf136275c42dff1d1c3d6df889936098`.

A newly created Python 3.12.10 uv environment installed the final wheel and imported it from its own site-packages. It verified all 55 tools, 15 browser-dispatched functions, eight groups, source/AST/document/file/subprocess/documentation smoke checks, twelve notebooks and eighteen images. JupyterLab 4.6.4 found both extensions enabled/OK at 0.1.11. Its separate temporary JupyterLab on 8897 opened the packaged quickstart, displayed AI Prompt and Configure AI, and returned HTTP 200/version 0.1.11 from the status route. The screenshot was reviewed. No key was supplied or provider called, and the owned server was stopped.

Publication evidence will be appended after upload.

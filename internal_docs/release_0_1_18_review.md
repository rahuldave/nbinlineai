# Version 0.1.18 release and review record

Status: **published and verified**, November 10, 2026.

## Scope and source

The user requested that selecting a code cell include its displayed output, including expression results, prints/stdout and stderr, and that a catalog group can be inserted as editable Markdown after the calling code cell. This mainline patch excludes notebook-agent experiments. The output requirement supersedes the historical 0.1.8 source-only snapshot contract.

PR [#51](https://github.com/rahuldave/nbinlineai/pull/51) merged as `bbedb3430a03c8b688147195bfd716dd261f6b86`, with a tree identical to reviewed candidate `68bca85b189069ff909f44956f9005242a264824`. The pushed annotated `v0.1.18` tag (`821b15e6e26dcad24b6e2e8b58ae8654440eb364`) points to that source merge. The approved pre-work and implementation baseline was clean main `5806f51f30affb309a591fb3cd1d566ef9700ce7`, checked against origin.

Primary `/Users/rahul/Projects/nbinlineai` stays on main and was safely fast-forwarded after merge. Root owned `/Users/rahul/.codex/worktrees/print-context-catalog/nbinlineai`, branch `codex/print-output-tool-catalog`, PR base main. The output worker owned `/Users/rahul/.codex/worktrees/printed-context-worker/nbinlineai`, branch `codex/printed-context`; its two commits were integrated by verified patch-equivalent cherry-picks. Publication records use the same root worktree on `codex/0.1.18-publication-record`, based on the release merge. Gest parent `zqwqzsnv`, iteration `plousuwk`; [issue #50](https://github.com/rahuldave/nbinlineai/issues/50).

## Released behavior

- A selected code cell contributes source and displayed textual output as one context unit. Stdout, stderr, expression/display results, errors, and text/Markdown/HTML/JSON representations for rich displays. Output-only code cells are eligible. Snapshot validation and preview revisions include live output. Each cell is bounded to 12,000 JavaScript characters with an explicit truncation marker and valid Unicode boundaries; the 4,000,000-character snapshot and 64,000-character host-submission limits still apply. At a budget boundary, source and output remain separately labeled. Image/binary payloads retain the explicit attachment/media path.
- The snapshot reads the live document, including unsaved/offscreen cells, without executing code. Displayed output can be stale relative to edited source. Output text never declares tools or resolves live variables. Selection modes and per-cell context choices apply to source and output together. Preview and both model transports share the budget builder.
- `insert_tool_catalog(group="starter")` delegates to the execution-bound `insert_tools` transport and inserts an ordinary editable Markdown declaration immediately below the calling cell. Starter contains 19 tools; named groups and current live variables share the existing 20-name reference limit. Imports, later receipt inspection and normal saving remain explicit. The 96 model tools are unchanged; there are now four setup helpers.
- Public context/privacy/tools/FAQ/architecture/troubleshooting, README and notebook examples describe the new behavior. The appended catalog example contains actual isolated JupyterLab call, inserted note and later receipt outputs. All previous cells and saved answers are unchanged.

## Independent review and verification

Independent read-only reviewer `release_review` (gpt-6-sol), separate from implementation, accepted exact base `5806f51f30affb309a591fb3cd1d566ef9700ce7` and head `68bca85b189069ff909f44956f9005242a264824` with **no remaining actionable findings**. Initial P1 findings identified the evidence merger's one-insertion assumption and missing headless/direct-plan entries; `19ed31f` fixes these with independent receipt attestation and two-insertion regression coverage. A P2 stale FAQ/troubleshooting contradiction was fixed in `68bca85`. Root reproduced and fixed a Unicode truncation boundary error before final review. Exact review evidence and dispositions are also in PR #51.

All required checks passed on that head:

- Source validation [42889289812](https://github.com/rahuldave/nbinlineai/actions/runs/42889289812): **718 Python**, **102 frontend**, **21 background-isolation** and **109 browser** tests passed; two optional subscription cases were skipped in the default suite.
- Runtime compatibility [42889289851](https://github.com/rahuldave/nbinlineai/actions/runs/42889289851): all **14** expected platform/musl variants and aggregate passed.
- Documentation [42889289750](https://github.com/rahuldave/nbinlineai/actions/runs/42889289750): smalldocs build, gallery, tool tables, links and anchors passed under the required legacy check name.

Locally, final-source output/helper browser regressions passed after rebuilding and relinking. They use a real Python kernel to check fresh stdout, stderr, expression results and an error traceback in previews and the provider context, and verify catalog insertion, a later receipt, save and reload. Both optional **deterministic offline ChatGPT scenarios passed separately**. Frontend 102, focused context 30, helper/evidence 68 and headless-example/merger 37 checks passed, along with Ruff, TypeScript, lock validation, saved evidence with zero deferrals, internal Markdown links and diff hygiene. An earlier full local browser run was superseded after the final Unicode rebuild. 15 passed and one was interrupted, with no product failure; complete final coverage is the exact-head CI run above. Early new-test execution/save timing assertions were corrected to wait for stable completed controls and saved contents.

All local browser servers were owned isolated port-8897 servers and stopped afterward. The user's port 8888, personal notebooks and credentials were not used. No paid-model or new physical-device acceptance is claimed.

## Artifacts and installation

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `nbinlineai-0.1.18-py3-none-any.whl` | 2,564,176 | `1bb5e88ad326329fc0c475c59260f556b45e44dc2c009d5b20ccab70e4c48ea1` |
| `nbinlineai-0.1.18.tar.gz` | 3,019,245 | `8ece42418f97ff234a9fd71637f7d81df9ce3875b1d3241b6b2d1c08d36211b9` |

Strict Twine metadata and repository archive checks pass. A separate independent artifact audit found no issues. All 337 tracked files in the 348-entry source archive match reviewed HEAD; all 144 wheel RECORD rows have correct hashes/sizes; all 128 mapped wheel code/docs/example entries match the source archive. Versions, GPL-3.0-only license expression/text, output extraction and the Unicode fix are present.

No forbidden caches, internal docs or credentials were found. Two credential-pattern hits were documentation `ask-after...` link anchors. The generated remoteEntry difference between archives normalizes to two webpack module-ID occurrences; the feature's compiled chunk is identical.

The exact audited wheel passed a disposable Python 3.14 installation with **113 compatible packages**, both extension discoveries and the isolated packaged quickstart UI. The helper is exported from the installed package. Checked files and sanitized verification logs are retained at `/Users/rahul/.codex/artifacts/nbinlineai/0.1.18` independently of temporary worktrees.

Both audited files were uploaded to PyPI. Version-specific public metadata and direct public downloads match the hashes above; neither file is yanked. The [PyPI release page](https://pypi.org/project/nbinlineai/0.1.18/) was inspected in a browser. Version, rendered README output guidance and `insert_tool_catalog` usage are visible. Raw HTTP page requests received a client challenge, so the browser supplied the rendering check.

A second empty Python 3.14 environment installed `nbinlineai==0.1.18` from the public PyPI index with **no cache**. All 113 installed packages are compatible. Package provenance resolves inside that environment's own site-packages, the new helper is exported, and both JupyterLab and server extensions are enabled and validate OK under isolated configuration.

## Documentation publication

Pages deployment [42893484201](https://github.com/rahuldave/nbinlineai/actions/runs/42893484201) passed at source merge `bbedb3430a03c8b688147195bfd716dd261f6b86`. All **94** public resources were fetched and verified, including **54 HTML pages** and all **30 notebook pages**. Bytes match the local render except expected sitemap checkout timestamps; the context guide, FAQ and catalog explicitly show the new output and insertion behavior. The deployment-only `.nojekyll` marker is checked by CI.

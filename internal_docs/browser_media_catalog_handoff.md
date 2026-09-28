# Browser/media tool catalog handoff

Status: implemented on topic `codex/browser-media-catalog` for the shipped tool
registry; additional browser/media families are pending integration. This is an
implementation record, not an approved pre-work specification or a release record.

## Revision and ownership

- PR base and selected committed `main` revision:
  `61fa3fe517999d8f88ff328a99fc86a34dfb470b`.
- Revised task prompt selected from reviewed commit
  `e3fcf33b20ec10cd511129cd1672b98d307e4a5c`,
  `internal_docs/browser_media_tool_task_prompt.md`; the prompt revision is a
  separate document selection from the committed main API spec.
- Approved pre-work API/research reading source: `main` at `61fa3fe`,
  `internal_docs/browser_media_tool_spec.md`,
  `internal_docs/browser_media_tool_research.md`, `internal_docs/bundled_tools.md`,
  `internal_docs/cell_kernel_model_and_context_selection.md`, and
  `internal_docs/notebook_execution_handoff_spec.md` (excluded work boundary).
- Implementation reading source: topic branch from `61fa3fe`,
  `internal_docs/developer_handoff.md` and `docs/architecture.md`.
- Owner/worktree: catalog Sol, `/Users/rahul/Projects/nbinlineai-media-catalog`;
  immediate PR base `main`. Primary `/Users/rahul/Projects/nbinlineai` remains
  on `main` and was not edited.

## Shipped registry coverage

`examples/tool-coverage.json` maps every current `TOOL_FUNCTIONS` name and the
three separate setup helpers to an example notebook, exact section, stable cell
ID, execution classification, platform note where needed, corresponding test
file and checkpoint evidence for that specific tool. Safe code calls ran in the
isolated-kernel example check; browser and public-network tools have AI questions
only. Their listed browser/unit test paths are checks to run, not a claim that
those cases passed in this worktree. The mapping is intentionally data driven:
`tests/test_tool_catalog_coverage.py` compares it with the imported registry and
checks the signatures and notebook links in `docs/tools.md`. The test does not
freeze the old tool count or claim that proposed browser/media tools already
exist. It rejects name-only mentions, disabled/answer-cell declarations,
excess inherited question references and a link attached to the wrong tool row.
Every new registered alias needs its own mapping and page row. Each notebook
uses at most 20 declarations at a time.

The saved-file, saved-notebook, inspection and process notebooks execute safe
calls with disposable values and paths. Document sections use an address copied
from the current outline; checked edits use a digest copied from the current
hash read. Live-cell tools are demonstrated with AI questions against separate
scratch cells in a copy of the notebook. Browser-backed Python imports are not
shown as direct callable Python demos. Network and optional tmux/skill examples
remain explicit, conditional AI questions. The `insert_tools` helper retains its
asynchronous receipt demo in `live-variables-and-tools.ipynb`; inspect its
updated status in a later cell in JupyterLab, without a synchronous wait loop.

`tests/test_examples.py` runs ordinary code cells in isolated kernels. Its one
existing UI-only exception remains a named exact notebook/cell classification
for the `insert_tools` receipt, which needs a browser acknowledgement. The
Codex ACP teaching notebook retains its intentional bug and expected diagnostic.
The notebook mapping test verifies page/registry parity and declaration limits;
it does not substitute for real-browser verification of frontend tools.

## Verification and remaining integration

Focused source checks for this checkpoint: `uv run --no-sync python -m pytest
-q tests/test_tool_catalog_coverage.py tests/test_examples.py` (isolated kernel,
no provider/network) and `uv run --no-sync ruff check` on changed Python tests.
Browser tests and frontend/package builds require the orchestrator's exclusive
lease and are not claimed here. `tests/e2e/tool-catalog-live.spec.ts` uploads a
disposable copy of the exact shipped live-catalog notebook to exercise its
`list_cells` question with a deterministic provider marker inserted only into
the uploaded copy. That test still requires the shared fake-provider fixture
change from its owner and execution under the lease. Existing browser suites
exercise the remaining shipped live edit/insert tools and `insert_tools`; their
paths are recorded in the coverage mapping, and the catalog owner will rerun
the affected cases under the lease. The new family owners will hand registered names,
signatures, notebook sections/cell IDs, capability limitations and tests to the
catalog owner. The catalog owner then extends the manifest, public tools page,
example index and browser verification mapping after those implementation
commits are available. No PyPI version or published package has changed.

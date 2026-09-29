# Worked notebook and documentation acceptance (in progress)

This is the source-work acceptance record for [draft PR #35](https://github.com/rahuldave/nbinlineai/pull/35), not a release
record. Its integration checkpoint was `977c851` on
`codex/worked-guide`; the implementation began from `main` at `22b0a83`.
The browser/media API contract was approved at `main`
`61fa3fe517999d8f88ff328a99fc86a34dfb470b`, with selected task prompt
`e3fcf33b20ec10cd511129cd1672b98d307e4a5c` (merged by PR #26).
Those revisions explain the tool surface; the worked-notebook scope is the
later user request for real, saved examples and reader-centered documentation.
The current Quarto gallery renders saved top-level notebooks without executing
them and checks local pages, links, anchors, and catalog rows. Public guides
describe the intended product workflow; source and release provenance stays
here. No version change or package release is part of this draft.

## Ownership and source boundaries

| Work | Owned physical checkout | Responsibility |
| --- | --- | --- |
| Nonmedia examples, manuals, evidence checker, this record | `/Users/rahul/Projects/nbinlineai-worked-notebooks`, `codex/worked-notebooks` | Seventeen older/example notebooks, `examples/README.md`, public pages other than the final user guide/FAQ, strict coverage checks. |
| Live execution and saved evidence | `/Users/rahul/Projects/nbinlineai-worked-execution` | Disposable JupyterLab/browser/subscription runs, genuine code output and AI tool traces, runner, `worked_notebooks_run.md` and `todo.md`. |
| Media examples and catalog mapping | `/Users/rahul/Projects/nbinlineai-worked-media` | Seven browser-media notebooks, `tool-coverage.json`, paired tool-catalog links. |
| Integration and PR | `/Users/rahul/Projects/nbinlineai-worked-guide`, `codex/worked-guide` | Root combines reviewed slices; PR #35 targets `main`. Root owns the final user guide and FAQ. |
| Quarto verification | `/Users/rahul/Projects/nbinlineai-worked-docs-verify` | Disposable rendered output and link/anchor checks; no edits to the primary checkout. |

The primary `/Users/rahul/Projects/nbinlineai` remains on `main`. Browser
execution uses only the owned isolated server on port 8897; the user's port
8888 is outside this work. Exact execution events and any later hardware
findings belong in `internal_docs/worked_notebooks_run.md` when B commits it;
this record summarizes accepted checkpoints rather than duplicating traces.

## Accepted source and evidence checkpoints

The ten canonical nonmedia notebooks with genuine saved worked runs at this
checkpoint are `quickstart.ipynb`, `context-selection.ipynb`,
`fastcore-tools.ipynb`, `project-tools.ipynb`, `bundled-tools.ipynb`,
`tool-catalog-inspection.ipynb`, `tool-catalog-saved-notebooks.ipynb`,
`tool-catalog-files.ipynb`, `tool-catalog-processes.ipynb`, and
`tool-catalog-web.ipynb`. Their integration commits are `9b7ee81`,
`7dd39c1`, and `57e5683`. The saved answers and observed-call tables are
properties of these worked examples; nbinlineai does not automatically save
a separate tool transcript for every answer. A code assignment can be an
actual direct call without displaying output; linked inspection cells show
its result. Frontend-only tools use honest JupyterLab comparisons, never a
fabricated Python direct call.

The coverage contract is registry-derived, with nested `normal_example` and
`ai_example` notebook/cell links. Its 96 public tools require both a normal
and an AI demonstration, except that 15 frontend-only normal comparisons
require observed UI evidence rather than Python calls. Three setup helpers
have explicit AI exceptions. AI evidence comes from observed tool-result
events, direct Python evidence from live-kernel call profiling, browser media
from later terminal receipt inspection, and ordinary UI evidence from an
observed before/after action. `insert_tools` has its own `inserted` receipt,
exact inserted cell ID and declaration source; it is not a BrowserReceipt.
The checker was introduced at `1318c37`, hardened after independent
reproductions at `b18d5b4`, `34aebc2`, and `c9c6b1d`, and has a scoped
`--only-notebook` progress mode at `cf0e637`. The unfiltered CI gate was
authored at `6993fbf`; it must pass against the final canonical saved
notebooks before acceptance and must not be skipped for publication.

The public notebook and manual source had independent review and focused
repairs. Media receipt references were corrected at `986bb8e` and `72cce25`;
all media questions use the Compact control after `1f2710e`. The runner's
privacy/classification repairs reached `d0393b1`, with direct-call profile
and cleanup repairs through `4061f9b`; independent review covered actual
registered calls, caught errors, prior-hook restoration, receipt identity,
and bounded state metadata. The notebook merger's inserted-cell attribution
was reviewed at `eaebc45`: inserted code/Markdown must match observed ID and
submitted source, while `url_to_note` can currently attest only ID/source
attribution because the result event lacks fetched body. These scoped reviews
do not substitute for the final saved-output gate.

The documentation source was checked by rendering 46 Quarto pages, including
24 top-level notebook pages and the 96-row catalog, with local links and
anchors resolving. The stdout-fence presentation repair `6bb6f3b` preserves
the canonical notebook output while keeping following anchors visible;
independent review included adversarial fenced stdout and HTML. The public
process notebook isolates inherited `TMUX` at `3154ec3`, verified with two
owned disposable sockets and independently reviewed. The exact-name
`insert_tools` evidence repair `c9c6b1d` rejects a marker or inserted cell
that contradicts the original literal request; its focused negative cases
were independently rerun. These are source/render and focused checks, not a
claim that all 24 notebooks have completed live demonstrations.

At the pushed `977c851` PR checkpoint, remote Quarto render/site checks and
the runtime compatibility summary passed at 06:58 UTC on 2026-09-29. Full
source validation was still running. Publication was correctly skipped for
the PR. These checks do not close the live-media or ordinary UI evidence gaps.

## Remaining acceptance work

- Save and inspect genuine runs for the seven other nonmedia notebooks:
  `codex-acp-worked-example.ipynb`, `jupyter-ai-and-nbinlineai.ipynb`,
  `live-notebook-tools.ipynb`, `live-variables-and-tools.ipynb`,
  `python-and-web-tools.ipynb`, `socratic-learning-dialog.ipynb`, and
  `tool-catalog-live-notebook.ipynb`. Preserve the ACP exercise's expected
  diagnostic instead of silently fixing its intentional bug.
- Save and independently inspect the remaining seven media notebooks, with
  real wall camera/microphone/screen capture where available, visible typed
  media, later receipt states, and cleanup. A pending permission request is
  not evidence of completed capture. The run log records device and platform
  limitations without publishing private labels, IDs, paths, or secrets.
- Perform and save the 15 ordinary JupyterLab comparisons in a disposable
  notebook, recording readable observed before/after outcomes. Complete the
  `insert_tools` helper through an `inserted` receipt and exact saved
  declaration cell.
- Audit native Run All readiness with direct and AI `start_share` in separate
  disposable passes: a later marker cell must execute while the chooser is
  waiting; cancel only the exact owned pending operation afterward. This is
  an interaction check, not permission to automate a chooser.
- Run the unfiltered strict saved-evidence check for all registry public
  tools and helpers, then the final headless/source, Quarto site, and required
  PR CI checks on the integrated head. Record final exact counts, review
  dispositions, and PR outcome here only after the evidence exists.

No PyPI upload, tag, or package release is authorized by this work. The
existing release record remains separate from PR #35's source and docs checks.

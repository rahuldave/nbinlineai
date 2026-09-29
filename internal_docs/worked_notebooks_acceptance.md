# Worked notebook and documentation acceptance (in progress)

This is the source-work acceptance record for [draft PR #35](https://github.com/rahuldave/nbinlineai/pull/35), not a release
record. This integration checkpoint is `0b02ecc` on `codex/worked-guide`;
the implementation began from `main` at `22b0a83`.
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
| Genuine web/ACP publication and UI annotation publisher | `/Users/rahul/Projects/nbinlineai-worked-publication`, `codex/worked-publication` | Source-preserving merge of two saved runs; post-merge publisher for later actual manual UI observations. |
| Integration and PR | `/Users/rahul/Projects/nbinlineai-worked-guide`, `codex/worked-guide` | Root combines reviewed slices; PR #35 targets `main`. Root owns the final user guide and FAQ. |
| Quarto verification | `/Users/rahul/Projects/nbinlineai-worked-docs-verify` | Disposable rendered output and link/anchor checks; no edits to the primary checkout. |

The primary `/Users/rahul/Projects/nbinlineai` remains on `main`. Browser
execution uses only the owned isolated server on port 8897; the user's port
8888 is outside this work. Exact execution events and hardware findings
belong in `internal_docs/worked_notebooks_run.md`;
this record summarizes accepted checkpoints rather than duplicating traces.

## Accepted source and evidence checkpoints

The canonical `examples/*.ipynb` inventory at `0b02ecc` contains 24 notebooks.
Thirteen retain genuine code output or completed AI answers; eleven remain
source-only. Counts below come from the saved notebook cells, not from draft
runner artifacts. “Calls” counts structured observed tool-result events; the
ACP lesson correctly has no tool trace because its two questions offer no
notebook tools.

| Notebook (`.ipynb`) | Executed code cells | Done AI answers | Observed calls | UI actions |
| --- | ---: | ---: | ---: | ---: |
| `browser-media-attachment` | 0 | 0 | 0 | 0 |
| `browser-media-capture` | 0 | 0 | 0 | 0 |
| `browser-media-foundation` | 12 | 7 | 7 | 0 |
| `browser-media-integration` | 0 | 0 | 0 | 0 |
| `browser-media-outputs` | 0 | 0 | 0 | 0 |
| `browser-media-playback` | 0 | 0 | 0 | 0 |
| `browser-media-transforms` | 0 | 0 | 0 | 0 |
| `bundled-tools` | 2 | 4 | 5 | 0 |
| `codex-acp-worked-example` | 3 | 2 | 0 | 0 |
| `context-selection` | 1 | 1 | 1 | 0 |
| `fastcore-tools` | 5 | 2 | 4 | 0 |
| `jupyter-ai-and-nbinlineai` | 0 | 0 | 0 | 0 |
| `live-notebook-tools` | 0 | 0 | 0 | 0 |
| `live-variables-and-tools` | 0 | 0 | 0 | 0 |
| `project-tools` | 4 | 1 | 4 | 0 |
| `python-and-web-tools` | 2 | 4 | 5 | 0 |
| `quickstart` | 2 | 2 | 2 | 0 |
| `socratic-learning-dialog` | 0 | 0 | 0 | 0 |
| `tool-catalog-files` | 17 | 6 | 15 | 0 |
| `tool-catalog-inspection` | 13 | 5 | 12 | 0 |
| `tool-catalog-live-notebook` | 0 | 0 | 0 | 0 |
| `tool-catalog-processes` | 6 | 3 | 4 | 0 |
| `tool-catalog-saved-notebooks` | 6 | 3 | 5 | 0 |
| `tool-catalog-web` | 3 | 3 | 3 | 0 |

The saved total is **43 done AI answers, 67 observed calls, and zero manual UI
action markers**. The first ten nonmedia runs entered through `9b7ee81`,
`7dd39c1`, and `57e5683`. The real foundation run entered at `108450c`;
the original-source-preserving web and ACP publications were independently
accepted at `0189e2c` and integrated as `8d8b620`. The saved answer/call
tables are features of these worked examples; nbinlineai does not
automatically save a separate tool transcript for every answer. A code
assignment can be an actual direct call without displaying output; linked
inspection cells show its result. Frontend-only tools require honest
JupyterLab comparisons, never a fabricated Python direct call.

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
authored at `6993fbf` and enabled at `080d8a3`. It runs now and fails on
unfinished actual evidence; it must pass against the final canonical saved
notebooks before acceptance and must not be skipped for publication.

The current mapping has **96 public tools and three setup helpers**. All
source mappings pass the structural checker. Saved execution passes for 41
public normal examples and 42 public AI examples; one setup helper
(`tool_catalog`) passes. Exactly `start_camera`, `capture_camera`, and
`record_camera` have the user-authorized dated **normal-and-AI camera
deferral**, tied to [the actual camera probe](worked_notebooks_run.md#camera).
The probe attempted acquisition for `start_camera`; the other two are
dependency-blocked, not individually claimed as executed. No other tool or
notebook is waived. The strict checker currently reports 54 tool/helper
failures, representing 54 unfinished normal modes and 51 unfinished AI modes;
its one-error-per-tool output reports the first failure only. The exact
remaining names are:

| Notebook | Modes still required | Tools |
| --- | --- | --- |
| `browser-media-attachment` | normal + AI | `attach_media` |
| `browser-media-capture` | normal + AI | `capture_screen`, `capture_tool`, `list_media_sources`, `pause_recording`, `read_audio_levels`, `record_microphone`, `resume_recording`, `setup_share`, `start_microphone`, `start_recording`, `start_share`, `stop_recording`, `stop_share`, `stop_source` |
| `browser-media-outputs` | normal + AI | `capture_canvas`, `capture_notebook_region`, `export_canvas`, `export_output`, `list_canvases`, `list_outputs`, `read_notebook_view`, `read_output`, `read_selection`, `start_canvas` |
| `browser-media-playback` | normal + AI | `choose_file`, `close_media`, `copy_text`, `open_media`, `paste_content`, `pause_media`, `play_media`, `seek_media`, `set_media_volume` |
| `browser-media-transforms` | normal + AI | `annotate_image`, `crop_image`, `extract_frames` |
| `tool-catalog-live-notebook` | normal + AI | `cell_insert_line`, `cell_replace_lines`, `cell_str_replace`, `copy_cell`, `delete_cell`, `find_cells`, `insert_code`, `insert_markdown`, `list_cells`, `merge_cells`, `move_cell`, `read_cell`, `replace_cell`, `split_cell` |
| `tool-catalog-web` | normal UI only | `url_to_note` |
| `live-variables-and-tools` | normal helper only | `insert_tools` (later `inserted` receipt and actual declaration cell required) |
| `tool-catalog-live-notebook` | normal helper only | `tools_markdown` |

The 15 frontend-only normal comparisons are the fourteen live-notebook names
above plus `url_to_note`; their AI modes remain independently required. The
web `url_to_note` AI mode already has a real observed completed call. The
other setup helper, `tool_catalog`, is complete; setup helpers have explicit
AI exceptions rather than fabricated AI calls. After the pinned `0b02ecc`
inventory, `b070ebb` (integrated as `7d8ba14`) gave passive
`list_media_sources` its own AI question before the deferred camera question.
Its actual answer is still required; the camera exception does not apply to it.

The public notebook and manual source had independent review and focused
repairs. Media receipt references were corrected at `986bb8e` and `72cce25`;
all media questions use the Compact control after `1f2710e`. The runner's
privacy/classification repairs reached `d0393b1`, with direct-call profile
and cleanup repairs through `4061f9b`; independent review covered actual
registered calls, caught errors, prior-hook restoration, receipt identity,
and bounded state metadata. The notebook merger's inserted-cell attribution
was reviewed through `b4bd577`: inserted code/Markdown must match observed
ID, submitted source, requested anchor, and call order, while `url_to_note`
can currently attest only ID/source attribution because the result event
lacks fetched body. The no-tool-answer path at `78c3b5a` allows the genuine
ACP answers without inventing a trace, only when the source offers no current
or inherited notebook tool; it and the two-artifact publication were
independently accepted. The manual-UI publisher `4556bfd` and safety/retry
repair `c2d1a02` were also independently reviewed: it accepts only bounded
actual observations for mapped JupyterLab comparisons, rejects token-bearing
text, and resumes an interrupted batch only with exact identical rows. No
manual UI observation has been published yet. These scoped reviews do not
substitute for the final saved-output gate.

The documentation source was checked by rendering 46 Quarto pages, including
24 top-level notebook pages and the 96-row catalog, with local links and
anchors resolving. The stdout-fence presentation repair `6bb6f3b` preserves
the canonical notebook output while keeping following anchors visible;
independent review included adversarial fenced stdout and HTML. The public
process notebook isolates inherited `TMUX` at `3154ec3`, verified with two
owned disposable sockets and independently reviewed. The exact-name
`insert_tools` evidence repair `c9c6b1d` rejects a marker or inserted cell
that contradicts the original literal request; its focused negative cases
were independently rerun. At `0b02ecc`, the newly published foundation,
web, and ACP pages were rendered again in the owned verification checkout:
foundation shows seven answer panels, seven observed-call tables, terminal
receipt inspections, and an 80×80 PNG whose rendered file is byte-identical
to the saved output; web shows four answer panels, four trace tables, and its
observed note at the requested early anchor; ACP shows two done answers, its
intentional “Needs work” diagnostics, and no phantom tool table. Those three
pages have their download links and no broken local references. This focused
render is not the final full-site check.

A **private, unpublished** partial capture run contains a real microphone
recording. The staged notebook's embedded Opus/WebM bytes match its separate
320,211-byte artifact (SHA-256
`53abd10924caa065ca194c4d7357ca53dd83de187f81a28cf5ac640c736bf5aa`).
FFmpeg decoding, rather than unavailable WebM container duration metadata,
gave 317,760 mono 16-kHz PCM samples, or 19.86 seconds, with two separated
approximately 440-Hz signal intervals. This is byte, decoding, and signal
inspection, not a listening claim or completion of the capture notebook.

A separate owned-tab screen recording is a checked-in companion input for the
transform notebook at source commit `c48f99d` (integrated as `8a6545b`).
Its 72,134-byte VP9/WebM file has SHA-256
`2087303b97be4ba56da4d95d19d1106f6c0ddb5d9030e3f74f5c47e84bc4d63a`.
Independent FFmpeg inspection decoded twelve 1500×786 frames from 0 through
10.694 seconds; the staged notebook's embedded video bytes matched the file.
Visual inspection found only the disposable notebook tab and two distinct
notebook scenes. The notebook now asks for frames at 1.5 and 5.0 seconds,
checks actual presented times and differing pixels, and preserves exact
source-hash references. Its local-first setup, pinned bounded download
fallback, corrupt-file rejection, and disposable cleanup were independently
checked; the isolated headless setup passed with the pinned file, and its
test fixture was integrated as `1d8a780`. The final
canonical browser `extract_frames` run and saved frames remain pending.

At the pushed `0b02ecc` PR checkpoint, Quarto render/site checks and runtime
compatibility passed. Full source validation run `36538854955` had 503 tests
pass and exactly one fail: the enabled unfiltered saved-evidence gate, on the
unfinished modes listed above. The source validation gate consequently
failed; no other Python failure appeared in that log. Publication was
correctly skipped for the PR. This expected red gate is an open acceptance
requirement, not a reason to hide or skip the test.

## Remaining acceptance work

- Save and inspect genuine runs for the five source-only nonmedia notebooks:
  `jupyter-ai-and-nbinlineai.ipynb`, `live-notebook-tools.ipynb`,
  `live-variables-and-tools.ipynb`, `socratic-learning-dialog.ipynb`, and
  `tool-catalog-live-notebook.ipynb`. The saved ACP lesson already preserves
  its expected diagnostic rather than silently fixing the teaching bug.
- Save and independently inspect the six remaining source-only media
  notebooks: capture, outputs, playback, transforms, attachment, and the
  integration walkthrough. The private microphone artifact is only a partial
  run. Use actual microphone and owned-tab screen sources for noncamera
  workflows; the exact three camera-dependent tools remain dated exceptions
  until the user and hardware can complete them. A pending permission request
  is not evidence of capture. Do not publish private labels, IDs, paths, or
  secrets.
- Perform and save the 15 ordinary JupyterLab comparisons in a disposable
  notebook, recording readable observed before/after outcomes. Complete the
  `insert_tools` helper through an `inserted` receipt and exact saved
  declaration cell.
- Audit native Run All readiness with direct and AI `start_share` in separate
  disposable passes: a later marker cell must execute while the chooser is
  waiting; cancel only the exact owned pending operation afterward. This is
  an interaction check, not permission to automate a chooser.
- Make the already-enabled unfiltered strict saved-evidence gate pass for all
  nondeferred registry public tools and helpers, then rerun final
  headless/source, Quarto site, and required PR CI checks on the integrated
  head. Record final exact counts, review dispositions, and PR outcome here
  only after the evidence exists.

No PyPI upload, tag, or package release is authorized by this work. The
existing release record remains separate from PR #35's source and docs checks.

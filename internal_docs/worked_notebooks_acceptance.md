# Worked notebook and documentation acceptance (in progress)

This is the source-work acceptance record for [draft PR #35](https://github.com/rahuldave/nbinlineai/pull/35), not a release
record. This provisional inventory is pinned to integrated `6b7dd62` on `codex/worked-guide`;
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
| Nonmedia examples, manuals, evidence checker, this record | `/Users/rahul/Projects/nbinlineai-worked-notebooks`, `codex/worked-notebooks`; this refresh in `/Users/rahul/Projects/nbinlineai-worked-acceptance-refresh`, `codex/worked-acceptance-refresh` | Seventeen older/example notebooks, `examples/README.md`, public pages other than the final user guide/FAQ, strict coverage checks and this pinned evidence record. |
| Live execution and saved evidence | `/Users/rahul/Projects/nbinlineai-worked-execution` | Disposable JupyterLab/browser/subscription runs, genuine code output and AI tool traces, runner, `worked_notebooks_run.md` and `todo.md`. |
| Media examples and catalog mapping | `/Users/rahul/Projects/nbinlineai-worked-media` | Seven browser-media notebooks, `tool-coverage.json`, paired tool-catalog links. |
| Genuine web/ACP publication and UI annotation publisher | `/Users/rahul/Projects/nbinlineai-worked-publication`, `codex/worked-publication` | Source-preserving merge of two saved runs; post-merge publisher for actual manual UI observations. |
| Integration and PR | `/Users/rahul/Projects/nbinlineai-worked-guide`, `codex/worked-guide` | Root combines reviewed slices; PR #35 targets `main`. Root owns the final user guide and FAQ. |
| Quarto verification | `/Users/rahul/Projects/nbinlineai-worked-docs-verify` | Disposable rendered output and link/anchor checks; no edits to the primary checkout. |

The primary `/Users/rahul/Projects/nbinlineai` remains on `main`. Browser
execution uses only the owned isolated server on port 8897; the user's port
8888 is outside this work. Exact execution events and hardware findings
belong in `internal_docs/worked_notebooks_run.md`;
this record summarizes accepted checkpoints rather than duplicating traces.

## Accepted source and evidence checkpoints

The canonical `examples/*.ipynb` inventory at `6b7dd62` contains 24 notebooks.
All 24 now retain at least one genuine code output or ordinary JupyterLab
observation; that does **not** mean each walkthrough is complete. Counts below
come only from saved canonical cells. “Calls” counts structured observed
model-tool result events. The ACP lesson correctly has no notebook-tool trace
because its two questions offer no notebook tools. The 15 UI observations
are fourteen live-editor comparisons plus one manual web-note comparison.

| Notebook (`.ipynb`) | Executed code cells | Done AI answers | Observed calls | UI actions |
| --- | ---: | ---: | ---: | ---: |
| `browser-media-attachment` | 4 | 2 | 2 | 0 |
| `browser-media-capture` | 21 | 0 | 0 | 0 |
| `browser-media-foundation` | 12 | 7 | 7 | 0 |
| `browser-media-integration` | 15 | 0 | 0 | 0 |
| `browser-media-outputs` | 39 | 24 | 30 | 0 |
| `browser-media-playback` | 20 | 0 | 0 | 0 |
| `browser-media-transforms` | 8 | 8 | 14 | 0 |
| `bundled-tools` | 2 | 4 | 5 | 0 |
| `codex-acp-worked-example` | 3 | 2 | 0 | 0 |
| `context-selection` | 1 | 1 | 1 | 0 |
| `fastcore-tools` | 5 | 2 | 4 | 0 |
| `jupyter-ai-and-nbinlineai` | 4 | 3 | 1 | 0 |
| `live-notebook-tools` | 2 | 0 | 0 | 0 |
| `live-variables-and-tools` | 4 | 0 | 0 | 0 |
| `project-tools` | 4 | 1 | 4 | 0 |
| `python-and-web-tools` | 2 | 4 | 5 | 0 |
| `quickstart` | 2 | 2 | 2 | 0 |
| `socratic-learning-dialog` | 1 | 2 | 0 | 0 |
| `tool-catalog-files` | 17 | 6 | 15 | 0 |
| `tool-catalog-inspection` | 13 | 5 | 12 | 0 |
| `tool-catalog-live-notebook` | 2 | 0 | 0 | 14 |
| `tool-catalog-processes` | 6 | 3 | 4 | 0 |
| `tool-catalog-saved-notebooks` | 6 | 3 | 5 | 0 |
| `tool-catalog-web` | 3 | 3 | 3 | 1 |

At this pin, the saved source/evidence walkthrough is complete for the
foundation and transform notebooks; bundled tools, ACP, context selection,
fastcore, Jupyter AI coexistence, project tools, Python/web, and quickstart;
and the files, inspection, processes, saved-notebooks, and web catalog
notebooks. The other nine notebooks are **partial**: attachment, capture,
integration, outputs, playback, live-notebook tools, live variables, Socratic
dialogue, and the live-notebook catalog. “Complete” here describes their
authored worked steps, not final PR validation or a package release.

The saved total is **196 executed code cells, 82 done AI answers, 114 observed
calls, and 15 observed ordinary UI actions**. Four notebooks have completed
normal setup/direct work but no saved AI answer: capture, integration,
playback, and the live-notebook tutorial. The live-variable and live-catalog
notebooks preserve genuine helper results but their AI editing questions remain
unrun. The Socratic notebook preserves two actual tutor turns and leaves its
third prompt blank; attachment preserves two traced AI answers and direct
confirmation but its final native-image question is unanswered. These partial
states are intentional disclosures, not inferred completions.

The first ten nonmedia runs entered through `9b7ee81`, `7dd39c1`, and
`57e5683`. The real foundation run entered at `108450c`; the
original-source-preserving web and ACP publications were independently
accepted at `0189e2c` and integrated as `8d8b620`. Later separately reviewed
canonical publications added playback, microphone capture, exact UI
comparisons, two setup helpers, direct integration and attachment evidence,
and two Socratic tutor turns. The saved answer/call tables are features of
these worked examples; nbinlineai does not automatically save a separate tool
transcript for every answer. A code assignment can be an actual direct call
without displaying output; linked inspection cells show its result. Frontend
only tools require honest JupyterLab comparisons, never a fabricated Python
call.

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

The current mapping has **96 public tools and three setup helpers**. Every
source mapping passes the structural checker. At `6b7dd62`, saved execution
passes for **89 of 93 nondeferred public normal modes and 55 of 93 nondeferred
public AI modes**. Three additional public tools—exactly `start_camera`,
`capture_camera`, and `record_camera`—have
the user-authorized dated **normal-and-AI camera deferral**, tied to
[the actual camera probe](worked_notebooks_run.md#camera). The probe attempted
acquisition for `start_camera`; the other two are dependency-blocked and are
not individually claimed as executed. This accounts for 92 of 96 normal
modes and 58 of 96 AI modes when the three exceptions are counted separately
from real execution. All three setup helpers have genuine normal evidence and
explicit AI exceptions. No other tool or notebook is waived.

The unfiltered strict checker still reports **38 first-error tool rows**.
Independently checking each mode with the same checker reveals **four
unfinished normal modes and 38 unfinished AI modes** (42 mode gaps); the four
normal failures are hidden behind those tools' earlier AI errors in the
standard one-error-per-tool output. The remaining mapped modes are:

| Notebook | Normal modes still required | AI modes still required |
| --- | --- | --- |
| `browser-media-capture` | `capture_screen`, `capture_tool`, `start_share`, `stop_share` | `capture_screen`, `capture_tool`, `list_media_sources`, `pause_recording`, `read_audio_levels`, `record_microphone`, `resume_recording`, `setup_share`, `start_microphone`, `start_recording`, `start_share`, `stop_recording`, `stop_share`, `stop_source` |
| `browser-media-outputs` | — | `read_selection` (the normal nonempty selected-text demonstration is saved) |
| `browser-media-playback` | — | `choose_file`, `close_media`, `copy_text`, `open_media`, `paste_content`, `pause_media`, `play_media`, `seek_media`, `set_media_volume` |
| `tool-catalog-live-notebook` | — | `cell_insert_line`, `cell_replace_lines`, `cell_str_replace`, `copy_cell`, `delete_cell`, `find_cells`, `insert_code`, `insert_markdown`, `list_cells`, `merge_cells`, `move_cell`, `read_cell`, `replace_cell`, `split_cell` |

The 15 frontend-only normal comparisons—fourteen live-notebook tools plus
`url_to_note`—now have observed and readable before/after outcomes. Their AI
modes remain independently required where listed. Passive
`list_media_sources` has its own AI question outside the deferred camera
workflow; its actual answer remains required. `read_selection`'s new normal
example selected a nonempty line, while its earlier saved empty-state result
also remains in the notebook. `setup_share` has a saved normal completed
availability receipt; that does not prove a screen was shared. The exact
`insert_tools` inserted declaration and later receipt, `tools_markdown`
generated declarations, and `tool_catalog` normal result complete the three
helper exceptions without inventing AI use.

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
text, and resumes an interrupted batch only with exact identical rows. All
15 mapped ordinary UI observations have since been published with readable
outcomes. These scoped reviews do not
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

The canonical output notebook retains 24 done answers and 30 observed calls;
it shows both the earlier honest empty `read_selection` result and the later
normal nonempty line selection. That later example's AI answer is pending.
The transform
notebook retains eight done answers and fourteen calls against the owned-tab
video. Its direct browser receipts came from a distinct genuine run, so their
temporary operation IDs can differ from the AI questions. The coexistence
notebook retains three done answers and one observed call; its inserted code
remains unexecuted for the reader. Focused Quarto renders checked actual
output displays and anchors.

At `3272cf0`, the exact committed playback notebook rendered to an HTML page
in the owned verification checkout: its saved 60-second WAV appears as one
inline audio control, normal code and receipt outputs are readable, all five
sampled call anchors and the download link resolve, and multiline setup code
retains line breaks. The page contains 24 AI question panels and zero saved AI
answer or observed-call panels, matching its direct-only state. This was a
render check, not another media decode or live browser run.

The canonical capture notebook now retains two real microphone clips and
later direct receipts for microphone start, levels, recording pause/resume/stop,
source stop, and a one-shot recording. Independent decoding of the embedded
Opus/WebM clips gave **20.64 and 6.96 seconds of playable audio**; the
recording receipt's longer wall-clock duration includes paused time. A separate
private earlier microphone artifact was also decoded at 19.86 seconds, but is
not an extra canonical demonstration. A later `setup_share` normal call and
inspection completed with `share_controls: true` and `screen_available: true`.
Those capability values are not a shared stream: the four remaining direct
screen actions and all capture AI questions are pending. The capture notebook
still contains no saved AI answer.

After this pinned source checkpoint, B's final bounded native chooser attempt
used a verified owned disposable tab row. A guarded click did not select that
row, the native **Share** control remained disabled, and no Share press,
successful stream, `capture_screen`, `capture_tool`, or `stop_share` followed.
The owned browser/server processes stopped and port 8897 was free. This is an
observed test interaction boundary, not evidence that the product's screen
capture succeeded or that the user's own browser lacks support.

The canonical playback notebook retains actual normal use of its nine browser
tools with real chooser, controls, clipboard and later receipt inspections.
Its AI questions remain unrun. Direct integration now preserves the genuine
8×8 output-to-export-to-preview-to-4×4-crop-to-save sequence, checks saved
file and sidecar hashes, then closes/releases memory media and removes both
generated files. Its four AI prompts and attachment confirmation remain unrun.
The attachment notebook preserves direct image confirmation and two traced AI
tool answers; its final color question is deliberately unanswered. A separate
private accepted turn demonstrated native image delivery with the confirmed
PNG hash, but it is not presented as that final saved answer.

The live-variable and live-catalog notebooks now preserve their genuine
`insert_tools` and `tools_markdown` helper outcomes, with the exact inserted
cell and later `inserted` receipt for the former. Their AI editing sequences
are still unrun. The live-notebook tutorial keeps only its two genuine setup
outputs, while the Socratic dialogue keeps one genuine setup output and two
done tutor replies from the same session. The third Socratic prompt is blank.

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
test fixture was integrated as `1d8a780`. The canonical transform notebook
now contains the real `extract_frames` result and saved frame displays.

Earlier PR #35 CI at `0b02ecc` rendered Quarto and passed runtime
compatibility, while full source validation reported 503 passing tests and the
one expected failure of the enabled unfiltered saved-evidence gate. At the
later rebased `32e2c5e` checkpoint, source validation again failed only that
gate after 541 passing tests; dependent package/browser stages were skipped
there, not passed. At the pinned `6b7dd62` head, source run
`36559068643` passed 544 Python tests and Ruff, then failed only the same
strict saved-evidence gate; its later frontend unit and TypeScript checks
were not reached. Quarto run `36559068822` and runtime-compatibility run
`36559068731` passed. The current inventory above is a read-only
canonical-cell/checker calculation, not a new full test run. Focused renders
independently checked the newly saved attachment, integration, live-variable,
live-catalog, web, Socratic, capture and live-notebook pages, including their
visible outputs, prompt/answer counts, anchors and download links. These
focused checks do not replace final full Quarto/site or required PR CI.

The separate ChatGPT credit-admission correction was independently reviewed
and merged to `main` as PR #36 at `38803dcb5af99f080bbb74c68965356857046fd9`.
Its deterministic contract is accepted, but the user has not answered the
paid-credit-use question. This work makes no new paid model request or claim
that paid-credit execution has been verified live. The saved AI answers above
predate that unanswered decision.

## Remaining acceptance work

- Finish the four direct screen actions—`start_share`, `capture_screen`,
  `capture_tool`, and `stop_share`—with a real owned chooser/stream or retain
  their exact outstanding state. The accepted `setup_share` receipt proves
  controls are available, not capture. B's final bounded chooser attempt did
  not select the verified tab or enable Share, so all four mapped normal modes
  remain unresolved at this pin. Keep the separate owned-tab transform clip
  distinct from these tool calls.
- Complete the **38 nondeferred AI modes** listed above with actual saved
  answers and structured tool events after the user decides on paid-credit
  use. Four screen normal modes are also pending at this checkpoint. No AI
  answer is inferred from a source prompt, direct receipt, or private pilot.
  Separately finish the unmapped tutorial continuations: the integration AI
  prompts, attachment's final image question, live notebook editing, and
  Socratic third turn only when real execution is authorized and observed.
- Preserve the exact three dated camera-only normal-and-AI deferrals; do not
  extend them to passive listing, microphone, screen, or playback. Recheck
  the native Run All readiness audit for direct and AI `start_share` only
  with an owned pending operation; the AI half remains untested at this pin.
- Make the already-enabled unfiltered strict saved-evidence gate pass for all
  nondeferred public tools and three setup helpers. Then run final headless,
  source, Quarto/site, and required PR checks on the integrated head; update
  counts and independent review dispositions from those actual results.

No PyPI upload, tag, or package release is authorized by this work. The
existing release record remains separate from PR #35's source and docs checks.

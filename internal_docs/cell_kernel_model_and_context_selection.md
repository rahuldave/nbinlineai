# Notebook cells, kernel state, and context selection

Version **0.1.8** introduced context selection; version **0.1.9** includes the improved control layout and check feedback. Both are published as of **2026-09-23**. The [feature brief](context_selection_next_feature.md) records the original design contract. The verification below describes the 0.1.8 pre-bump source checkout; see [releasing](releasing.md) for the separate 0.1.9 release gates.

## Two sources of truth

JupyterLab's ordered live model supplies cell IDs, source, metadata and order, including unsaved and offscreen cells. The kernel supplies actual live values and callable definitions. Neither reconstructs the other. Execution counts annotate code; they do not prove that today's source produced the current Python state. Moving or editing a cell changes the next source snapshot but does not undo Python execution.

An AI question and answer remain ordinary Markdown cells. `isPromptCell` marks questions; `isOutputCell`, `promptCellId` and status identify answers. A question is targeted by stable ID, never a remembered index or whichever tab becomes focused later. Keep answer controls execution, not context eligibility.

## Snapshot and request contract

`src/context.ts` traverses the complete cell model. New requests use `snapshot_version: 1`, ordered `notebook_cells`, `prompt_cell_id`, `context_mode` and per-cell `context_include` and `tools_include` booleans when saved. A cell contains ID, type, source, metadata and optional execution count, never outputs or attachments. Relative position is derived by the backend from this order. The current question is a separate required message.

Versioned snapshots accept at most 10,000 unique bounded cell IDs and 4,000,000 serialized characters; exceeding transport bounds fails explicitly instead of losing early tool declarations. Legacy requests with `preceding_cells` retain Default/above-only interpretation. Unknown versions request a frontend refresh.

Each queued AI run re-finds its own question and reads its current policy, settings and snapshot when its turn starts, before creating/clearing the answer. The transient preview target cannot redirect Run All. Later questions can therefore see answers or inserted notes completed earlier in that batch. An in-flight request retains its frozen snapshot; subsequent edits affect later runs.

## Selection and eligibility

| Mode | Candidate policy |
| --- | --- |
| Default | Preserve nearest-above ordinary source and complete earlier AI pairs; UI checks show budget inclusion. |
| Full notebook | Eligible cells on both sides. |
| All above | Eligible earlier cells, including independent AI source. |
| 10 above | Ten physical positions before the question. |
| 10 above + below | Ten physical positions on each side. |
| Custom | Saved per-cell candidates, absent choices inherit true. |
| Current question only (`current-only`) | No optional text; independent tool choices remain. |

Exclude the current question and **all** its linked answers by ID before counting the physical windows. Raw, empty and otherwise ineligible cells still take physical positions. A window never pulls an outside partner in to complete an AI pair.

Ordinary code and Markdown contribute source only. Running, error, cancelled and orphaned AI answers are ineligible. Default uses legacy pair-only history. In explicit modes, a question or completed answer selected independently is labeled AI notebook source. Complete pairs below or straddling the target are likewise source, never prior chat. Labels identify role, ID/link and above/below position.

Both cells must be selected and earlier, with the answer after its question, to form an atomic user/assistant history pair. The latest selected completed answer wins for duplicate links; additional selected answers can remain labeled source. Every answer linked to the current question stays excluded even if moved above it or duplicated.

## Saved choices and transient controls

Notebook `nbinlineai.defaults.contextMode` saves the policy. Per-cell `nbinlineai.contextInclude` saves Custom choices. A notebook initialization flag distinguishes initialized choices. First initialization writes flags for every existing cell in one shared-model transaction, preserving unrelated metadata. Existing ineligible cells keep their choice when later eligible; new cells and missing flags in imported Custom data inherit true. JupyterLab's normal move/delete/duplicate semantics apply.

Choosing Custom restores saved choices or initially seeds from the displayed selection. Changing a computed checkbox switches to Custom, seeds that preset's displayed set, then applies the click. Default partial cells become whole-cell candidates when seeding, subject to the same budget. Switching presets retains Custom choices.

The preview target is transient per panel. Selecting an AI question or linked answer updates it; clicking another cell's checkbox retains it. With no target, target-dependent controls are unavailable. Merely opening, selecting, rendering or previewing does not dirty the document. Widget decoration follows viewport/model lifecycle; model traversal remains the inventory.

## Tools remain independent

The user refined the brief during implementation: each declaring ordinary Markdown/AI question cell gets a separate Tools checkbox, saved as `nbinlineai.toolsInclude`, absent=true. Scan enabled earlier declaration cells plus the enabled current question for `&` references **before** prose selection. Custom text exclusion, preset windows, Current question only and budget omission do not revoke declarations. Code/raw/output/AI answers and below-question cells do not register tools. Wider modes do not change that rule. Users withdraw declarations by unchecking Tools on that cell, removing them or moving them below. Another enabled applicable cell can still declare the same tool. Per-cell tool choices persist across modes; newly added cells default true. A below-target Tools preference can be edited for later questions but remains inactive for the current target. Disabling a current question's Tools does not disable its `$` lookups or required text.

Only current-question `$` references resolve live values. The combined distinct reference cap remains 20; each run inspects names afresh. Missing functions produce useful errors rather than being silently withdrawn. Previously executed code may have affected the kernel regardless of selection. Explicitly offered read tools may retrieve other text during the run.

## Authoritative preview

Authenticated `POST nbinlineai/context-preview` shares request normalization, live reference preparation and `build_context` with execution. It uses kernel-execution authorization, an existing idle Python kernel, a bounded timeout and no provider key. It makes no provider request, invokes no offered tool body, inserts no answer and performs no document mutation. Python representation/introspection can itself run user-defined code; do not call it intrinsically side-effect-free.

Preview generations bind replies to the panel/model/session/kernel, question, source/order/metadata and effective settings. Edits and binding changes invalidate old reports, requests are coalesced, and **Details → Check context** permits explicit reinspection after live-state changes. In 0.1.9 the collapsed toolbar shows only the notebook-wide mode and Details; question target, transient progress/completion time, counts and help are inside Details. Missing/busy kernels and unresolved names are reported honestly. A preview is a first-round estimate, not a guarantee about later live state. Execution always reinspects, without requiring the user to run the check first.

For 0.1.9, a cell's available Context and Tools controls attach above its own source or rendered content, aligned with the text/editor. A linked AI answer has Context above its answer text but no Tools switch. Run/Cancel/Keep/Override follow the Context line above their own AI question; the targeted question shows a plain always-included label in place of an empty context checkbox. This removes the 0.1.8 ambiguity where a control at the foot of one cell could appear beside the next cell's content. Placement changes no snapshot, metadata or declaration semantics.

Reports distinguish selected candidates, eligible cells, mode/user exclusions, ineligible reasons, budget included/omitted/partial IDs, retained prefix/suffix, above/below counts, tools, characters and snapshot generation. These remain transient; later provider-round reports never overwrite saved choices.

## Character accounting and repeated tool rounds

The shared budget is 64,000 **characters**, not tokens. Count compact sorted-key JSON of normalized `msg2dict` messages plus tool schemas, with Unicode unescaped. Labels, wrappers, escaping and raw provider tool data count.

Account for tool schemas, fixed instructions/style, the expanded current question and completed tool groups first. Overflow stops before the provider call. Visit selected units nearest first, above winning equal-distance ties; a history pair uses its answer anchor. At the first boundary, source can retain a suffix above or prefix below, explicitly marked partial. History pairs remain whole. Stop rather than skipping to smaller distant units.

Restore source and pairs to notebook order within their representations. Re-budget the original snapshot before every provider round, preserving completed tool calls/results and never replaying their effects. A later round can omit more optional source/history. Fixed overflow and provider context rejection retain actionable errors; there is no automatic summarization or retry.

Model token capacity and output/reasoning reserves remain deferred. Provider output ceilings and cancellation semantics are unchanged. The two tool transports remain the server SSE/action-reply bridge and the execution-bound `insert_tools` Jupyter comm, described in [bundled tools](bundled_tools.md).

## Verification map

Python tests cover normalization, selection/history roles, physical windows, own-answer exclusion, tools independent of prose, exact accounting, partial regions, preview parity and endpoint authorization. Frontend tests cover model snapshots, mode resolution, Custom persistence and stale lifecycle. Isolated real-JupyterLab tests use deterministic providers and real kernels on 8897, including controls, fresh snapshots, save/reload and regressions for Keep, native execution and both tool protocols. The handoff records actual final run results.

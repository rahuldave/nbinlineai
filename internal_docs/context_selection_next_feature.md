# Next feature: notebook context selection

**Original design contract, 2026-09-23, for the feature released as 0.1.8.** The user requested the modes and per-cell controls; the detailed semantics below were engineering recommendations for that task. This is a historical brief, so consult the [developer handoff](developer_handoff.md) and [user guide](../docs/user-guide.md) for implemented behavior.

## User refinement during implementation

The user clarified that text selection and deliberate tool withdrawal need independent **per-cell** controls. This supersedes the original tool-permission deferral below: add a **Tools** checkbox to declaring ordinary Markdown/AI question cells, saved as `nbinlineai.toolsInclude`, default true. It filters declarations from that cell before introspection, including the current question. Duplicate declarations in other enabled applicable cells still offer their tool. Text omission never changes this saved preference; below declarations remain out of scope.

Add a seventh mode, **Current question only**, that selects no optional text while preserving Tools choices. It never re-enables a tool the user deliberately disabled. Original six modes remain. Both kinds of choices save with the notebook; the original Custom text initialization rules still apply.

## Request and feasibility

Add a notebook-wide **Context** dropdown: **Default**, **Full notebook**, **All above**, **10 above**, **10 above + below**, **Custom**. Add a compact **Include in AI context** checkbox to ordinary code/Markdown and AI question/answer cells. Custom lets the user choose cells; Default should show which earlier cells fit the automatic budget.

This is feasible with our existing JupyterLab extension. The frontend owns the complete live cell model and can add controls to cell widgets. It sees source/metadata/order even for offscreen and unsaved cells. Python kernel access is not needed to attach checkboxes. Kernel introspection is needed to calculate the current tool/value contribution to an accurate context estimate. See [the evidence and lifecycle assessment](context_selection_frontend_feasibility.md).

The inspected ai-jup commit has no analogous selection control. No ipylab dependency or new general-purpose frontend bridge is needed for this feature. Extend the current snapshot/context pipeline; preserve the two existing tool-action transports.

## Recommended UX contract

### The target question must be clear

The dropdown is a **notebook-wide saved policy**, but “above,” “below,” and Default's checked cells are relative to a particular AI question. Show a small header caption such as **Context for AI question 12**. Selecting an AI question sets that target; selecting its answer may target its linked question. Clicking a code/Markdown checkbox must retain the chosen question, even if JupyterLab moves selection. Do not silently retarget to an arbitrary nearby question. With no target, allow setting the notebook mode but show context preview as unavailable and disable target-dependent boxes until an AI question is chosen.

Keep the preview target in transient panel state, not saved metadata. Every actual run resolves its own prompt ID afresh when it reaches the execution queue; it never depends on whichever question is currently previewed. In Run All each AI question gets its own snapshot/policy resolution.

### Mode definitions

| Mode | Candidate cells and checkbox behavior |
| --- | --- |
| **Default** | Preserve 0.1.7's automatic nearest-above budget algorithm. Check the cells included by an authoritative first-round preview; show a partial cell as indeterminate with an explanation. Older omitted cells are unchecked. Do not save these computed checks into cell metadata. |
| **Full notebook** | Select eligible cells on both sides, except the current question and all of its linked answers. Check selected candidates; separately mark candidates that the budget omits or clips. “Full” is a scope, not unlimited model capacity. |
| **All above** | Explicitly select all eligible earlier cells. The same budget still applies. For ordinary source and complete AI pairs its scope/budget matches Default, but its boxes express the all-above candidate choice, not the automatic fitted subset. Explicit modes can additionally include standalone AI question/answer source as described below, so they are not guaranteed to produce identical requests. Explain the overlap and difference in the FAQ. |
| **10 above** | Select cells in the ten physical-cell positions before the target, then apply eligibility and budget. |
| **10 above + below** | Select the ten positions on each side, then apply eligibility and budget. |
| **Custom** | Use saved per-cell choices across the notebook. These are candidate choices; budget inclusion is separately visible. |

For physical windows, first remove the current question and its linked answers from the index sequence, then count up to ten cells on either side of the original question boundary. Raw/empty/other AI cells count as physical positions even when ineligible. Do not silently extend the window to find ten eligible cells. This convention avoids a generated answer consuming one of the “below” slots; document it with an example. A complete prior AI pair outside a window must not be pulled in merely because one of its cells is inside.

In explicit modes, a checked box means **selected for context**, not a guarantee the entire cell fits. Show adjacent/text-accessible states such as **omitted by budget** or **partial**. Keep totals for selected/included/omitted/partial. Default can use the actual preview inclusion as its computed check state because its purpose is automatic selection. Do not overload a checkbox to claim exact token usage.

Changing a box from a computed mode switches to **Custom**, seeds Custom from that displayed set, and applies the click. In Default, an indeterminate boundary cell becomes a selected whole-cell candidate when seeding Custom; the budget may still clip it. Entering Custom through the dropdown restores existing Custom choices if present, otherwise seeds from the currently displayed selection. Selecting another preset retains the saved Custom choices for later return. An explicit reset may discard them; do not discard edits silently.

Recommended persistence: notebook `nbinlineai.defaults.contextMode` and per-cell `nbinlineai.contextInclude` booleans. On first Custom initialization, write choices for **all existing cells** in one shared-model transaction, plus a notebook initialization flag: displayed selected cells get true; all others, including currently ineligible cells, get false. An existing empty/raw/incomplete cell that later becomes eligible retains its stored choice rather than silently joining the selection. Thereafter an absent flag on a newly inserted cell means **included** in Custom; use the same inherited true behavior for genuinely missing flags in imported/legacy Custom metadata, subject to eligibility. AI answers inherit the new-cell default but remain ineligible for their own question. Preserve all unrelated metadata. Alternative representations are acceptable if equivalent behavior and migration are tested.

Cell moves retain choices; deletion removes that model's choice; duplication follows JupyterLab's metadata-copy behavior with a fresh ID. Mode/Custom changes save with the notebook. Rendering, selection changes and preview do not dirty the notebook. Consider showing controls only after AI use/context UI activation so opening an unrelated notebook adds no visual clutter or metadata.

### Eligibility and AI cells

- Current question: separate required user message; show disabled **Current question** rather than suggesting it can be removed from its own request.
- Every answer linked to that current question: exclude by metadata ID even if moved above it or duplicated; disabled **Answer to this question**. Never feed an answer back to its own rerun as context.
- Ordinary code/Markdown: source only. No automatic code output, image, attachment, link fetch, or execution implied.
- Raw/empty cells: ineligible, disabled with explanation if a control is shown.
- Earlier complete AI pair with **both cells selected and both above**: preserve the existing user/assistant history representation and atomic budget unit. Pairing still uses IDs/status, with deterministic duplicate handling.
- To honor individual AI-cell choices, a selected AI question or completed answer without its selected partner can be included as **explicitly labeled notebook source** rather than a fabricated half conversation. A completed pair below, or a pair straddling the current question, likewise belongs to labeled source context, not earlier chat history. Clearly label AI question/answer, linked ID, and above/below position. Do not silently make such cells ordinary unlabelled Markdown.
- Running, failed, cancelled and orphaned AI **answers** remain ineligible; show why. An AI question without a completed answer may be selected as question source, except in legacy Default where current 0.1.7 eligibility should be preserved.

The independent-cell policy above is a deliberate extension beyond 0.1.7's pair-only history. It needs tests and public explanation. A simpler linked-checkbox policy was considered in the frontend research; it constrains the user's ability to choose individual AI cells. If independent selection proves too costly for this drop, raise that concrete scope tradeoff rather than silently ignoring a checked half-pair.

### Tool availability stays independent

Preserve 0.1.7 inheritance: scan **all earlier ordinary Markdown/AI questions**, plus current-question declarations, before context budgeting. Preset windows, Custom unchecking, and budget omission do not revoke those declarations. No new automatic declaration scope below the current question, even in Full notebook. This preserves the user's immediately preceding requirement that early tool registrations remain available to all later questions.

Show inherited tool names/count separately from prose selection and explain: **Context chooses text; Tools controls declarations.** Enabled declarations remain available when their text is excluded. Users withdraw declarations with the separate per-cell Tools checkbox, by removing them, or by moving them below (see the user refinement above). Do not accidentally derive schemas from only the selected text. Current `$` lookups remain current-question-only.

An excluded source cell can also have previously changed Python state, and explicit read tools can retrieve other text during the run. Context selection is not a kernel reset or a prohibition on those separately offered tools. Put these cases in the FAQ.

## Authoritative preview, budgeting, and reporting

The frontend cannot calculate Default's exact included set from raw source lengths. Tool schemas come from live signatures/docstrings; interpolated values, style instructions, JSON escaping and provider message wrappers affect the existing estimate. Current reports expose only counts. **Return stable included/omitted/partial cell IDs and reasons from the shared backend selector.**

Add a bounded authenticated preview path sharing request normalization, reference introspection and `build_context` logic with execution. It should need no provider key and make no provider request, call no offered tool body, insert no answer, and mutate no notebook. It may use the existing kernel introspection mechanism: do not claim that arbitrary Python `repr`/introspection is inherently side-effect-free. Respect execute authorization and a ready/idle kernel; do not silently launch a kernel or queue repeated preview requests behind busy code. With an unavailable kernel/reference, explain why a precise estimate is pending rather than display made-up final checks.

Use a preview generation/revision token bound to panel/model/kernel, target ID, source/order/metadata and effective settings. Discard stale replies after edits, mode/target changes, kernel restart, or disposal. Coalesce requests; provide a Refresh preview action and do not introspect on every scroll or keystroke. A preview is a **first-round estimate** of that snapshot, not a future-run promise. Live state can change elsewhere; execute always takes a fresh snapshot and introspects again. Later tool rounds use authoritative per-round reports as executed messages consume more budget. Do not persist inferred per-round checks as user choices.

Preserve fixed-material-first 64,000-character accounting, including schemas, expanded current question, instructions and completed tool traffic. Preserve source/history order when assembling messages and never replay tools. For modes including below cells, recommend nearest-distance priority with above winning ties. A prior pair's distance uses its answer anchor, preserving the old above-only order. For ordinary source at the boundary, keep a **suffix above** or a **prefix below**, with explicit partial labels. Stop at the first boundary, retaining whole history pairs only. Character counting must still match the actual normalized message/schema representation.

Separate these concepts in reports: snapshot cells, mode-selected cells, eligible candidates, user/mode-excluded cells, budget-included IDs, budget-omitted IDs, partial IDs (and retained region), ineligible reasons, above/below counts, schemas/tools, characters/budget, snapshot generation. Preserve bounded report sizes. Default's preview should include no-budget omissions versus ineligibility distinctions. Fixed-content overflow and provider context rejection retain actionable messages; this feature does not claim model-aware token guarantees.

## Request/API changes

Do not put below cells in `preceding_cells` or call them “preceding” in system text. Introduce a versioned ordered notebook snapshot with the current prompt ID, mode and explicit Custom choices; validate unique bounded cell IDs, roles, metadata, limits and selection membership. Derive relative positions from the submitted order, not an unverified per-cell `above` string. Preserve safe handling for old clients using `preceding_cells` or give explicit refresh/version guidance; never reinterpret old requests silently.

Keep enough **full preceding declaration information** to discover tools independently of selected prose. The existing 10,000-cell safety cap must not silently cut off tools/selection: if the accepted snapshot would exceed its transport bounds, report the limit. Consider total request size, not only cell count. Server authentication trusts an authorized browser's snapshot as data; it does not independently load unsaved notebook models.

Extend pure frontend selection helpers, backend request normalization/selection, context reports, and the notebook header. Prefer focused modules over further growing `src/index.ts`. Add lightweight cell controls using model metadata and supported widget/viewport lifecycle APIs; no DOM-only selection or notebook content-factory replacement just for a checkbox. Confirm supported APIs against the minimum JupyterLab 4.2, not just the installed 4.6.4.

## Acceptance tests and documentation

1. Pure mode resolution at notebook boundaries; exactly ten physical positions; stable IDs across move/delete/duplicate; Custom initialization/restoration/new-cell defaults; no dirty-on-open/preview.
2. Actual checkboxes on code, rendered/editing Markdown, AI question and AI answer; visible compact layout, accessible labels and keyboard operation; checkbox clicks keep the target question; offscreen scrolling/reattachment never loses state or duplicates controls.
3. Current prompt and all linked answers excluded wherever moved; independent AI choices labeled correctly; complete earlier history still paired; below AI text never enters prior assistant conversation; code outputs remain absent.
4. Tools declared far above remain offered under every mode and after unchecking their source; below declarations do not register; current `$` only. Missing function and restart guidance remain useful.
5. Backend first-round preview IDs and actual request agree on an unchanged snapshot, including huge schemas/values, escaping, Unicode, partial cells and overflow. Preview makes zero provider/tool-body calls. Busy/missing kernel, stale/overlapping preview, kernel restart and panel close handled.
6. Per-round rebudgeting retains tool groups; new below-source priority/partial-prefix tests; selection exclusion versus budget omission reported distinctly. Old-client compatibility validated.
7. Real isolated JupyterLab with real Python kernel and deterministic provider: six modes, Custom save/reload, two tabs/notebooks, Run All snapshots at each question, Keep overrides, edits after preview, cell insertions by tools/`insert_tools`, cancellation. Never use port 8888.
8. Update README (max two images), illustrated user guide, FAQ, architecture, relevant example notebook, and internal context/protocol/handoff notes. Explain Default versus All above, full-but-budget-limited, checkmarks versus actual use, below AI source, tool independence, preview staleness, kernel state and saved metadata. Capture screenshots in isolated fixtures.

This brief is retained as the implementation contract. See the current developer handoff for verification results. [Copyable task prompt](context_selection_task_prompt.md).

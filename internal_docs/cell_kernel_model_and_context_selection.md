# Notebook cells, kernel state, and context selection

This note records the current data flow and the decisions needed before adding context-selection controls. Current behavior describes **0.1.7** (2026-09-23); the future modes below are design options, not implemented behavior.

## Two models of the notebook

The **notebook model** is JupyterLab's ordered, editable collection of cells. Each cell has a stable ID, type, source, and metadata. A code cell can also have an execution count and saved outputs. `src/context.ts` reads `INotebookModel.cells` and `cell.sharedModel.getSource()`, rather than rendered cell widgets. This matters for windowed notebooks: cells outside the viewport still have models and are included. The snapshot contains current in-memory edits even if the `.ipynb` file has not been saved. Conversely, a saved file on disk may lag the browser model. The `source` is text; execution count is an annotation, not proof that the present source produced the current kernel state. See [`src/context.ts`](../src/context.ts), [`src/index.ts`](../src/index.ts), and JupyterLab's `INotebookModel` in `node_modules/@jupyterlab/notebook/src/model.ts`.

The **kernel runtime** is the Python process attached to the notebook session. Its namespace reflects actual execution, which may be out of order, repeated, interrupted, or performed in cells now deleted or below the prompt. Restarting the kernel clears those live definitions without erasing notebook source or saved answers. The browser sends `panel.sessionContext.session?.id`; the server resolves that notebook session to its active Python kernel before running introspection or tools. A later tool call checks that the same session still points to the same kernel object. See [`nbinlineai/kernel.py`](../nbinlineai/kernel.py) and [`nbinlineai/handlers.py`](../nbinlineai/handlers.py).

Thus “above” and “below” are positions in the **current notebook model order**, not execution order, execution-count order, physical screen position, or kernel namespace membership. The active cell is used by the Insert/Run/Cancel UI commands to choose a target. Once chosen, the prompt's cell ID identifies it; the active-cell index does not determine its context. A move changes the index and therefore the next snapshot's above/below partition while preserving the ID. The linked answer is a separate Markdown cell carrying `metadata.nbinlineai.isOutputCell` and `promptCellId` equal to that prompt's ID; it can be found after a move. See `getCell`, `findOutput`, `ensureOutput`, `insertPrompt`, and command registration in [`src/index.ts`](../src/index.ts).

## Current request path

1. A Markdown cell marked `metadata.nbinlineai.isPromptCell` is selected for execution. The native notebook executor receives a cell model and passes its ID to `runPrompt`; a direct AI command obtains the active cell's ID. The per-notebook queue orders normal and AI cell tasks, and the AI task runs `executePrompt` when its turn arrives. See [`src/index.ts`](../src/index.ts) and [`src/executionQueue.ts`](../src/executionQueue.ts).
2. `executePrompt` re-finds that ID in the current notebook model, reads its current source, gets the notebook session ID, resolves provider/model/style/effort from cell, notebook, and user settings, then calls `precedingCells(notebook, promptId)`. This is the context snapshot point. It happens **before** `ensureOutput` inserts or clears the linked answer. A retained completed answer may cause the run to return early without a request. See [`src/index.ts`](../src/index.ts) and [`src/defaults.ts`](../src/defaults.ts).
3. `precedingCells` walks model indices `0, 1, ...` until it finds the prompt ID. It returns every earlier cell, including raw and AI cells, each with `id`, `cell_type`, current `source`, and `metadata`; code cells also carry `execution_count`. It excludes the current prompt and every cell after it. If the prompt was deleted before collection, it errors. See [`src/context.ts`](../src/context.ts).
4. The browser POSTs `prompt`, `prompt_cell_id`, `session_id`, `preceding_cells`, provider/model/tool limit, style, and optional style instructions/effort to `/nbinlineai/prompt`. The server authenticates and authorizes kernel execution, validates the body, resolves the session and Python kernel, and streams events. It does **not** independently fetch a notebook document or prove that the submitted cells are physically above the prompt; the browser-provided snapshot defines this context. See [`src/index.ts`](../src/index.ts), [`nbinlineai/handlers.py`](../nbinlineai/handlers.py), and [`nbinlineai/prompt.py`](../nbinlineai/prompt.py).
5. The server discovers inherited tools before text selection, then budgets schemas and fixed messages first. It selects nearest preceding ordinary source and complete AI pairs under one character limit. Selected source goes into the system instruction; selected pairs become user/assistant history. The expanded current question follows, then any tool conversation from this run. Both API backends receive these messages. See [`nbinlineai/prompt.py`](../nbinlineai/prompt.py) and [`nbinlineai/providers.py`](../nbinlineai/providers.py).

Equivalent boundary logic, simplified:

```text
prompt_id = selected_ai_cell.id                  # stable identity
wait_for_this_notebook's earlier queued tasks
prompt = find_model_cell_by_id(prompt_id)
preceding = []
for cell in notebook_model.cells_in_current_order:
    if cell.id == prompt_id: break               # index is recomputed now
    preceding.append(current_source_and_metadata(cell))
send(prompt.source, prompt_id, session_id, preceding)

server:
    tools = deduplicate(current_question_tools + markdown_question_tools(preceding))
    live_refs = inspect_current_kernel(current_question_variables, tools)
    units = nearest_first_source_cells_and_completed_pairs(preceding)
    for each provider round:
        fixed = schemas + system_style + expanded_question + completed_tool_messages
        selected = take_nearest_units_until_character_budget(units, fixed)
        model_messages = assemble_in_original_order(selected, fixed)
```

The source and history filters deliberately differ:

| Input | Present handling |
| --- | --- |
| Ordinary code source above | Included in notebook order, labeled with ID and execution count. May be unexecuted or stale. |
| Ordinary Markdown source above | Included in notebook order, labeled with ID. Links and image syntax remain text. |
| Raw cell above | Sent by browser, excluded from model messages. |
| AI prompt/answer cells above | Excluded from ordinary source. A prompt and linked answer become user/assistant history only when both occur in the submitted set and the answer status is `done` (legacy missing status also counts). Orphan, running, failed, and cancelled answers are excluded. The linked cells need not be adjacent. |
| Current prompt | Sent separately as the final user message; never part of `preceding_cells`. |
| Cells below | Not sent. Their code can still have affected the kernel if it was previously executed. |
| Code outputs, rich media, Markdown attachments, files | Not in this request. The browser sends source/metadata/count, not code output arrays, image bytes, attachment content, or file contents. No link or image fetch occurs. |

The backend recognizes current AI metadata flags and older aliases in `context_budget.ai_role`; `eligible_units` pairs answer `promptCellId` with an earlier prompt ID inside the submitted set. An output cell's content therefore does not become source context merely because it is Markdown. See [`nbinlineai/prompt.py`](../nbinlineai/prompt.py). The browser updates answer status to `running`, `done`, `error`, or `cancelled`, so a partial failed response is not later replayed as a completed assistant turn. See [`src/index.ts`](../src/index.ts).

## Tool discovery before context selection

The server scans the entire accepted preceding snapshot for `&` followed by a backtick-quoted Python identifier in ordinary Markdown and AI question cells. It combines these names with current-question declarations and deduplicates them. AI answers (including manually edited answers), code/raw cells, code outputs, and later cells do not declare tools. Classification favors response metadata if a malformed cell carries both roles. Quotations and fenced code are scanned too; no special shared-note metadata is required. Earlier declaration cells need not have run and Keep answer does not disable their declarations.

Only `$` references in the current question trigger variable interpolation. Up to 20 distinct variable/tool names combined are allowed, including inherited tools. Each run inspects named functions afresh in `get_ipython().user_ns`; a missing function fails clearly instead of silently withdrawing the tool. A changed definition must be executed before it changes the live callable. Names are not reconstructed by executing the notebook's source. Ordinary calls remain bound to the same session/kernel, signature checks, and allowlist.

Tool discovery is independent of text selection: old declarations still expose schemas when their prose is omitted. A normal Markdown note inserted by a tool is eligible on a later run too. There is currently no per-question tool-disable override; removing or moving all relevant declarations changes the next run. Sources: [`nbinlineai/prompt.py`](../nbinlineai/prompt.py), [`nbinlineai/context_budget.py`](../nbinlineai/context_budget.py), [`nbinlineai/kernel.py`](../nbinlineai/kernel.py).

## Nearest-first character budget

Validation permits 10,000 preceding cells, counting all types, up to 16,000 characters in the original question, and up to 8,000 characters in custom style instructions. The old 200-cell cap and separate 50,000-source / 16,000-history budgets were replaced in 0.1.7. The high cell limit bounds transport and validation; it does not select a 10,000-cell model context.

`context_budget.build_context` uses a shared 64,000-character estimate. Accounting is the compact, sorted-key JSON length of the tool-schema list plus the compact JSON length of the normalized `msg2dict` message list, with Unicode unescaped. Array brackets/separators, message roles, content wrappers, escaped characters, source labels, and preserved raw provider tool data count. It is not a byte count, exact provider payload length, or token count.

Selection proceeds as follows:

1. Account for tool schemas first, then fixed system/style text, the current question **after** variable interpolation, and all executed assistant/tool message groups. Each variable representation is bounded to 2,000 characters, but repeated references can repeat it. If fixed material alone exceeds the budget, stop before making that provider call.
2. Form eligible units from nonempty ordinary code/Markdown cells and completed AI prompt/answer pairs. Each source unit counts as one physical cell; each pair counts as two. A pair is anchored at its answer's position, even if the prompt and answer are nonadjacent. The latest completed answer wins for duplicate links.
3. Visit units by descending anchor position: nearest preceding first across both source and history. Include whole units while they fit. At an ordinary-source boundary, include the largest nonempty suffix that fits with a partial-source label; its top is omitted. At a pair boundary, omit the entire pair. Stop at that boundary; do not skip to smaller older units.
4. Restore selected source and selected AI pairs to chronological order. Source appears in the system context; pairs appear as user/assistant messages. Current question and executed tool groups follow.
5. Repeat the budget pass before every provider call from the same frozen snapshot. Accumulated tool traffic can reduce the retained window further. Completed tool call/result groups remain intact and their side effects are not replayed by selection.

An oversized most-recent pair can leave no earlier notebook context even if older units would fit. A partial code cell is labeled source, not a runnable snippet. Selection never modifies the actual notebook. The chosen source/history representation remains split, although the selection budget is shared.

The per-round context event reports `cell_count` (included physical cells), `preceding_cell_count` (all submitted cells), `omitted_cell_count` (eligible physical cells excluded), `partial_cell_count`, source/history truncation, character budget/use, schema characters, and tool names. Partial cells count as included; raw, empty, and incomplete/orphan AI cells are ineligible rather than budget-omitted. The frontend retains a trimmed indication if any round trims and shows a detailed tooltip. This report is transient browser state; it is not saved as a per-run transcript. See [`src/contextStatus.ts`](../src/contextStatus.ts).

## Overflow and remaining limits

This implementation does not use model tokenizers, provider-specific input capacity, or an output/reasoning reservation. `providers.complete` still passes an output ceiling of 16,384 normally, 32,768 for effective `high` effort, or 65,536 for `xhigh`/`max`, with `retries=0`. nbinlineai calls FastLLM's low-level `acomplete`, not its higher-level chat orchestration. Character accounting cannot guarantee that any particular provider/model accepts the request.

Fixed-material overflow has an actionable local error. Recognized provider context overflow has a specific sanitized message; unclassified provider errors can still be generic. No rejected provider call is automatically retried or summarized. An output `finish_reason == "length"` is a distinct failure. Errors mark the answer incomplete and stop the current execution batch; partial text can remain, completed effects remain, and failed exchanges do not become history. Tool results remain bounded per call and the existing round count still applies.

Future model-aware budgeting needs an explicit capacity policy for custom models and provider conversion overhead, plus room for output/reasoning. Any later compaction or summarization must preserve valid tool groups and avoid replaying effects. Sources: [`nbinlineai/providers.py`](../nbinlineai/providers.py), [`nbinlineai/handlers.py`](../nbinlineai/handlers.py), and the public [FAQ](../docs/faq.md#how-does-nbinlineai-choose-context-when-the-notebook-is-large).

## Questions for future context controls

**Next-task update (2026-09-23):** the user has now requested six notebook-wide context modes and per-cell checkboxes. The [feature brief](context_selection_next_feature.md) supplies recommended resolutions of the questions below; the [frontend assessment](context_selection_frontend_feasibility.md) verifies access to every cell model/widget, and the [task prompt](context_selection_task_prompt.md) carries the work to a new task. These are not shipped yet. The 0.1.7 behavior above remains the implementation baseline.

### Selection modes

The proposed controls are: per-cell include/ignore toggles, whole notebook, ten cells either side of the prompt, and all preceding cells. They need one coherent definition of *selection* before the shared source/history budget. The current `preceding_cells` contract and system instruction explicitly mean “above”; sending later cells under that field/instruction would mislabel them. There is no selection implementation here.

| Mode or control | Feasibility and choices to resolve |
| --- | --- |
| All preceding | Matches current discovery and the candidate snapshot. The nearest-first budget can omit older text. Future ignore switches must define separately whether they affect prose, history, tool declarations, or all three; hiding prose currently does not withdraw a tool. |
| Ten cells above and ten below | Recompute the prompt index from its ID at snapshot time; clamp at notebook ends and preserve notebook order. Define whether “ten” counts physical cells (including raw/AI prompt/answer), only eligible source cells, or logical AI prompt/answer pairs. Also define whether the current prompt occupies one of the 21 positions. These choices produce visibly different windows. |
| Whole notebook | Can enumerate all cell models despite viewport virtualization, but needs an honest large-notebook policy. The shared character budget still requires selection on large notebooks, and 10,000 cells is a transport safety cap. A whole-notebook mode must define distance/priority on both sides and keep reporting omitted/partial material. A label saying “whole” should never imply unlimited capacity. |
| Per-cell include/ignore | Decide scope: ordinary source, AI history, or both; default/inheritance from notebook-level setting; persistent cell metadata versus a temporary per-run choice; and whether the current prompt can be toggled. A saved default must specify what newly inserted cells inherit. Any disabled cell should be counted/reported consistently with each mode and budget. |

All future modes should explicitly remove the **current prompt by ID** and its **linked answer by `promptCellId`**, wherever the answer was moved. The current answer may be completed from a prior run; it must not become source or prior history for its own rerun. Continue classifying every AI-marked cell before treating Markdown as ordinary source. An ignored or future AI answer must not slip into the system source merely because the pair is incomplete or history is disabled.

Including cells **below** the prompt also introduces a history question. A later AI prompt/answer pair must not silently become an earlier assistant exchange: that reverses conversation roles and can leak a “future” answer into this turn. Reasonable alternatives are excluding later AI cells, or including selected later AI source in a distinctly labeled notebook section without assigning prior-chat roles. This needs product choice, as does treatment of later ordinary code/Markdown: present it as later *source*, never as proof of execution or as earlier context. The kernel may already contain effects from those cells regardless of selection.

Selection and execution are separate clocks. For each run, identify the prompt by stable ID and take a coherent model snapshot when that queued task starts. A user can edit, move, delete, or rerun cells while a provider request is in flight; the in-flight request uses its already-collected text, and a later run can see a different order/source. A sequence such as Run All can create completed answer cells before a later AI prompt's snapshot, so the later prompt sees those pairs through ordinary current history rules. Per-notebook queuing orders extension-managed cell tasks, but it does not freeze all browser edits or kernel activity elsewhere. Any future selection UI should say when its preview/count was computed and avoid relying on an active-cell index captured earlier. See [`src/executionQueue.ts`](../src/executionQueue.ts) and [`src/index.ts`](../src/index.ts).

Implementation should retain separate, observable counts for selected cells, excluded cells, included source, included AI pairs, and truncation/failure. A revised request would need to state the selection boundary and how later cells are labeled, rather than having the server infer it from a list still called `preceding_cells`. The exact wire shape, defaults, history policy, and large-notebook strategy should follow user decisions on the questions above.

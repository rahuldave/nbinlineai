# Notebook cells, kernel state, and context selection

This note records the current data flow and the decisions needed before adding context-selection controls. It describes the implementation as it stands; the future modes below are design options, not implemented behavior.

## Two models of the notebook

The **notebook model** is JupyterLab's ordered, editable collection of cells. Each cell has a stable ID, type, source, and metadata. A code cell can also have an execution count and saved outputs. `src/context.ts` reads `INotebookModel.cells` and `cell.sharedModel.getSource()`, rather than rendered cell widgets. This matters for windowed notebooks: cells outside the viewport still have models and are included. The snapshot contains current in-memory edits even if the `.ipynb` file has not been saved. Conversely, a saved file on disk may lag the browser model. The `source` is text; execution count is an annotation, not proof that the present source produced the current kernel state. See [`src/context.ts`](../src/context.ts), [`src/index.ts`](../src/index.ts), and JupyterLab's `INotebookModel` in `node_modules/@jupyterlab/notebook/src/model.ts`.

The **kernel runtime** is the Python process attached to the notebook session. Its namespace reflects actual execution, which may be out of order, repeated, interrupted, or performed in cells now deleted or below the prompt. Restarting the kernel clears those live definitions without erasing notebook source or saved answers. The browser sends `panel.sessionContext.session?.id`; the server resolves that notebook session to its active Python kernel before running introspection or tools. A later tool call checks that the same session still points to the same kernel object. See [`nbinlineai/kernel.py`](../nbinlineai/kernel.py) and [`nbinlineai/handlers.py`](../nbinlineai/handlers.py).

Thus “above” and “below” are positions in the **current notebook model order**, not execution order, execution-count order, physical screen position, or kernel namespace membership. The active cell is used by the Insert/Run/Cancel UI commands to choose a target. Once chosen, the prompt's cell ID identifies it; the active-cell index does not determine its context. A move changes the index and therefore the next snapshot's above/below partition while preserving the ID. The linked answer is a separate Markdown cell carrying `metadata.nbinlineai.isOutputCell` and `promptCellId` equal to that prompt's ID; it can be found after a move. See `getCell`, `findOutput`, `ensureOutput`, `insertPrompt`, and command registration in [`src/index.ts`](../src/index.ts).

## Current request path

1. A Markdown cell marked `metadata.nbinlineai.isPromptCell` is selected for execution. The native notebook executor receives a cell model and passes its ID to `runPrompt`; a direct AI command obtains the active cell's ID. The per-notebook queue orders normal and AI cell tasks, and the AI task runs `executePrompt` when its turn arrives. See [`src/index.ts`](../src/index.ts) and [`src/executionQueue.ts`](../src/executionQueue.ts).
2. `executePrompt` re-finds that ID in the current notebook model, reads its current source, gets the notebook session ID, resolves provider/model/style/effort from cell, notebook, and user settings, then calls `precedingCells(notebook, promptId)`. This is the context snapshot point. It happens **before** `ensureOutput` inserts or clears the linked answer. A retained completed answer may cause the run to return early without a request. See [`src/index.ts`](../src/index.ts) and [`src/defaults.ts`](../src/defaults.ts).
3. `precedingCells` walks model indices `0, 1, ...` until it finds the prompt ID. It returns every earlier cell, including raw and AI cells, each with `id`, `cell_type`, current `source`, and `metadata`; code cells also carry `execution_count`. It excludes the current prompt and every cell after it. If the prompt was deleted before collection, it errors. See [`src/context.ts`](../src/context.ts).
4. The browser POSTs `prompt`, `prompt_cell_id`, `session_id`, `preceding_cells`, provider/model/tool limit, style, and optional style instructions/effort to `/nbinlineai/prompt`. The server authenticates and authorizes kernel execution, validates the body, resolves the session and Python kernel, and streams events. It does **not** independently fetch a notebook document or prove that the submitted cells are physically above the prompt; the browser-provided snapshot defines this context. See [`src/index.ts`](../src/index.ts), [`nbinlineai/handlers.py`](../nbinlineai/handlers.py), and [`nbinlineai/prompt.py`](../nbinlineai/prompt.py).
5. The server makes two distinct message components from `preceding_cells`: ordinary source context in the system instruction, and prior completed AI exchanges as user/assistant history. It appends the current prompt as the final user message. Both API backends receive these messages. See [`nbinlineai/prompt.py`](../nbinlineai/prompt.py) and [`nbinlineai/providers.py`](../nbinlineai/providers.py).

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
    source = ordinary_code_and_markdown(preceding)  # no AI/raw cells
    history = completed_ai_prompt_answer_pairs(preceding)
    live_refs = inspect_current_kernel(prompt.$names, prompt.&functions)
    model_messages = [system(source, style), *history, user(prompt_with_live_refs)]
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

The backend recognizes current AI metadata flags and older aliases in `_ai_role`; `_history` pairs answer `promptCellId` with an earlier prompt ID inside the submitted set. An output cell's content therefore does not become source context merely because it is Markdown. See [`nbinlineai/prompt.py`](../nbinlineai/prompt.py). The browser updates answer status to `running`, `done`, `error`, or `cancelled`, so a partial failed response is not later replayed as a completed assistant turn. See [`src/index.ts`](../src/index.ts).

## Bounds and live references

Current validation accepts at most **200 `preceding_cells`**, counting all sent cells before the source/history filters, and at most **16,000 characters** in the current prompt. Ordinary code and Markdown share a **50,000 source-character** budget. `_source_context` walks oldest to newest, may cut the cell at the boundary, then stops; its `source_truncated` count is emitted in the `context` event. This is a source-text count, not a complete accounting of labels, metadata, tokens, or network request size. AI history has a separate **16,000-character** budget for prompt-plus-answer source: it takes recent complete pairs that fit and emits them chronologically. Style instruction overrides allow up to 8,000 characters. See constants, validation, `_source_context`, `_history`, and `run_prompt` in [`nbinlineai/prompt.py`](../nbinlineai/prompt.py).

Only explicit references in the **current prompt** trigger live introspection: `$` followed by a backtick-quoted Python identifier inserts a bounded `repr` (2,000 characters per value); `&` followed by a backtick-quoted identifier registers a callable as a model tool. There can be at most 20 distinct referenced names combined. These names are looked up in the current Python kernel, not reconstructed by executing notebook source. A tool invocation is bound to the same session/kernel and allowlist, accepts a small JSON object, and returns at most 4,000 characters of captured stdout plus result representation. Supported tool functions are synchronous and callable with keyword arguments. No cell outputs or images are implicitly inspected. See [`nbinlineai/prompt.py`](../nbinlineai/prompt.py), [`nbinlineai/kernel.py`](../nbinlineai/kernel.py), and [`nbinlineai/tool_schema.py`](../nbinlineai/tool_schema.py).

## Questions for future context controls

The proposed controls are: per-cell include/ignore toggles, whole notebook, ten cells either side of the prompt, and all preceding cells. They need one coherent definition of *selection* before source and history budgets. The current `preceding_cells` contract and system instruction explicitly mean “above”; sending later cells under that field/instruction would mislabel them. There is no selection implementation here.

| Mode or control | Feasibility and choices to resolve |
| --- | --- |
| All preceding | Matches the current model-order traversal. Decide whether ignored cells are omitted before the 200-cell request cap and whether prior AI history remains independent of a source-ignore toggle. The current 50k budget means “all” is not literally all on large notebooks. |
| Ten cells above and ten below | Recompute the prompt index from its ID at snapshot time; clamp at notebook ends and preserve notebook order. Define whether “ten” counts physical cells (including raw/AI prompt/answer), only eligible source cells, or logical AI prompt/answer pairs. Also define whether the current prompt occupies one of the 21 positions. These choices produce visibly different windows. |
| Whole notebook | Can enumerate all cell models despite viewport virtualization, but needs an honest large-notebook policy. The current 200-cell validation and oldest-first 50k source truncation can reject or silently omit material. Options include an explicit too-large error, a visible included/truncated count, or a different budget/selection policy. A label saying “whole” should never hide those limits. |
| Per-cell include/ignore | Decide scope: ordinary source, AI history, or both; default/inheritance from notebook-level setting; persistent cell metadata versus a temporary per-run choice; and whether the current prompt can be toggled. A saved default must specify what newly inserted cells inherit. Any disabled cell should be counted/reported consistently with each mode and budget. |

All future modes should explicitly remove the **current prompt by ID** and its **linked answer by `promptCellId`**, wherever the answer was moved. The current answer may be completed from a prior run; it must not become source or prior history for its own rerun. Continue classifying every AI-marked cell before treating Markdown as ordinary source. An ignored or future AI answer must not slip into the system source merely because the pair is incomplete or history is disabled.

Including cells **below** the prompt also introduces a history question. A later AI prompt/answer pair must not silently become an earlier assistant exchange: that reverses conversation roles and can leak a “future” answer into this turn. Reasonable alternatives are excluding later AI cells, or including selected later AI source in a distinctly labeled notebook section without assigning prior-chat roles. This needs product choice, as does treatment of later ordinary code/Markdown: present it as later *source*, never as proof of execution or as earlier context. The kernel may already contain effects from those cells regardless of selection.

Selection and execution are separate clocks. For each run, identify the prompt by stable ID and take a coherent model snapshot when that queued task starts. A user can edit, move, delete, or rerun cells while a provider request is in flight; the in-flight request uses its already-collected text, and a later run can see a different order/source. A sequence such as Run All can create completed answer cells before a later AI prompt's snapshot, so the later prompt sees those pairs through ordinary current history rules. Per-notebook queuing orders extension-managed cell tasks, but it does not freeze all browser edits or kernel activity elsewhere. Any future selection UI should say when its preview/count was computed and avoid relying on an active-cell index captured earlier. See [`src/executionQueue.ts`](../src/executionQueue.ts) and [`src/index.ts`](../src/index.ts).

Implementation should retain separate, observable counts for selected cells, excluded cells, included source, included AI pairs, and truncation/failure. A revised request would need to state the selection boundary and how later cells are labeled, rather than having the server infer it from a list still called `preceding_cells`. The exact wire shape, defaults, history policy, and large-notebook strategy should follow user decisions on the questions above.

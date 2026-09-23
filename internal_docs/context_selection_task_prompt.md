# Task prompt: selectable notebook context

Original task prompt, retained as design history. The feature is now implemented in source; the brief records the user's later addition of independent per-cell Tools controls and Current question only mode. Use the current handoff for implementation status.

---

Implement notebook context selection for **nbinlineai**, starting from the current checkout. Read `AGENTS.md`, `internal_docs/README.md`, `internal_docs/developer_handoff.md`, `internal_docs/context_selection_next_feature.md`, and `internal_docs/context_selection_frontend_feasibility.md` first. Also read the current cell/kernel/context and bundled-tools protocol notes. Version 0.1.7 is already published; these selection controls are not implemented yet.

Be the orchestrator and use **gpt-6-sol** subagents for bounded coding work with explicit ownership. Use uv and our isolated JupyterLab test harness; never touch the user's server on **8888** or expose real credentials.

Add **Context** to the notebook defaults row with **Default, Full notebook, All above, 10 above, 10 above + below, Custom**. Add compact, accessible **Include in AI context** checkboxes to code, ordinary Markdown, AI questions and AI answers. We have access to all their models/widgets, including offscreen cells; use that access without scraping rendered text. The controls must survive moves, saves, reloads, Markdown rendering and notebook virtualization.

Follow the detailed recommended semantics in `context_selection_next_feature.md`. In particular:

- Default preserves the current nearest-above algorithm and shows the backend-estimated included cells checked; partial cells are visibly partial. Explicit modes select candidates, with separate omitted/partial budget feedback. Changing a computed checkbox switches to Custom and seeds its choices. Preserve Custom choices and define new-cell behavior as in the brief.
- Make clear which AI question is being previewed. Clicking another cell's checkbox retains that target. Execution always uses the ID of the question actually running and a fresh queued snapshot; Keep and native Run All must continue working.
- Use a shared authenticated backend preview/selection path with included/omitted/partial **cell IDs**, not a competing frontend character estimator. No provider request, offered tool call, answer insertion, or notebook mutation during preview. Handle unavailable/busy kernels and stale preview responses honestly.
- Extend the wire contract and system labels for cells below. Exclude the current question and all its linked answers everywhere. Earlier complete selected pairs remain history; independently selected or later AI material must be clearly labeled source, never fabricated prior chat. Preserve status/eligibility rules in the brief.
- Keep inherited tools independent of selected prose: declarations in all earlier ordinary Markdown/AI questions remain available even when those cells are unchecked or trimmed. Never register declarations below merely because a wider mode includes their text. Show tools separately; only current-question `$` values are resolved.
- Preserve tools/fixed-material-first budgeting and the 64,000-character limit. All modes remain budgeted; do not imply unlimited context or exact token counts. Re-budget every provider round without replaying completed effects.
- Preserve the existing SSE/action-reply and `insert_tools` comm protocols and their origin binding. No ipylab dependency, broad cell execution tools, or ChatGPT sign-in work is needed.

Add meaningful Python, frontend unit and isolated real-JupyterLab browser tests for the acceptance cases in the brief. Update illustrated public docs, FAQ, architecture, examples and internal handoff notes. Start with focused tests, then run the relevant release gates. Make commits as you work. Report what changed, verification and any concrete remaining limitation. If an API or product constraint requires departing from the brief, explain it and resolve the smallest necessary question; do not silently omit a requested mode or per-cell control.

# Working on nbinlineai

## Start here

Read [the internal documentation index](internal_docs/README.md), then [the current handoff](internal_docs/developer_handoff.md). They distinguish shipped behavior from historical research and future proposals. Do not infer current behavior from an older release's design note.

For context selection, read [the next-feature brief](internal_docs/context_selection_next_feature.md), [the frontend feasibility assessment](internal_docs/context_selection_frontend_feasibility.md), and [the cell/kernel model](internal_docs/cell_kernel_model_and_context_selection.md). The ready-to-use task prompt is [here](internal_docs/context_selection_task_prompt.md). These context controls are proposed, not shipped in 0.1.7.

For tools or browser operations, read [the implemented tool and protocol contract](internal_docs/bundled_tools.md). Upstream research is in [the dialoghelper catalog](internal_docs/dialoghelper_tool_catalog.md), [the ipylab assessment](internal_docs/ipylab_frontend_bridge_assessment.md), and [the ai-jup analysis](internal_docs/ai_jup_research_and_design.md).

## Project constraints

- Use **uv** and this repository's environment. Use `uv run --no-sync jlpm ...` for the frontend after setup. See [Development](docs/development.md) for bootstrap and commands.
- **Do not use, stop, restart, or test against the user's JupyterLab on port 8888.** Browser tests own an isolated server on 8897, use temporary notebooks/config/keys, and refuse 8888. Stop only servers you started.
- Never print or commit `.env`, `.pypirc`, provider keys, credential JSON contents, browser tokens, or personal notebook data. Use deterministic provider tests by default. Live tests incur API charges.
- Preserve GPL-3.0-only, matching ai-jup. Upstream research does not authorize copying differently licensed code without following its license.
- The user's development preference is an orchestrator with **gpt-6-sol** subagents for coding. Delegate bounded independent work with explicit file ownership when useful; tell workers they share the checkout and must preserve others' changes. Do not start extra user-owned tasks unless requested.
- Keep user-facing notebook controls compact and explain behavior in familiar language. README: at most two screenshots. Public user docs/FAQ/architecture belong in `docs/`; implementation research, handoffs, and release records belong in `internal_docs/`.
- `internal_docs/` is committed in the public GitHub repository; it is excluded from the documentation site and package archives. It is **not secret storage**.

## Invariants to preserve

- Cell order/source/metadata come from the live JupyterLab model, including unsaved and offscreen cells; values/functions come from the bound live Python kernel. Never infer one from the other.
- AI questions and answers are ordinary Markdown cells distinguished by `metadata.nbinlineai`. Keep answer controls execution, not whether completed earlier answers can supply context.
- Native Run All/Shift+Enter use our public `INotebookCellExecutor` integration and per-notebook queue. Respect notebook Keep defaults, per-question overrides, cancellation, and error stop behavior.
- Tool declarations in the current question and all earlier ordinary Markdown/AI questions are discovered **before** context trimming. AI answers/code/raw/output do not declare tools. Only current-question `$` references look up live values.
- Fixed instructions/current prompt/tool schemas/executed tool groups are budgeted before optional notebook context. The 64,000 limit is a **character estimate**, not a model-token guarantee. Never replay tool effects during re-budgeting.
- Browser operations must remain bound to the originating document/model/session/kernel and stable cell IDs; changing focus cannot redirect them. An insertion acknowledgement means changed live document, not saved file.
- There are two distinct transports: authenticated server SSE/action-reply for model tools, and execution-bound Jupyter comms for `insert_tools()`. Do not block or nest the kernel event loop waiting on itself.
- Use shared-model metadata updates that preserve unrelated fields. Merely opening, selecting, previewing, or rendering a notebook should not dirty it.

## Verification and release

Use meaningful tests at the changed boundaries: Python, frontend unit tests, then a real isolated JupyterLab with a real kernel and deterministic provider. After frontend changes, rebuild and relink before browser tests. Never build package assets concurrently with browser tests.

See [the handoff](internal_docs/developer_handoff.md) for commands and known test pitfalls; see [the release checklist](internal_docs/releasing.md) for packaging, clean-install checks, versions, artifacts, and publication records. Do not hand-edit generated `lib/` or prebuilt labextension files. Update public docs/examples when semantics change, and keep these handoff notes current.

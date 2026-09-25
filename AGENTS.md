# Working on nbinlineai

## Start here

Read [the internal documentation index](internal_docs/README.md), then [the current handoff](internal_docs/developer_handoff.md). They distinguish shipped behavior from historical research and future proposals. Do not infer current behavior from an older release's design note.

For context selection, read [the original feature brief](internal_docs/context_selection_next_feature.md), [the frontend feasibility assessment](internal_docs/context_selection_frontend_feasibility.md), and [the cell/kernel model](internal_docs/cell_kernel_model_and_context_selection.md). The historical task prompt is [here](internal_docs/context_selection_task_prompt.md). These context controls are part of version 0.1.8; the brief records the original design contract.

For tools or browser operations, read [the implemented tool and protocol contract](internal_docs/bundled_tools.md). Upstream research is in [the dialoghelper catalog](internal_docs/dialoghelper_tool_catalog.md), [the ipylab assessment](internal_docs/ipylab_frontend_bridge_assessment.md), and [the ai-jup analysis](internal_docs/ai_jup_research_and_design.md).

For coexistence with Jupyter AI and ACP agents, read [the pinned compatibility investigation](internal_docs/jupyter_ai_compatibility.md). Its agent single-cell command and native Run All take different execution paths; do not infer one from the other. The [prompt intent design](internal_docs/prompt_intent_design.md) records the distinction between a question's focus and its wider context.

The [Codex ACP worked-example run](internal_docs/codex_acp_example_run.md) records an actual authenticated agent trial. Its subscription login belongs to Jupyter AI's Codex adapter, not nbinlineai's inline API provider. The reusable example intentionally retains a bug; headless checks should verify its expected diagnostic rather than silently fixing the exercise.

## Project constraints

- Use the installed Gest workflow via `.agents/skills/gtw/SKILL.md` for
  substantial work. Project invariants in this file take precedence over
  generic templates. See [the project workflow](internal_docs/workflow.md).
- `main` is the default branch. `codex/agentic-notebook-experiments` is a
  persistent integration branch. Create temporary `codex/*` topic branches
  from the selected integration target and submit PRs back to that target.
  Both targets require PRs, CI and independent adversarial review. Never
  interpret the experiment policy as permission for direct development pushes.
  A later experiment-to-main promotion needs its own scope and authorization;
  preserve the experimental branch after that PR.
- Record reviewed base/head commits and finding dispositions. Self-review and
  passing tests do not replace independent review. Native Gest maintains its
  graphs; do not generate separate graph exports.
- Experimental merges publish source only. Keep Git installation working;
  no version bump, tag, PyPI upload or website deployment follows merely from
  merging an experimental PR. A requested release follows the release contract.

- Keep the ongoing notebook-agent experiments on the long-running
  `codex/agentic-notebook-experiments` branch. This includes identified-cell
  execution handoffs, one-kernel RLM/Python 3.14 work, and later multi-kernel
  research. Use it as the integration target across tasks unless the user explicitly
  directs otherwise; do not silently move experimental work onto `main`.
  Keep the branch buildable as a Git-source `uv` dependency and update its
  installation instructions in [Development](docs/development.md) when needed.
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
- Enabled tool declarations in the current question and all earlier ordinary Markdown/AI questions are discovered **before** context trimming. Per-cell `toolsInclude` defaults true and is independent of text selection; Current question only retains these tool choices. AI answers/code/raw/output do not declare tools. Only current-question `$` references look up live values.
- Fixed instructions/current prompt/tool schemas/executed notebook-tool groups are budgeted before optional notebook context. The 64,000 limit is a **character estimate for each host-assembled submission** to either model transport, not a model-token guarantee. ChatGPT's owned runtime may make internal inference/recovery requests after submission; those do not increment `maxToolSteps`, which counts validated notebook-tool plan groups. Use the runtime's exact content serializer plus bounded transport-metadata reserve for ChatGPT previews, and reject any actual submission envelope beyond that estimate or 64,000 characters. Never replay notebook-tool effects during re-budgeting.
- Browser operations must remain bound to the originating document/model/session/kernel and stable cell IDs; changing focus cannot redirect them. An insertion acknowledgement means changed live document, not saved file.
- There are two distinct transports: authenticated server SSE/action-reply for model tools, and execution-bound Jupyter comms for `insert_tools()`. Do not block or nest the kernel event loop waiting on itself.
- Use shared-model metadata updates that preserve unrelated fields. Merely opening, selecting, previewing, or rendering a notebook should not dirty it.

## Verification and release

For a requested release or new drop, completion includes a version bump, checked distribution artifacts, PyPI publication, a pushed Git tag/source, and publication verification. A source commit alone is not a release. If a task intentionally stops at implementation, state clearly that PyPI is unchanged and record the remaining release work in the handoff.

Use meaningful tests at the changed boundaries: Python, frontend unit tests, then a real isolated JupyterLab with a real kernel and deterministic provider. After frontend changes, rebuild and relink before browser tests. Never build package assets concurrently with browser tests.

See [the handoff](internal_docs/developer_handoff.md) for commands and known test pitfalls; see [the release checklist](internal_docs/releasing.md) for packaging, clean-install checks, versions, artifacts, and publication records. Do not hand-edit generated `lib/` or prebuilt labextension files. Update public docs/examples when semantics change, and keep these handoff notes current.

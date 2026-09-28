# Internal documentation index

**Workflow follow-up (2026-09-25):** [Project workflow](workflow.md) records the
primary-`main` convention, owned worktree cleanup and reviewed skill refresh.
Issue #4 tracks both branch adoptions and the preview race fix; PyPI is unchanged.

**Experimental development branch:** `codex/agentic-notebook-experiments` is
the long-running home for notebook-agent execution handoffs, one-kernel RLM
and Python 3.14 work, and subsequent multi-kernel research. Install and update
instructions are in [Development](../docs/development.md#install-the-ongoing-experimental-branch-in-a-jupyterlab-project).

Last reviewed: **2026-09-24**, after the **0.1.14** release. Public PyPI archives and download hashes, a fresh PyPI-index install, compatibility CI, source and live documentation were verified; see [the release record](releasing.md). Context selection shipped in 0.1.8; clearer controls in 0.1.9; AI-cell backgrounds, editable starters, prompt focus and code insertion in 0.1.10. Version 0.1.12 retained 51 curated tools with pure Python search/document parsing and deferred the four remold syntax tools; 0.1.11 introduced the expanded catalog and disposable project example. The Jupyter AI/Codex examples include an authenticated agent trial. These files are public repository content, although excluded from PyPI archives and the Jekyll site.

The [current handoff](developer_handoff.md) records the published 0.1.14 fixes
for connection defaults, per-cell inheritance, and empty answer display.

## A new task's reading order

1. [AGENTS.md](../AGENTS.md): constraints, invariants, tools, and verification workflow.
2. [Developer handoff](developer_handoff.md): current state, source map, testing details, and known limitations.
3. [Cell/kernel model and context selection](cell_kernel_model_and_context_selection.md): current snapshot, selection, tool discovery, budget, preview and execution boundaries.
4. [Bundled tools and frontend interface](bundled_tools.md): shipped tools, server/browser request-reply, Python/browser comm, limits and lifecycle.
5. [Release records](releasing.md): tested and published versions, hashes, and deployment results.

## Approved experimental design

- [Notebook execution handoff spec](notebook_execution_handoff_spec.md): approved
  same-notebook contract for `add_code_cell_and_execute`, `prompt_and_run` and
  `run_and_prompt`; queued terminal handoffs, stable IDs and actual run results.
- [Copyable implementation task prompt](notebook_execution_handoff_task_prompt.md):
  experimental topic worktree and PR instructions; primary checkout stays on `main`.

These documents are available on both persistent branches for discovery. They
do not add runtime functionality; implementation targets the experimental branch.

## Context-selection implementation references

- [Feature brief and recommended semantics](context_selection_next_feature.md)
- [Frontend feasibility and upstream evidence](context_selection_frontend_feasibility.md)
- [Copyable task prompt](context_selection_task_prompt.md)

The brief and task prompt preserve the original design contract. Context selection is published in 0.1.8; the handoff and release record contain the source tests, final artifact checks, clean-install verification and publication hashes.

## Research and historical decisions

| Document | Status and purpose |
| --- | --- |
| [ChatGPT subscription runtime gate](chatgpt_subscription_gate.md) | Pinned runtime isolation evidence, the superseded strict one-request gate, local live acceptance, and cross-platform CI results for 0.1.13. |
| [ChatGPT subscription integration spec](chatgpt_subscription_integration.md) | Implemented 0.1.13 contract: packaged pinned SDK/runtime, ChatGPT sign-in, notebook-owned structured tool plans (no ACP), exact host-submission budget, private runtime cwd, disabled native direct files, API coexistence and release checks. |
| [Subscription implementation task prompt](chatgpt_subscription_task_prompt.md) | Historical 0.1.13 task contract and acceptance checklist; use the handoff and release record for current status. |
| [Subscription configuration preview](design/chatgpt-configure-ai.html) | Historical interactive design reference with [editable source](design/chatgpt-configure-ai.fragment.html). All interactions are simulated; its active file-scope control is superseded by the current read-only “Notebook tools only” contract. |
| [Jupyter AI directories and permissions](jupyter_ai_directory_and_permissions.md) | Empirical kernel/ACP directory tests, adapter-policy source review, and direct Codex sandbox tests with 0.155 and SDK runtime 0.156.1. ACP is prior art only. |
| [Prompt intent and cell landmarks](prompt_intent_design.md) | Shipped in 0.1.10: distinguish the cell or task being asked about from wider context, with shared instructions and editable prompt starters. |
| [Jupyter AI coexistence](jupyter_ai_compatibility.md) | Pinned official Jupyter AI/ACP research, isolated co-install evidence, execution-command differences, and separate authentication boundaries. |
| [Codex ACP example run](codex_acp_example_run.md) | Successful authenticated Codex trial through Jupyter AI: read, repair and execute explicit code cells while preserving the inline questions. Includes versions, isolation and limits. |
| [dialoghelper catalog](dialoghelper_tool_catalog.md) | Pinned upstream capability survey: portable tools, tools needing browser integration, Solveit-specific facilities, and current implementation mapping. |
| [Notebook execution handoffs](notebook_execution_handoffs.md) | Research and same-notebook design proposal for prompt → run and run → prompt, with Solveit, Jupyter AI/MCP, kernel, RLM, and Python 3.14 execution boundaries; no feature is shipped by this note. |
| [One-kernel RLM and Python 3.14](one_kernel_rlm_python314.md) | Next-stage research: Solveit RLM loop, main-cell/server/background/subshell/subinterpreter execution modes, blocking behavior, and a one-kernel-first research order. No feature is shipped by this note. |
| [Fastcore tools and next candidates](fastcore_tool_candidates.md) | September 23 upstream survey and 0.1.12 implementation matrix for 51 tools, including source search, tracing, checked edits, and live-cell operations. |
| [ipylab assessment](ipylab_frontend_bridge_assessment.md) | Historical alternatives analysis; its proposed narrow bridge shipped in 0.1.6, and direct `insert_tools` comms shipped in 0.1.7. No ipylab dependency. |
| [ai-jup analysis](ai_jup_research_and_design.md) | Pinned original source study: cell metadata, context, live values, schema conversion, extension packaging, licensing. Its Lisette proposal was superseded. |
| [FastLLM and subscription research](fastllm_and_chatgpt_subscription.md) | Historical API transport decision and now-superseded future Codex App Server proposal; use the 0.1.13 spec and release record for implementation status. |
| [MVP implementation](mvp_implementation.md) | Historical implementation/test log through 0.1.5; use current handoff and release records for present behavior. |
| [Response style followups](response_style_followups.md) | Historical 0.1.4 design; subsequent releases completed Keep defaults, native Run All, examples and tools. |

Public documentation: the [manual index](../docs/user-guide.md) links eight chapters, including [Context selection](../docs/manual/context-selection.md); the [FAQ](../docs/faq.md), [tools reference](../docs/tools.md), [examples](../docs/examples.md), [architecture](../docs/architecture.md), and [development guide](../docs/development.md) remain separate. The split manual and refreshed screenshots are included in 0.1.14 and verified on the website. Update public instructions whenever a shipped feature changes; keep future proposals clearly labeled here.

[Project workflow](workflow.md) defines persistent integration targets, reviewed
topic PRs, installed skills, CI, issue completion and release boundaries.

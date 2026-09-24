# Internal documentation index

Last reviewed: **2026-09-24**, during unreleased **0.1.13** subscription implementation; the latest published version remains **0.1.12**. Context selection shipped in 0.1.8; clearer controls in 0.1.9; AI-cell backgrounds, editable starters, prompt focus and code insertion in 0.1.10. Version 0.1.12 retains 51 curated tools with pure Python search/document parsing and defers the four remold syntax tools; 0.1.11 introduced the expanded catalog and disposable project example. The Jupyter AI/Codex examples include an authenticated agent trial. These files are public repository content, although excluded from PyPI archives and the Jekyll site.

## A new task's reading order

1. [AGENTS.md](../AGENTS.md): constraints, invariants, tools, and verification workflow.
2. [Developer handoff](developer_handoff.md): current state, source map, testing details, and known limitations.
3. [Cell/kernel model and context selection](cell_kernel_model_and_context_selection.md): current snapshot, selection, tool discovery, budget, preview and execution boundaries.
4. [Bundled tools and frontend interface](bundled_tools.md): shipped tools, server/browser request-reply, Python/browser comm, limits and lifecycle.
5. [Release records](releasing.md): tested and published versions, hashes, and deployment results.

## Context-selection implementation references

- [Feature brief and recommended semantics](context_selection_next_feature.md)
- [Frontend feasibility and upstream evidence](context_selection_frontend_feasibility.md)
- [Copyable task prompt](context_selection_task_prompt.md)

The brief and task prompt preserve the original design contract. Context selection is published in 0.1.8; the handoff and release record contain the source tests, final artifact checks, clean-install verification and publication hashes.

## Research and historical decisions

| Document | Status and purpose |
| --- | --- |
| [ChatGPT subscription runtime gate](chatgpt_subscription_gate.md) | Historical strict one-model-request gate: sanitized catalog suppressed native tools, but unexpected native call triggered internal recovery. The user later allowed internal inference/recovery after a bounded host submission. The evidence remains useful for native-tool isolation. |
| [ChatGPT subscription integration spec](chatgpt_subscription_integration.md) | Active unreleased 0.1.13 contract: packaged pinned SDK/runtime, ChatGPT sign-in, notebook-owned structured tool plans (no ACP), exact host-submission budget, private runtime cwd, disabled native direct files, API coexistence and release gates. |
| [Subscription implementation task prompt](chatgpt_subscription_task_prompt.md) | Reusable active contract and acceptance checklist for implementing and releasing the subscription integration. |
| [Subscription configuration preview](design/chatgpt-configure-ai.html) | Historical interactive design reference with [editable source](design/chatgpt-configure-ai.fragment.html). All interactions are simulated; its active file-scope control is superseded by the current read-only “Notebook tools only” contract. |
| [Jupyter AI directories and permissions](jupyter_ai_directory_and_permissions.md) | Empirical kernel/ACP directory tests, adapter-policy source review, and direct Codex sandbox tests with 0.155 and SDK runtime 0.156.1. ACP is prior art only. |
| [Prompt intent and cell landmarks](prompt_intent_design.md) | Shipped in 0.1.10: distinguish the cell or task being asked about from wider context, with shared instructions and editable prompt starters. |
| [Jupyter AI coexistence](jupyter_ai_compatibility.md) | Pinned official Jupyter AI/ACP research, isolated co-install evidence, execution-command differences, and separate authentication boundaries. |
| [Codex ACP example run](codex_acp_example_run.md) | Successful authenticated Codex trial through Jupyter AI: read, repair and execute explicit code cells while preserving the inline questions. Includes versions, isolation and limits. |
| [dialoghelper catalog](dialoghelper_tool_catalog.md) | Pinned upstream capability survey: portable tools, tools needing browser integration, Solveit-specific facilities, and current implementation mapping. |
| [Fastcore tools and next candidates](fastcore_tool_candidates.md) | September 23 upstream survey and 0.1.12 implementation matrix for 51 tools, including source search, tracing, checked edits, and live-cell operations. |
| [ipylab assessment](ipylab_frontend_bridge_assessment.md) | Historical alternatives analysis; its proposed narrow bridge shipped in 0.1.6, and direct `insert_tools` comms shipped in 0.1.7. No ipylab dependency. |
| [ai-jup analysis](ai_jup_research_and_design.md) | Pinned original source study: cell metadata, context, live values, schema conversion, extension packaging, licensing. Its Lisette proposal was superseded. |
| [FastLLM and subscription research](fastllm_and_chatgpt_subscription.md) | FastLLM decision and separate future Codex App Server mode; API backends shipped, ChatGPT subscription authentication did not. Reverify external API/auth details before implementing that future mode. |
| [MVP implementation](mvp_implementation.md) | Historical implementation/test log through 0.1.5; use current handoff and release records for present behavior. |
| [Response style followups](response_style_followups.md) | Historical 0.1.4 design; subsequent releases completed Keep defaults, native Run All, examples and tools. |

Public documentation: [user guide](../docs/user-guide.md), [FAQ](../docs/faq.md), [tools reference](../docs/tools.md), [examples](../docs/examples.md), [architecture](../docs/architecture.md), [development](../docs/development.md). Update public instructions whenever a shipped feature changes; keep future proposals clearly labeled here.

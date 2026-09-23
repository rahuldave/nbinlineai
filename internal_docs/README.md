# Internal documentation index

Last reviewed: **2026-09-23**. Version **0.1.8** is published; the 0.1.9 control-layout documentation describes an unpublished release candidate. These files are public repository content, although excluded from PyPI archives and the Jekyll site.

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
| [dialoghelper catalog](dialoghelper_tool_catalog.md) | Pinned upstream capability survey: portable tools, tools needing browser integration, Solveit-specific facilities, and current implementation mapping. |
| [ipylab assessment](ipylab_frontend_bridge_assessment.md) | Historical alternatives analysis; its proposed narrow bridge shipped in 0.1.6, and direct `insert_tools` comms shipped in 0.1.7. No ipylab dependency. |
| [ai-jup analysis](ai_jup_research_and_design.md) | Pinned original source study: cell metadata, context, live values, schema conversion, extension packaging, licensing. Its Lisette proposal was superseded. |
| [FastLLM and subscription research](fastllm_and_chatgpt_subscription.md) | FastLLM decision and separate future Codex App Server mode; API backends shipped, ChatGPT subscription authentication did not. Reverify external API/auth details before implementing that future mode. |
| [MVP implementation](mvp_implementation.md) | Historical implementation/test log through 0.1.5; use current handoff and release records for present behavior. |
| [Response style followups](response_style_followups.md) | Historical 0.1.4 design; subsequent releases completed Keep defaults, native Run All, examples and tools. |

Public documentation: [user guide](../docs/user-guide.md), [FAQ](../docs/faq.md), [tools/examples](../docs/tools.md), [architecture](../docs/architecture.md), [development](../docs/development.md). Update public instructions whenever a shipped feature changes; keep future proposals clearly labeled here.

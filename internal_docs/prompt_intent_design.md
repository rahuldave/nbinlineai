# Prompt intent and notebook landmarks

Discussed on 2026-09-23 after 0.1.9; implemented for **0.1.10**. The user reported that “explain the code above” produced an explanation of the whole notebook. They want better interpretation of everyday notebook requests, without a new cell type or response style. They selected **shared instructions plus editable starters**. See the [handoff](developer_handoff.md#version-0110-implementation) for implementation boundaries and [release record](releasing.md) for verification/publication status. The design rationale below is retained for future work.

## Separate focus from available context

Context selection determines which notebook material the model may see. The current question determines what it should do with that material. Full notebook context must not imply a request for a full notebook summary. Earlier cells can explain names, assumptions, and dependencies used by one target cell.

Before 0.1.10, the shared system prefix in `nbinlineai/prompt.py` said that labeled source was relative to the question and might be unexecuted or stale. `context_budget.py` labeled source above/below and sorted it in notebook order. Completed earlier AI exchanges became chat turns, separately from source in the system message. The payload did not explicitly identify the immediately preceding cell or nearest preceding code cell, and the source/history split did not preserve their interleaving. These were plausible contributors to the reported scope problem; no live-provider reproduction established a single cause.

## Shared guidance and landmarks

Add common task guidance, independent of Compact/Full/Learning, and explicit cell landmarks derived from the frozen live notebook snapshot:

| User wording | Suggested focus | Role of other selected context |
| --- | --- | --- |
| Explain the cell above | Immediately preceding physical cell | Explain its dependencies and purpose |
| Explain the code above | Nearest preceding code cell | Explain names and setup used by that code |
| Explain the text above | Nearest preceding ordinary Markdown cell, unless the question explicitly refers to an AI answer | Supply relevant background |
| Explain this section | Preceding Markdown heading and following cells up to this question | Supply earlier definitions as needed |
| Write code to … | The requested new task | Reuse existing names, imports, and conventions where appropriate |
| Summarize what we have done | Selected notebook history | Give the requested broader overview |

These are language-model instructions, not strict matching rules or guarantees. Explicit user wording takes precedence. “This” alone can be ambiguous; the model should ask one short clarifying question when there is no reasonable target, rather than inventing a task.

Selection remains authoritative: identifying a target must not silently reinclude its excluded source. If a referenced cell is missing, omitted by the budget, or only partially supplied, expose that fact and ask the user to include it when needed. Preserve current-only behavior, independent tool inclusion, fixed-material budgeting, and preview/run parity. Position labels must describe real notebook order, not just order among surviving selected cells.

## Editable starters

Offer a compact row of four suggestions only in an empty AI question: “Explain cell above”, “Explain code above”, “Explain section above”, and “Write code…”. Accepting one inserts ordinary editable prompt text, focuses the question editor, and hides the suggestions; it creates neither metadata modes nor an extra model request. An untouched suggestion must never be submitted as if the user typed it. Ordinary typing should remain unobstructed. The empty UI should not dirty the notebook.

Start with explicit clickable/keyboard-accessible suggestions rather than invisible acceptance on mouse movement. A future ghost-text completion can use Tab to accept, with Escape or typing to dismiss, after checking Jupyter's editor/completion shortcuts. Do not add an intent classifier provider call merely to choose among these tasks.

## Implementation boundaries

- “Cell above” includes an immediately preceding AI answer; “code above” deliberately skips it. Physical empty/raw/excluded cells must not silently become some other cell.
- The nearest preceding ordinary Markdown heading marks the beginning of the section through the cell immediately before the question. A nested heading begins a smaller section. Avoid headings in fenced code; use a real parser or a narrowly specified, tested rule and document supported syntax.
- Include bounded identity/position landmarks, not a full extra notebook outline. Do not expose excluded source through heading text or excerpts. Availability must reflect each provider round after trimming, including missing and partial targets.
- Expose enough mapping for retained chat pairs to preserve physical positions despite splitting source from conversation messages. Budget every added label and keep preview/run construction shared.
- The initial UI keeps the current compact controls and does not introduce another Context dropdown or target mode.

## Verification

Use captured provider payload tests to verify shared instructions, real positional landmarks, source/history interleaving, missing/partial target disclosures, custom style compatibility, and budget parity. Such tests demonstrate payload construction; they do not prove an LLM will always interpret intent correctly. If starters are added, browser checks should cover empty and existing questions, editing, keyboard access, undo, save/reload, and accidental execution of placeholder text.

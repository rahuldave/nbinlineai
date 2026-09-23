# Response style follow-ups

## Current status

Version 0.1.3 is published. It has a global response style in Configure AI, built-in Compact / Full / Learning instructions, and code-copy buttons. The shorter cell labels (just Compact, Full, or Learning) are committed after the release and are not yet published.

The user asked whether per-cell styles and editable style instructions would be worthwhile. Both are recommended below; they are not implemented in 0.1.3.

## Per-cell choice

- Offer **Default**, **Compact**, **Full**, and **Learning** in each AI prompt's controls. Explain the effective default in a tooltip or option label, rather than another long status sentence.
- Default inherits the Configure AI choice at run time. Existing notebooks with no override keep this behavior.
- Save explicit overrides with the prompt's nbinlineai metadata so they survive reopening and sharing the notebook.
- A rerun uses the cell override if present, otherwise the current global default. Changing a setting does not alter a response already in progress.
- Show the effective style clearly, without repeating “responses” beside every cell.

This supports a lesson that mainly uses Learning but includes a Full worked example or a Compact factual question.

## Editable instructions in Configure AI

- Show the effective instructions for each of the three styles in an editable field, initially populated from the bundled defaults.
- Save overrides in JupyterLab user settings, separately from API keys and notebook contents.
- Provide **Reset to default** for each style. Represent a reset as an absent override, so later package improvements to the bundled default remain available.
- Keep one authoritative set of bundled instructions on the server; expose them to the settings UI rather than maintaining divergent Python and TypeScript copies.
- Pass the selected instructions with a run using a bounded, validated field. Preserve the server's fixed notebook-context and tool-handling instructions independently.
- Reuse the confirmed-save and Retry behavior introduced in 0.1.3; failed confirmation must not be described as a successful save or a definite failure to save.

The notebook would share its style choice, while custom instruction wording would remain a user preference. Document that distinction. Learning remains guidance to the model rather than an enforced assessment restriction.

## Verification for implementation

Check that an explicit cell override survives saving/reopening, inherited cells follow a changed global default, and reruns use the expected style. Check custom instructions for both providers, Reset behavior, and failure/recovery of settings saves. Existing notebooks must continue working without migration.

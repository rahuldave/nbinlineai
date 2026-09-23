# Response controls for version 0.1.4

## Current status

Version 0.1.3 is published. It has a global response style in Configure AI, built-in Compact / Full / Learning instructions, and code-copy buttons. The shorter cell labels (just Compact, Full, or Learning) are committed after the release and are not yet published.

The user approved these changes for the next prompt-focused drop, before examples and importable tools. During discussion they chose notebook defaults at the top of the notebook, with individual cell overrides as an exception. Version 0.1.4 is implementing this design. The public repository is https://github.com/rahuldave/nbinlineai and keeps GPLv3, matching ai-jup.

## Notebook defaults and cell overrides

- Put Provider, Model, Style, and Effort in a compact defaults row in the public NotebookPanel contentHeader area.
- Save choices in notebook metadata under `nbinlineai.defaults`, and snapshot effective defaults at first AI use so accepting initial choices also persists one model per notebook. Do not dirty ordinary notebooks merely by opening them.
- Use JupyterLab user settings only as initial fallbacks for notebooks without saved choices.
- Keep ordinary AI cell controls small. Expose provider/model/style/effort choices through **Override**, with an action to return to notebook defaults.
- Save explicit overrides with the prompt's nbinlineai metadata so they survive reopening and sharing. Preserve legacy saved provider/model choices until the user opts into inheritance.
- A rerun resolves notebook defaults and cell overrides at that moment. Changing settings does not alter a request already in progress.
- Avoid repeating “responses” beside every cell. The effective model and effort must stay compatible when either notebook or cell settings change.

This supports a lesson that mainly uses Learning but includes a Full worked example or a Compact factual question.

## Editable instructions in Configure AI

- Show the effective instructions for each of the three styles in an editable field, initially populated from the bundled defaults.
- Save overrides in JupyterLab user settings, separately from API keys and notebook contents.
- Provide **Reset to default** for each style. Represent a reset as an absent override, so later package improvements to the bundled default remain available.
- Keep one authoritative set of bundled instructions on the server; expose them to the settings UI rather than maintaining divergent Python and TypeScript copies.
- Pass the selected instructions with a run using a bounded, validated field. Preserve the server's fixed notebook-context and tool-handling instructions independently.
- Reuse the confirmed-save and Retry behavior introduced in 0.1.3; failed confirmation must not be described as a successful save or a definite failure to save.

The notebook shares its style choice, while custom instruction wording remains a user preference. Document that distinction. Learning remains guidance to the model rather than an enforced assessment restriction.

## Effort

Expose only the known supported effort levels for the selected model, starting with Model default (omit a provider override). The server publishes the capability table and validates requests. FastLLM maps the selected value to OpenAI Responses `reasoning.effort` or Anthropic `output_config.effort` with adaptive thinking. Unknown custom models and Haiku 4.5 use default only; Haiku's manual thinking budget is a separate feature.

Style and effort are independent. A Compact response can still use high effort. Effort and its effect on latency/token usage are documented for the user. Fixed notebook-context and tool-handling instructions remain separate from the editable style text.

## Keep answer

Keep answer is a per-prompt preference, on by default. A new prompt can run once; a completed nonempty paired answer then prevents resubmission. Shift+Enter skips the request and advances, and Run AI respects the same protection. Uncheck it to rerun. Failed, cancelled, empty, and deleted answers remain retryable. Saving or resetting model/style overrides does not reset this preference.

## Verification for implementation

Check that notebook defaults and explicit cell overrides survive saving/reopening, inherited cells follow changed notebook defaults, and reruns use the expected style and effort. Check custom instructions for both providers, Reset behavior, and failure/recovery of settings saves. Check protected Shift+Enter sends no provider request and unchecking permits a rerun. Existing notebooks must continue working without migration.

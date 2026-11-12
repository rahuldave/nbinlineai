# Starter tools tutorial and factual documentation repairs

This main-based source change adds a connected introduction to the default tool group and corrects current instructions that disagreed with saved examples or released behavior.

The approved documentation and implementation baseline is main commit `64c81d0de9bb454cb53bbeed9882b2d2b765af01`. The primary checkout stays on `main`. The owning topic is `codex/vrowpnzn-starter-tools` in `/Users/rahul/Projects/nbinlineai-starter-tools`, with PR base `main`.

## Reader outcome

The new `examples/starter-tools-tutorial.ipynb` teaches a small field-study task. The reader imports the toolbox, inserts the 19 starter declarations into ordinary Markdown, and checks the receipt in a later cell. Following questions use those declarations to work with disposable files, a saved notebook, and the live notebook. The final question adds a Markdown summary and an editable code draft.

The lesson distinguishes imported functions, printed declarations and inserted Markdown. It explains the combined 20-name limit, the Tools checkbox, saved versus unsaved source, manual execution of inserted code, and rerunning questions that change files or cells.

## Factual repairs

The earlier [prose review](prose_cleanup_2026_11_11.md) kept factual questions separate from its editorial pass. This change resolves those questions against the recorded baseline and the saved examples. Dated release and acceptance records retain their original evidence and counts.

Existing notebook edits change authored tutorial Markdown only. Saved AI questions and answers, observed tool calls, generated declarations, code, outputs, execution counts, cell IDs, metadata and attachments remain evidence of the original runs.

## Disposition of the earlier content questions

| Question | Resolution |
| --- | --- |
| Conditional 0.1.16 installation advice | Current instructions identify published 0.1.18 and give the server, browser and kernel refresh steps. Historical release counts remain dated. |
| False absence or unrun claims | Eight notebook introductions or guides now agree with saved results, including both inline ACP answers and the supplied Socratic third turn. The ACP diagnostic remains intentionally failing. |
| Selected code outputs | The context lesson describes bounded displayed text output, including stdout, stderr and errors. Image bytes still need explicit attachment. |
| Saved-answer todo and Quarto filter | The completed saved-answer task is marked done, and current development guidance names smalldocs. |
| FastLLM subscription proposal | Its no-subscription statement is explicitly historical, with links to the implemented backend and current handoff. |
| Integration image question | Notebook and guide describe its saved confirmed attachment and red-image answer; a fresh run needs fresh confirmation. |
| Older internal status and RLM forms | The index distinguishes old checkpoints from later releases. Dated records retain their original claims. The RLM note names four forms. |

## Worked answers

The five new answers came from the existing nbinlineai-managed ChatGPT connection using `gpt-6-sol` in a headless isolated JupyterLab on port 8897. The run used invented readings and disposable files, with API transport disabled. Its 15 observed tool calls include actual file creation and replacement, saved-cell search/read, live-cell reads and both notebook insertions.

A focused follow-up run replaces only the live-note question's answer and trace. The runner edits ordinary Markdown through its editor, verifies that Contents still holds the expected placeholder, and runs the question without saving the edit. Its three calls contribute to the 15 retained calls. The saved answer quotes the new observation. A separate deterministic browser test checks the same boundary with a unique marker.

The two saved result cells are listed in notebook metadata so the browser regression can remove them from its disposable copy. Fresh-run instructions tell readers to remove those examples and turn off Keep before repeating effects. The generated tool declaration is removed from the distributed notebook, and its call/inspection outputs are cleared, so running the helper creates one new declaration. The original gallery answers remain unchanged.

All owned live-run servers stopped. The user's JupyterLab on port 8888 was not contacted. The saved source contains no credentials, physical-device capture or personal notebook data.

## Verification and delivery

The deterministic browser check uses the real JupyterLab interface, Python kernel and notebook tools. It verifies all 19 offered schemas, file creation and replacement, saved-cell search, a uniquely marked unsaved edit, and insertion of a code draft that remains unexecuted until the test runs it. The first test attempt used an absent DOM cell-ID attribute. The corrected test maps saved stable IDs to JupyterLab model indices and passes.

The complete Python suite passes 719 tests. All 102 frontend tests, TypeScript, Ruff and the lockfile check pass. smalldocs renders 55 pages and 31 notebooks; the site and internal-link checks pass.

Exact comparisons against the baseline preserve all 374 tagged AI cells, 274 saved code outputs and 296 recorded execution counts in the original 30 notebooks. The factual repairs change 13 authored Markdown cells in eight notebooks. The intentional ACP exercise bug remains.

The worked-runner option validates the target stable ID, ordinary Markdown type and exact saved source before editing. Seventeen focused Node tests pass, including invalid, duplicated, AI, stale and oversized edit targets. Independent review commits and final CI will be recorded in the PR and Gest notes. This work does not request a package release. The published version remains 0.1.18.

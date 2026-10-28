# Background worked-example refresh

Status: merged to `main` by PR #47 as `0226d33d5a9e9c2a52b7c734958a1224c7ce8ee9`. Documentation deployment `39627458417` succeeded. This was a source/documentation update with no version bump, tag or PyPI publication; the saved examples are included in the subsequent 0.1.17 release candidate.

## Source and execution boundaries

The approved documentation baseline and implementation source were main commit `c504dca3c40febf2fa104ddf46ae795fcd7aef55` on 2026-10-21, read from `/Users/rahul/Projects/nbinlineai`. The primary checkout remained clean on `main`. The owned checkout is `/Users/rahul/.codex/worktrees/worked-ai-examples/nbinlineai`, owner Codex, PR base `main`. The experiment was not changed. Gest parent `vxusqlmx` belongs to the existing worked-notebook iteration; its leaves cover the screen report, remaining answers and verification/delivery.

The user authorized real AI execution and required that laptop work not be interrupted. All new runs used Playwright Chromium headless, a fresh JupyterLab/root/config/runtime and real Python kernel on 127.0.0.1:8897, and the existing nbinlineai-managed ChatGPT subscription with `gpt-6-sol`. There was no API fallback, foreground browser, desktop capture, physical camera/microphone access, speaker output or clipboard use. Port 8888 was not contacted. Owned servers were stopped after each run, and port 8897 was confirmed free afterward.

The primary environment's Python was 0.1.16 but its generated frontend was still 0.1.14. A separate worktree `.venv` was bootstrapped, built and relinked before the successful browser runs; the user's environment and server were not rebuilt or restarted.

## Saved evidence

All **187 AI prompts** in the **29 gallery notebooks** now have one nonempty `done` answer. The supporting `data/ecosystem-lesson.ipynb` has no AI questions. The **158 earlier answer texts are unchanged**; the run added **29 genuine model answers** across eleven notebooks.

| Notebook | Newly saved answers | Evidence |
| --- | ---: | --- |
| Screen bug report | 3 | Real capture, recording, annotation and HTML exporter on a synthetic search-demo canvas; model attachment/status calls and native-image review. The model distinguishes the pictured empty result panel from proof of a real defect. |
| Live notebook tools | 3 | Actual cell listing, reading an unexecuted source cell, and Markdown insertion. |
| Live variables and tools | 2 | Actual bonus and mean calls; kernel checks confirm one mutation and unchanged state after the pure call. The offered reference list now includes both functions used by the questions. |
| Socratic dialogue | 1 | A supplied third learner follow-up and actual tutor response; the intentionally flawed function remains unfixed. |
| Data investigation | 2 | Actual audit/value inspection/search, report generation and insertion of an unexecuted draft. |
| Project handoff | 2 | Actual source/method/saved-notebook inspection, expected failing boundary check, hash-checked repair, fresh-process passing check and handoff export. |
| Presenter kit | 7 | Generated canvas/silent-audio capture and status results; direct HTML deck plus model-authored deck verified as seven slides with the expected embedded media. The alternate paste-ID capture handoffs remain interactive exercises. |
| Receipts to values | 4 | Ordinary Python result, real capability/status calls, fixture capture/recording, explicit still attachment and real image answer. |
| Browser-media attachment | 1 | Final native-image answer identifies the generated blue square; earlier two answers retained. |
| Browser-media integration | 3 | Fresh direct-output status lookup, pre-attachment native-image check, and final red-image answer; earlier initial AI listing retained as historical evidence. |
| Browser-media capture | 1 | Separate fresh synthetic camera continuation, actual stop call and terminal status confirmation; earlier physical-device observations retained. |

The media fixture supplies a 1000×600 canvas labelled as synthetic and silent generated audio, never operating-system media. The three application introductions disclose this. The latest capture continuation is separately labelled; its result does not expand the older physical-device acceptance claims. Generated presentation/report files were exercised in temporary directories; the published notebooks retain outputs and answers, and readers rerun exporters to create their own local deliverables.

The [collection plan](worked_examples_background_plan.json) records the selected cells and AI questions, starting with the screen report. Saved answers are subsequently protected by Keep answer; replay requires a disposable unanswered source copy or deliberately disabling that protection. This plan is not a native Run All guarantee. Historical operation IDs cannot be reused in a new session: the integration continuation explicitly reads its current direct operation ID, and the camera cleanup uses a newly started source.

## Runner repairs and verification

The opt-in `--headless` mode fails before visible sign-in when no existing connection is ready; refuses installed Chrome and desktop clipboard/sound/visual-operator actions; grants no device permissions; and verifies fixture installation before executing notebook steps. Native media/clipboard overrides fail closed. Synthetic tracks clean up timers and AudioContexts when explicitly stopped.

The genuine runs exposed three existing harness assumptions: long CodeMirror cells virtualize their visible lines; tool insertion changes question indices; and saving a clean document may emit no PUT. The runner now reads the complete editor document, resolves the question again by stable ID after the response, and still fetches and checks the saved model/session when a save is a no-op. Local-path redaction now preserves closing Markdown backticks. Public copies retain image hashes but remove expired image grants and references to generated files removed during cleanup; readers attach a fresh image for a rerun. Public answer text may contain redacted temporary paths/source IDs; no credentials or personal media were saved.

Verification before review:

- All eleven result notebooks have no code error outputs; source/answer IDs and all prior answer texts were checked against the baseline.
- 27 example checks, 29 focused runner/path/renderer Python checks, 20 Node support/headless/fixture checks and 99 frontend unit tests passed. The Node checks also run in source CI after its Chromium installation.
- The saved-answer coverage regression passed on the refresh and failed on the baseline for the expected 29 unanswered questions.
- The strict registered-tool evidence check passed with zero execution deferrals.
- smalldocs rendered 54 pages and all 30 notebooks; the checker passed AI-panel, output, tool-row, local-link and anchor checks. The final rebuilt pages are also checked for 187 answer panels.
- CI follow-up: four initial browser failures were repaired by updating the exact capture inventory, explicitly rerunning protected saved answers, checking unchanged rendered answer text before deliberate image submission, and explicitly activating the target notebook tab. The four focused browser cases passed. Public copies now discard expired image grants/generated-file references while preserving the attachment hash and all answer text.
- Independent review base/head, findings and dispositions, CI, PR and merge/deployment status are recorded in the PR and Gest notes. Self-review and local checks do not replace those gates.

No new physical-device acceptance, fresh Jupyter AI/ACP trial, broad native Run All guarantee or package release is claimed.

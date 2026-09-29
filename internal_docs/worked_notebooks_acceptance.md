# Worked notebook and documentation acceptance

This is the source-work checkpoint for [PR #35](https://github.com/rahuldave/nbinlineai/pull/35),
based on the integrated `codex/worked-guide` commit `6ac3dc5`. It is not a
release record. The browser/media API specification was approved on `main` at
`61fa3fe517999d8f88ff328a99fc86a34dfb470b`; the selected revised task
prompt is `e3fcf33b20ec10cd511129cd1672b98d307e4a5c` (merged in PR #26).
The later user request added saved, real normal and AI tool demonstrations and
reader-centered Quarto documentation. The primary checkout stayed on `main`;
development and isolated browser runs used owned `codex/*` worktrees and port
8897, never the user's JupyterLab on 8888.

## Accepted evidence

The registry-derived catalog has 96 public tools and three setup helpers.
Every public tool has a linked normal example and AI example under `examples/`;
related tools can share a notebook. The saved-evidence checker ties AI examples
to observed tool-result events, direct Python examples to actual calls and
later terminal browser receipts, and frontend-only normal examples to observed
JupyterLab actions. The three setup helpers have real normal evidence and
explicit AI exceptions. The canonical gallery contains 24 top-level notebooks.

At `6ac3dc5`, the unfiltered strict gate passed locally:

```text
.venv/bin/python scripts/check_worked_evidence.py --require-executed
Worked demonstration evidence matches the registered tools; 3 camera execution deferrals (normal only): capture_camera, record_camera, start_camera.
```

Those are the **only** execution deferrals. They apply to the direct Python
normal demonstrations of `start_camera`, `capture_camera`, and `record_camera`.
The corresponding concise AI questions were run against the user's real camera
in Chrome, and later status answers confirmed a source, a 640×480 still, and a
five-second video. No camera bytes are embedded in the published notebook.
The deferrals do not cover passive device listing, microphone, screen sharing,
playback, or any AI mode. The checker also includes a focused guard linking a
recorder's paused status, resume call, and observed running state to the same
recording.

The browser-media notebooks retain real microphone clips and audio levels,
direct and AI screen-sharing/capture, silent-canvas recorder controls, output
and canvas inspection/export, import and file choice, playback controls,
clipboard actions, and explicit managed-media cleanup. Direct microphone
pause/resume/stop is separately saved. AI `pause_recording` has a confirmed
paused status; AI `resume_recording` has an observed Media row transition to
running, labeled as a UI observation because the recording hit its wall limit
before a later status check. A second canvas recording was explicitly stopped
and terminally verified. Playback's AI Pause was verified with the preview
muted. The AI Paste test seeded the computer-control virtual clipboard with a
known disposable sample before a real paste event; it does not claim that the
preceding Copy populated that virtual clipboard. The outputs notebook retains
both an honest empty-selection answer and a separately verified nonempty AI
selection. Detailed results and partial outcomes are in
[`worked_notebooks_run.md`](worked_notebooks_run.md).

Fourteen live-editor normal examples and the `url_to_note` comparison have
observed ordinary JupyterLab results. The Quarto gallery renders saved
notebooks without rerunning interactive cells, and the orchestrator's local
render, page/link, and catalog checks passed on the integrated guide source.
These local checks and the strict gate do not substitute for PR CI or
independent review. PR #35 CI was still running when this record was revised;
no current CI success is claimed here. Earlier CI failures at older commits
were caused by then-incomplete saved evidence and do not describe `6ac3dc5`.

## Limits and remaining acceptance

The source gate checks mapped tool demonstrations, not every optional
walkthrough. The integration notebook's later AI continuation, the
attachment notebook's final image question, live-notebook editing questions,
and the Socratic third turn remain unrun or partial as described in the run
record. One earlier capture cleanup returned `released: true` immediately but
its later lookup was `stale_target`; no terminal release is inferred. The
gallery does not claim Safari, mobile, or broader device coverage from these
Chromium/Chrome trials.

Native Run All was checked with a pending direct `start_share`: the next cell
ran before the user completed the browser share choice. This shows Run All
does not wait for an interactive operation's terminal receipt. The analogous
AI-question Run All path remains untested and should be addressed separately;
ordinary saved notebook outputs must not be read as a Run All guarantee.

Before merge, record the independent review disposition and require PR #35's
current CI checks to pass on its final head. A merge to `main` triggers the
Quarto site deployment workflow; it does not authorize a version bump, tag,
PyPI upload, or package release.

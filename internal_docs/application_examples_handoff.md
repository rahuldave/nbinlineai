# Application examples handoff

Status: **implemented on topic `codex/application-notebook-audit`, pending PR to main**. This is notebook/documentation source work, not a release. PyPI remains 0.1.15. No runtime API or package version changes are included.

## Provenance and scope

Approved docs and implementation were read at main
`85f91d9b6a51c000adc8360e77e584f122911244`, including `AGENTS.md`, the internal index,
current developer handoff, workflow, bundled-tool contract, browser/media guides,
and the actual receipt/capture/attachment implementations. The primary checkout
`/Users/rahul/Projects/nbinlineai` was clean on main and matched fetched origin/main.
The stable examples use main's APIs; no experimental execution handoff API is used.

Gest parent `pywyqsmn` has audit `yqovsmlm`, media `strrzrpr`, nonmedia `skvvxlzl`,
and documentation/verification `qoznywzm` leaves, under the existing worked-notebooks
iteration `mwmwwzqwvqwxtumotmlnppnsotnkllzs`. No new GitHub issue is created for this
finite PR; the older notebook-agent initiative is not expanded by it.

Root owns `/Users/rahul/.codex/worktrees/application-notebook-audit/nbinlineai`,
branch `codex/application-notebook-audit`, with PR base main. Separate bounded
gpt-6-sol writers own `/Users/rahul/Projects/nbinlineai-application-media-notebooks`
(`codex/application-media-notebooks`) and
`/Users/rahul/Projects/nbinlineai-application-data-notebooks`
(`codex/application-data-notebooks`); their new files are integrated into the root
topic for one review/PR. All unrelated worktrees are preserved.

## Deliverables and boundaries

Every cell of all 25 original example notebooks was reviewed without executing
them. `docs/example-audit.md` records per-notebook purpose, evidence, limits and
applications. All original notebooks and their outputs are retained byte for byte.
In particular the Codex ACP exercise's intentional zero-versus-missing bug remains.

Five new notebooks show receipts to ordinary values, a presenter media kit, a
screen bug report, a data investigation, and a checked project repair/handoff.
They include code and staged inline AI questions but no fabricated saved answers
or device results. The presentation is local HTML with separate camera/screen
assets, authored slide text, and media playback. There is no bundled speech
transcription, video interpretation, picture-in-picture mixing, or PPTX exporter.

Direct browser receipts update `.result` with decoded media/control values after
completion; `.media` contains references. AI calls return snapshots and do not
assign kernel variables. Status lookup completion differs from target completion.
Interactive call and inspection cells must be run separately without blocking the
kernel; permissions and attachment confirmation remain user actions. Saved-file
paths are server-root-relative. New media examples use memory results/owned Python
exports, with explicit server-root mapping when returning from an AI file save.

`docs/tool-applications.md`, the gallery and examples README point readers to these
complete flows. The existing canonical tool-coverage mapping continues to point
at the old precise demonstrations; these additions supplement that catalog.

## Verification and review

Verification results and exact independent review base/head commits are recorded
in the PR and Gest completion notes. New browser/device examples are not executed
on the user's server or physical devices. Their static API/receipt review is
separate from deterministic project validation. The Quarto gallery renders
notebooks with execution disabled. The source PR requires full validation because
it adds executable notebooks.

Local checks: 614 Python tests and 99 frontend unit tests passed; Ruff, lockfile,
TypeScript, build, and internal Markdown links passed. Both new nonmedia Python
routes ran on disposable inputs in temporary real kernels and exported their
reports with input/source copies. The revised flat-row inspection exposes the
actual flagged reading. Presentation and bug-report exporters were checked with
synthetic stills and encoded fixtures, including the bounded custom model-deck
writer and its invalid-input rejection; no model or device was called. An initial
WAV fixture was rejected by the browser-recording MIME contract; the exporter
check uses encoded WebM audio. Notebook source outputs remain empty.

Independent review found and resolved two core workflow errors: nested dictionaries
were opaque to the data inspection/search tools (now a flat `reading_lines`
projection), and the guide tried to capture before opening a camera (now separate
source start, inspection, capture, and cleanup stages). New notebooks keep the
user's connection preferences rather than pinning the writer's ChatGPT account.

Remaining delivery: reviewed PR integration into main and the resulting normal
documentation deployment. A versioned release would separately require the release
checklist, artifacts, clean installation, tag, PyPI upload, and publication checks;
none is authorized or performed by this task.

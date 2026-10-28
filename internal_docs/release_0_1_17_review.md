# 0.1.17 common response instructions and release

Status: release candidate on `codex/common-prompt-release`, targeting `main`.
PyPI remains 0.1.16 until the checked archives are uploaded and verified.
The user authorized implementation, testing, independent review and publication
on October 28, 2026.

## Scope and provenance

The approved documentation and implementation baseline is clean main
`0226d33d5a9e9c2a52b7c734958a1224c7ce8ee9`. Published 0.1.16 is tag
`v0.1.16`, source `62d227c5c6142cf87c8b12b39062412fdc280fe3`.
The release includes the intervening reviewed worked-example refresh and
Litera Reading documentation theme, plus this common-instructions feature.
The persistent notebook-agent experiment is outside the release.

Root owns `/Users/rahul/.codex/worktrees/common-prompt-release/nbinlineai`,
branch `codex/common-prompt-release`, PR base `main`. The primary checkout
remains on `main`. Gest iteration `uwrkxvvp`, parent `lynsmxwt`, and leaves
`trpktllr`, `vqqnnnkw`, `lwytqntm` track implementation, verification and
publication. One gpt-6-sol implementation worker writes first; root then owns
documentation, versioning and delivery. Independent reviewers are read-only.
A separate GitHub issue was intentionally not created for this finite release;
the release PR records the public scope, review and verification evidence.

## Behavior

Configure AI → Defaults exposes **Common response instructions** before the
response-style controls. The bundled text asks for `$...$` inline mathematics
and display equations enclosed by `$$` on separate lines, instead of backslash
parentheses or brackets. Users can save replacement text, save an empty field
to disable common instructions, or Reset to the current server default.
Compact, Full and Learning retain their existing separate editable text.

The optional JupyterLab setting `commonInstructions` uses absence to inherit
the server default; an empty string is an explicit override. The request field
`common_instructions` accepts strings of at most 8,000 characters, including
empty text. The status endpoint supplies `common_response_instructions`.
Shared preparation places the common instructions before the selected style
for API and ChatGPT requests, previews and repeated tool rounds. They count
as fixed material within the existing 64,000-character budget. Confirmed
settings and preview invalidation include the new field. Instructions remain
user preferences outside notebook metadata; existing answers are unchanged.
This is model guidance, not a postprocessing rewrite of model output.

## Independent review

`release_baseline_review` (gpt-6-sol) independently examined the full previously
merged delta from `62d227c5c6142cf87c8b12b39062412fdc280fe3` through
`0226d33d5a9e9c2a52b7c734958a1224c7ce8ee9`.

- P2 verification gap: archive and site checkers do not individually require
  the new theme CSS, fonts and licenses or traverse CSS font URLs. Current
  source assets are present. This release additionally verifies exact source,
  sdist, wheel, rendered-site and deployed-site bytes for all seven companions,
  plus the three CSS font references. Future checker hardening is separate.
- P3 documentation drift: the background-example record still described a
  pending topic. Its status is corrected to PR #47's actual merged source and
  successful documentation deployment.
- No other actionable baseline finding. All 187 gallery questions have
  nonempty completed answers, and the 158 older answer texts remain unchanged.

`feature_review` (gpt-6-sol) reviewed main `0226d33d` through candidate
`ca392a5bd356b12fc9ad6f15aecc8fc7ed8cc233`. Its P2 finding reproduced a
delayed-status race: the common editor could remain blank before server defaults
arrived, permitting an accidental empty save. The repair disables that ambiguous
Save, refreshes after status arrives and preserves unsaved typing. The new
browser test failed before the repair and passed afterward; all three common
instruction browser flows passed together. No other actionable feature finding
was reported. Follow-up review checks this repair at the final candidate.

The release PR records the final independent feature review's exact base/head,
findings and dispositions, along with exact-head CI results. Passing tests are
separate from independent review; no GitHub approval from a second human
account is claimed.

## Verification and publication

Final checks, artifact hashes, clean-install evidence and publication status
are recorded in the release PR and Gest notes, then in the publication record.
Tests use deterministic providers and isolated JupyterLab on 8897 with real
Python kernels. No paid provider run, personal notebook or port-8888 server is
part of this release verification.

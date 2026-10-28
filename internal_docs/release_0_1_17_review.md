# 0.1.17 common response instructions and release

Status: published and verified on October 28, 2026. Release PR [#48](https://github.com/rahuldave/nbinlineai/pull/48) merged to `main` as
`dfdf86cfc5d2f94ccefddf76f24659c25674a2e1`, whose tree equals the final reviewed candidate
`bd4b9d6c7e3591c35f28be85a8db8a3c56237b77`. The pushed annotated
`v0.1.17` tag points to that merge. Both public PyPI artifacts match the
audited files; the checked-wheel installation and live documentation are verified.
The separate public-index installation also passed dependency, provenance and
both extension-discovery checks.
The user authorized implementation, testing, independent review and publication
on October 28, 2026.

## Scope and provenance

The approved documentation and implementation baseline is clean main
`0226d33d5a9e9c2a52b7c734958a1224c7ce8ee9`. Published 0.1.16 is tag
`v0.1.16`, source `62d227c5c6142cf87c8b12b39062412fdc280fe3`.
The release includes the intervening reviewed worked-example refresh and
Litera Reading documentation theme, plus this common-instructions feature.
The persistent notebook-agent experiment is outside the release.

Root used `/Users/rahul/.codex/worktrees/common-prompt-release/nbinlineai`
on branch `codex/common-prompt-release`, with PR base `main`, for the release
candidate. The same owned worktree then hosted the docs-only
`codex/0.1.17-publication-record` topic based on the released merge. The primary
checkout stayed on `main`. Gest iteration `uwrkxvvp`, parent `lynsmxwt`, and leaves
`trpktllr`, `vqqnnnkw`, `lwytqntm` track implementation, verification and
publication. One gpt-6-sol implementation worker wrote the feature; root then handled
documentation, versioning and delivery. Independent reviewers remained read-only.
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
was reported. The reviewer verified the repair at `fbb3da1f`, the session-readiness test
correction at `912c97dd`, and final test-only inherited-connection correction
at `bd4b9d6c7e3591c35f28be85a8db8a3c56237b77` against the same main base,
with no remaining actionable findings. A narrow existing recovery limitation
is accepted: if key-status retrieval itself fails, Retry or reopening may be
needed to refresh the field; Save remains safely disabled.

The release PR records the final independent feature review's exact base/head,
findings and dispositions, along with exact-head CI results. Passing tests are
separate from independent review; no GitHub approval from a second human
account is claimed.

## Verification and publication

Final PR CI source run `40707289179` passed 685 Python tests,
100 frontend unit tests, 20 background-example checks and 107 default
browser scenarios, with two opt-in subscription scenarios skipped. Both opt-in
scenarios passed separately against a deterministic ChatGPT runtime and real
isolated JupyterLab/kernel. Runtime run `40707289148` passed all 14 platform
and musl checks; documentation run `40707289154` passed the legacy required
**Render and check Quarto site** gate with smalldocs 0.1.5. Local documentation
validation built 54 pages, all 30 notebooks and 96 public-tool rows.

The initial local Python run passed 684 tests; its existing web-example test
failed during an external retrieval outage and passed a focused retry. Initial
local browser runs exposed a session-discovery readiness assumption and an
older explicit-versus-inherited ChatGPT selector assertion; both tests were
corrected without changing runtime behavior. Three ordinary media code-cell
stalls occurred under heavy host load; capture and phase-b passed a later local
rerun, while integration still timed out locally. All these scenarios passed in
the final full CI browser run. The record does not claim an uninterrupted local
full-suite pass or prove heavy load caused the stalls.

The final wheel is **2,560,354 bytes**, SHA-256
`63fcf21e3bf09844f26e984a8ec21d7584c92c82087c46c33a521564bc81117f`.
The source archive is **3,010,780 bytes**, SHA-256
`4508f7ae9877005a36efb06d6bbe0677644df3924f3270d9109d84a1cf6036e4`.
Strict Twine and archive checks passed. Independent archive review compared
all 336 tracked sdist files with final HEAD, checked all 144 wheel RECORD rows,
89 packaged docs/example files and 39 Python package files, and found no
unexpected differences. The archives include all 30 notebooks, the new editor
screenshot, and all seven theme companions, with no internal docs, caches,
environments or credential paths. The three CSS font references resolve.

The checked wheel installed in a disposable Python 3.14 environment, imported
from its own site-packages, and passed both extension discovery checks,
status-version verification and the packaged quickstart UI including the new
common editor. Both public PyPI downloads match the checked hashes above and
neither is yanked. PyPI reports 0.1.17 as latest and renders the updated README.
A separate fresh public-index Python 3.14 installation resolved 113 compatible
packages, imported nbinlineai from its own site-packages and discovered both
extensions enabled/OK. nbinlineai was refreshed from PyPI, while dependency
wheels used the existing cache in a newly created environment. The original
no-cache attempt was stopped when the large runtime dependency download
restarted. The publicly downloaded wheel also passed its isolated quickstart UI check,
including the common editor and bundled math default, then the owned server
stopped.

Pages deployment `40711719046` succeeded at the release merge. All
94 public site resources, including 54 HTML pages and all 30 notebook
pages, matched local rendered bytes, apart from sitemap checkout timestamps;
the rest of the sitemap XML matched exactly. The new common-instructions guide and
screenshot are live. All owned servers were stopped; the user's port-8888
JupyterLab and the experimental branch were untouched.
Tests use deterministic providers and isolated JupyterLab on 8897 with real
Python kernels. No paid provider run, personal notebook or port-8888 server is
part of this release verification.

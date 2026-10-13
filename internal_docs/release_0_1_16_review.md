# 0.1.16 release candidate and adversarial review

Status: **prepared candidate, unpublished; merge and publication await the user's decision**.
This record accompanies a main-based release PR. It is not a publication record.
PyPI remains 0.1.15; no 0.1.16 tag or upload has been made.

## Scope and provenance

The published baseline is tag `v0.1.15`, source
`9a435c5437f9f52308ea0c5328be26c5853a2ad8`. The release topic starts from clean,
synchronized main `4828a791337e0c2fa795b8a8b64b42fcbbab503b`, the merge of
application-example PR #43. The example additions are already on main; the
release PR prepares 0.1.16, fixes the first review’s P2 findings, and replaces the
documentation renderer after proving smalldocs against the actual notebooks. Independent
review examines the **full source delta from published 0.1.15**, including the
browser/media runtime, rather than only the version-bump diff.

The candidate includes 96 public tools and three setup helpers, all 30 notebook
files (29 gallery notebooks and one support fixture), and the five application
tutorials. The application PR preserved all 25 originals. Following the user’s
October 13 request, this candidate repairs setup/path cells in six original media
notebooks while preserving their cell IDs, metadata, execution counts and saved
outputs. The experimental integration branch is excluded.
Camera, microphone, screen and provider examples are not claimed as newly run.

Root owns `/Users/rahul/.codex/worktrees/release-adversarial-review/nbinlineai`,
branch `codex/release-0-1-16-review`, PR base main. The primary checkout remains
on main. Gest iteration `mylyorvn` and parent `rkwlkxqk` track version/docs
(`mkmtypqs`), artifacts (`plmvkzps`) and independent review/PR (`zvpwpwrm`). No
separate GitHub issue is needed for this finite candidate decision. Three
gpt-6-sol reviewers have read-only runtime, examples/docs and packaging scopes;
they do not review implementations they authored as independent evidence.

## First adversarial review at `76430f0`

The findings below record the original failure and initial disposition. The
October 13 repair and second-review section records their current disposition.

### P2: saved MP4 audio cannot reliably be reopened by its file reference

`nbinlineai/browser_media.py` auto-saves `audio/mp4` with a `.m4a` suffix, then
`resolve_ref` reconstructs MIME with `mimetypes.guess_type`. On the reviewed
macOS/Python environment that returns `audio/mp4a-latm`. The server passes that
type to the frontend, whose MP4 decoder accepts only `audio/mp4` or `video/mp4`.
An MP4 microphone recording therefore works through its original receipt but
fails when reopened with the saved `{path, sha256}` reference. The hash and bytes
can match perfectly. This affects a supported Safari-style recording format.

Suggested repair: preserve or normalize the supported container MIME when
resolving saved audio, and add a device-free upload/save/resolve regression for
MP4 audio alongside the existing WebM test. The defect remains unchanged for
the user's decision; passing current tests does not resolve it.

Root reproduced the registry round trip in a temporary directory with a
synthetic MP4 container header: operation completed, original MIME `audio/mp4`,
saved suffix `.m4a`, resolved MIME `audio/mp4a-latm`, identical bytes and hash.
This verifies the failing MIME boundary without recording a device or calling a
provider. Anchors: `browser_media.py:852–866,1217–1218`,
`handlers.py:675–679`, `browserMediaClient.ts:350–364`,
`browserMediaDecoder.ts:124–137,235–247`.

### P2: several original walkthroughs assume kernel cwd equals server root

Foundation, playback and attachment have a gallery warning, but transforms,
integration and outputs also make this assumption. Transforms create filename
references from kernel cwd and read server-root-relative sidecars as local
paths. Integration reads/deletes saved paths from cwd; outputs cleanup does the
same. When a notebook is in `examples/` beneath the Jupyter server root and its
kernel starts there, a returned `examples/media/...` path is effectively joined
twice. Transforms and integration fail; outputs cleanup can leave saved files.

Suggested repair: give all affected notebooks an explicit server-root mapping,
or consistently document the required launch layout. The example README should
also instruct users copying the transforms notebook to retain its `media/`
companion, as it currently mentions only `data/`. Existing notebooks are left
unchanged pending the user's decision. The broader path follow-up is already
tracked in Gest `rwlwskuysxnxxsspsozyktqllunmsnop`.

### P2 verification gap: archive assertions omit required companion resources

`scripts/check_release_artifacts.py` dynamically requires all notebook files,
but does not assert the transforms WebM companion or the newly linked
`docs/tool-applications.md` and `docs/example-audit.md`. Hatch includes the
complete examples/docs trees, so this is a gap in omission detection, not proof
that the current archives are missing them. The candidate artifact inspection
must separately verify these files and their exact source bytes.

Suggested repair: add these resources to source and wheel assertions. Manual
inspection can verify this candidate, but leaves future omission protection
unresolved. This finding remains visible rather than being silently fixed.

### P2: building after documentation render packages Quarto's cache

An independent inspection reproduced 51 `docs/.quarto/` cache files in both
archives when building after the site render. The initial build before render
contained none. Git ignores the directory, but Hatch includes the complete
`docs` tree in the sdist and wheel shared data without an explicit cache
exclusion. The release checker also omits `.quarto` from its forbidden parts
and passed the contaminated artifacts. This violates the release requirement
to exclude build caches and makes artifact contents depend on local render
history. Anchors: `pyproject.toml:54–74`, `docs/.gitignore:2`,
`scripts/check_release_artifacts.py:17–20,156–165`.

Root removed only the generated cache from the owned candidate worktree and
rebuilt clean candidate archives for inspection; contaminated artifacts must
not be uploaded. Suggested repair: explicitly exclude Quarto cache/generated
site data in packaging and assert their absence in the checker. That source
repair remains open for the user's decision even after this candidate is
cleaned locally.

## First-candidate verification evidence (historical, `76430f0`)

The main baseline's post-merge source validation passed in run `38313214176`;
documentation deployment and platform compatibility passed in runs
`38313214203` and `38313214196`. Candidate-specific results, archive hashes,
reviewed head and PR checks are recorded in the PR body and Gest notes.

Candidate local checks: **614 Python tests and 99 frontend unit tests passed**.
Ruff, offline lock validation, TypeScript, production build/relink and internal
Markdown links passed. Source comparison confirmed all 25 original notebook
files are byte-identical to the pre-application main baseline `85f91d9`.
The initial 0.1.16 wheel installed in a fresh Python 3.14 environment with 113
compatible packages; both extensions, the version endpoint, and an owned
port-8897 quickstart UI check passed without a provider/device call. Final
artifacts are rebuilt after the candidate wording is frozen and independently
compared against source before reporting their hashes. Full candidate browser
and platform validation remains a required PR gate; baseline passing runs do
not replace that check. The exact reviewed candidate head and final PR check
results are recorded in the PR body and Gest review notes to avoid embedding a
self-referential commit hash in this file.

The Quarto render/check passed: 53 pages, 29 gallery notebooks, 96 tool rows,
AI panels, local links and anchors. No notebook execution was enabled. Rendering
revealed the cache-packaging finding above; a clean Git status alone would not
have detected ignored cache files in the archives.

Independent clean-rebuild inspection: all 295 intended tracked sdist files and
121 tracked wheel Python/docs/examples files match source bytes. Both include
all 30 notebooks and the 72,134-byte WebM fixture, whose SHA-256 is
`2087303b97be4ba56da4d95d19d1106f6c0ddb5d9030e3f74f5c47e84bc4d63a`.
Neither contains Quarto cache, generated site HTML, dependency/build caches,
internal docs or credential-pattern matches. Wheel RECORD validates all 137
entries; package/frontend versions, dependencies and GPL-3.0-only agree.
Strict Twine and the normal archive checker pass, supplemented by this manual
full-source/resource/cache inspection.

First-candidate archives (historical and superseded, unpublished):

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `nbinlineai-0.1.16.tar.gz` | 2,440,417 | `fb60744bc1ec9ddc906236f8ec7532f06b08c735252d6ae8d2e7344f40f43a9a` |
| `nbinlineai-0.1.16-py3-none-any.whl` | 2,065,806 | `cd2993ff4742778e224e2ea6372e883678817949e4ec0134ae1eb72abdb51c9a` |

These first-candidate artifacts are superseded by the source repairs below and
must not be uploaded as the current release candidate.
The proposed repairs are tracked as Gest `nswzttxy` (audio MIME) and `srkorkwo`
(packaging exclusions/resource guards), with the existing path follow-up above.
The final clean wheel was reinstalled into the disposable Python 3.14
environment and passed the extension/version/quickstart UI check again. The
helper stopped only its own port-8897 server; the user's server was untouched.

## October 13 repairs and smalldocs proof

The user authorized fixing the P2 findings and requested smalldocs, with an actual
notebook feasibility check before committing to migration. The proof ran in an
owned temporary environment using **PyPI smalldocs 0.1.5**, before repository or
CI migration edits. It rendered all 30 notebooks without execution in about
1.5 seconds: 54 pages, 323 code cells, 199 saved outputs, 187 AI prompt panels,
158 AI response panels, and 1,066 cell IDs. Existing 29 gallery URLs remain;
the supporting fixture gains `notebooks/data/ecosystem-lesson.html`. Source
hashes matched before and after. Root visually inspected AI panels, saved
images and the tool catalog in an owned static preview; local resources loaded.

The native renderer required a presentation-only adapter to restore cell IDs,
AI classes and source links. Table union-type pipes are escaped for Markdown;
one saved unclosed fence is closed only in the render copy. The builder stages
copies in a temporary directory, renders with smalldocs, checks original source
hashes, and copies only the final ignored `_site`. CI installs only the pinned
pure Python renderer for the docs build. It uses no Quarto executable.

The mainline ruleset still requires **Render and check Quarto site**. That exact
legacy job name is retained, with smalldocs as its implementation; the project
workflow and AGENTS contract explain this. Renaming the job before updating the
ruleset would prevent required checks from completing. No protection was weakened.

First-review dispositions:

- **MP4 MIME: repaired.** Saved `.m4a` resolves as supported `audio/mp4`;
  bounded MP4 track inspection distinguishes audio-only explicit `.mp4` from
  video. Exact owner, path, regular-file, size and SHA checks remain in place.
  Regression tests observed the original audio failures before repair and check
  upload/save/resolve/re-save after memory release, plus WebM/Ogg behavior.
- **Notebook paths: repaired.** Foundation, playback, attachment, transforms,
  integration and outputs ask for an explicit existing absolute server root
  containing kernel cwd, derive root-relative file references, and resolve
  returned paths through that root for inspection/cleanup. Tests exercise nested
  folders, traversal/absolute/symlink escape rejection and changed-file cleanup.
  Offline copying instructions include the transforms `media/` companion.
- **Companion assertions: repaired.** Source/wheel checks require the WebM,
  coverage map and application/audit guides. Source checks also require the site
  configuration and build/adapter/checker scripts; the sdist includes `scripts/`
  so its documented site build can be reproduced.
- **Cache packaging: repaired.** Explicit source and installed shared-data
  patterns exclude Quarto cache, notebook checkpoints, generated `_site`,
  `site_libs` and notebook render assets. The checker rejects those paths. Real
  Hatch dirty-tree builds and omitted-resource archive tests cover both formats.

Three independent read-only cross-scope reviewers inspected the combined
changes, excluding work they authored. The second review caught the required
status-name mismatch and omitted source-archive builder scripts; both are now
fixed. A documentation table-signature check was adapted to compare visible
Python signatures after Markdown pipe escaping. Headless/browser test harnesses
supply their known isolated server root to disposable notebook executions.
Local verification passed 661 Python tests and 99 frontend unit tests, plus the
new required-status regression checked separately. Ruff, types, lock validation,
internal links and the complete smalldocs site gate passed. Root verified all
six repaired notebooks preserve IDs, metadata, stored outputs and counts. The
independent packaging reviewer rebuilt the 54-page site from an extracted sdist
and confirmed unchanged notebook hashes and required resources. Final exact-head
review, browser/CI results and replacement artifact hashes are recorded in the
PR and Gest notes before handoff; the first-candidate hashes above are historical.

## Remaining release gates

Resolve or explicitly accept the review findings, and rerun affected checks for
any changed head. Required source, documentation and compatibility PR checks
must pass. After the user authorizes merging/publication, merge the approved
head, rebuild/check artifacts if source changes, create/push the release tag,
upload once, verify immutable PyPI file hashes and a fresh index install, and
record the actual publication source. Preserve the experimental branch and
retire only the owned release worktree after integration and dependency checks.

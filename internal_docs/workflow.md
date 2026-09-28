# Project workflow

## Branches and review

`main` is the default branch and stable source line.
`codex/agentic-notebook-experiments` is a persistent, installable experimental
integration target. Start each experimental slice from its current remote commit
on a temporary `codex/*` topic; create a PR back to the experiment. Stable fixes
may target `main` when their scope calls for it. Record the chosen base and commit
before editing. Never infer that every PR should target the default branch.

Keep the primary checkout on `main`. Create owned topic worktrees from the
chosen integration target; the worktree's branch is the topic, not the persistent
target itself. For example, preparing the next stable release starts from
`main`, while a notebook execution experiment starts from the experimental
branch. Record ownership, path, topic and PR base before making changes, along with
the primary checkout path and its chosen branch (`main`).

Use ordinary topic PRs for independent changes. For dependent slices, optional
GitButler stacks target the selected integration branch at the bottom and the
preceding topic at each higher PR. Review/merge bottom-up, refresh affected
checks after retargeting, and preserve all persistent branches. Parallel coding
agents use physical worktrees. This adoption uses plain Git topics.

Independent adversarial review is required for substantial changes, including
workflow changes. Store reviewer identity, exact base/head commits, findings and
their dispositions in the PR. Fixes receive follow-up review at the new head.
CI and author self-review supply additional evidence. They do not create a
GitHub approval from another account. Ask for a merge decision only when that
particular merge has not already been authorized.

## Documentation by branch

Maintain approved pre-work specs, research and task prompts on `main`. On this
machine the normal reading location is
`/Users/rahul/Projects/nbinlineai/internal_docs/`; the primary checkout stays on
`main`. Read its index, workflow and relevant pre-work material even when
executing from an experimental worktree. Read implementation-specific handoffs
and records from the branch containing that code. A missing or older pre-work
copy is not a reason to merge `main` into an experiment merely to obtain docs.

Keep these sources distinct:

| Material | Read from | Edit and PR target |
| --- | --- | --- |
| Approved pre-work specs, research and task prompts | Recorded main revision, normally through the primary checkout | Owned main-based topic worktree → `main` |
| Implementation-specific internal handoffs and verification records | Recorded implementation branch revision | Owned topic worktree → selected implementation target; promote with code |
| Release records | Recorded release source and published artifacts | Release topic → `main` with the release |
| Runtime source, tests, public `docs/` (including architecture), README, examples and code documentation | Implementation worktree | Topic → the selected implementation target |
| Gest task/spec index and revision references | Primary repository's ignored `.gest/` | Serialized Gest operations; committed docs remain authoritative |

The primary is a reading location, not a shared editing workspace. Create an
owned topic worktree from the relevant integration target for every document
change, then use the usual review, CI and PR process. Pre-work documents may
precede implementation on `main`; implementation handoffs enter an experimental
branch with the code and reach `main` only when that code is promoted. Identify
the code branch/commit and status (proposed, implemented on a topic, integrated,
or released) in implementation records. Main's handoff must not describe
experimental-only work as a mainline or PyPI feature. Packaged docs/examples
must match their code.

### Resolve and record the documentation revision

1. Find the primary checkout using the recorded path and `git worktree list`;
   verify that it is on `main`. In another clone, choose and record an equivalent
   main checkout or a committed main revision; do not assume this machine's
   absolute path exists there.
2. Inspect its HEAD and the status of the pre-work documents you will use.
   Record `docs.source_branch=main`, `docs.source_commit=<full SHA>` and the
   relative document paths in the task/PR. For implementation handoffs, record
   the implementation branch and commit separately. Also record
   `docs.source_path` for a local reading location. Read the corresponding
   committed bytes. A clean document at the selected HEAD can be read directly
   from the primary folder; for a locally modified document use
   `git show <recorded-SHA>:internal_docs/<file>`.
   Uncommitted/untracked files are drafts unless explicitly selected by the
   user; record their draft status and content hash rather than attributing
   them to a commit.
3. Fetch to check whether main has advanced. Fast-forward the primary only when
   it is clean and safe to update. If dirty, behind or unavailable, preserve it
   and read the chosen fetched main SHA with `git show`, or use a separate
   read-only main snapshot. Never stash, reset or change branches in the primary
   to obtain docs. Do not silently fall back to an experimental copy. An offline
   task may use an available committed main snapshot and record its freshness
   limit; if no required main document is available, resolve that dependency.
4. Keep that pre-work baseline during the task. If a relevant spec changes,
   review the change and deliberately update the recorded revision. A proposed
   documentation PR may be used as an explicit dependency by recording its
   reviewed head and pending status; do not call it merged main documentation.

Read `AGENTS.md` in the implementation checkout for branch constraints and the
primary's current policy for where to find approved pre-work material. Update
the experimental branch's own guidance with its implementation handoff so new
worktrees discover both sources.
Older worktrees do not change when another branch's PR merges: task prompts
must carry this reading rule explicitly. Verify implemented behavior, available
commands and source paths against the implementation checkout, since main's
documentation may describe a newer release. Follow pre-work internal-doc links
within the same recorded main snapshot; resolve implementation-handoff and
code/public-doc links against the implementation checkout when deciding what
is actually available there.

Keep Gest artifacts as discoverable mirrors with source path, revision and
status. They do not transport documents between branches or override committed
main specs. This project-specific policy determines each document's PR target.

## Tracking and installed skills

Use the project-local `.agents/skills/gtw/SKILL.md` router. Native Gest records
task hierarchy, dependencies and execution notes in ignored `.gest/`; its graphs
are automatic. Serialize Gest operations. GitHub issues preserve durable intent:

- [Experimental workflow adoption](https://github.com/rahuldave/nbinlineai/issues/1)
  was completed by PR #3.
- [Mainline workflow and CI follow-up](https://github.com/rahuldave/nbinlineai/issues/4)
  completed through PRs #5 and #6: mainline adoption, refreshed experimental
  skills and the context-preview verification fix.
- [Internal documentation CI](https://github.com/rahuldave/nbinlineai/issues/9)
  tracks lightweight document validation with the existing required gates on
  both integration branches.
- [Notebook-agent initiative](https://github.com/rahuldave/nbinlineai/issues/2)
  remains open for handoff primitives, then one-kernel RLM/Python 3.14 work, then
  possible multiple-kernel research. These are proposals, not shipped features.

PRs into the non-default experiment use `Refs #N` and explicit issue links.
GitHub does not interpret their PR closing keywords as it does for default-base
PRs. Update issue status after merge against its stated acceptance scope; do not
close a release or initiative issue merely because one slice reached the experiment.

The installed bundle comes from `rahuldave/agent_gest_git_skills`, reviewed at
`bc22ef179e345396869309bfac1a596c515b69b4` in shared PR #47
(following the initial adoption from shared PR #45). Exact revision
and managed file hashes are recorded in `.agents/gest-git-install.json`. Refresh
intentionally from a reviewed source commit; preserve local settings and project
instructions. The shared source PR must be accepted before merging an adoption
of an unmerged shared revision. Until then this is a reproducible preview.

## Verification and CI

`Justfile` maps the existing project commands. Validation runs for any PR base
and pushes to `main` and the persistent experiment. Both branches require
**Python, frontend, package, and browser** and **Runtime compatibility**.
Both checks report even when the change qualifies for documentation validation;
there are no top-level path filters that leave a required check missing.

Only a confidently classified change wholly within Markdown files under
`internal_docs/` qualifies for the lightweight path. It validates the documents
and their local links without building the extension, running the browser suite
or starting the platform matrix. Mixed changes, public docs, examples/notebooks,
code, dependencies, packaging and workflow changes take the full path. Manual
runs and uncertain/empty comparisons do not qualify for a documentation skip.
Renames and deletions must not hide a changed non-documentation path. A failed
classification or document check cannot become a successful required gate, and
an unexpectedly skipped validation job is not passing evidence.

`scripts/docs_ci.py check-docs` checks local filesystem targets of inline and
reference Markdown links throughout `internal_docs/`, ignoring fenced/inline
code examples. It does not fetch external URLs or validate heading fragments.
This is a bounded document check, not a complete Markdown renderer or website
crawler.

The full source path runs lock/static checks, Python and frontend tests, type
checking, build/relink, distribution validation, clean wheel installation and
the deterministic browser suite sequentially, and also validates internal-doc
links so mixed changes receive that check. Full runtime compatibility still
requires every platform matrix job to pass. Workflow/helper changes themselves
take this full path. See the workflow files and their helper tests for the exact
classification, validation and gate contracts.

The runtime summary also checks completion markers for all 14 expected matrix
variants. Keep that inventory in `scripts/docs_ci.py` and its focused tests in
sync with intentional matrix changes; missing or unexpected variants fail the
gate rather than silently reducing coverage. Each job uploads only its own
marker from runner temporary storage; checked-in files cannot seed the result.
Successful repeat uploads replace the same job's artifact.

The clean wheel step checks package/extension discovery. It does not substitute
for verifying a Git-source installation when source packaging changes. Keep the
[Git installation instructions](../docs/development.md#install-the-ongoing-experimental-branch-in-a-jupyterlab-project)
current. Run the meaningful changed-boundary tests locally; use CI for the clean
checkout and platform gates. Record failures and actual limits instead of
describing skipped or unrun checks as passing.

Browser checks use their own temporary config/notebooks/keys and server on 8897,
refuse an occupied port, and stop owned children. Never use, stop or restart the
user's server on 8888. Build/relink before browser tests; do not build artifacts
while browser tests run. Credentialed/live-provider tests remain explicit opt-in.

## Delivery and cleanup

Merging a topic into the experiment updates installable Git source. It does not
change PyPI, the published version, a tag or the public documentation site.
The uv lock records the exact source commit. Promotion from experiment to main
is a separate PR, and a requested stable release follows
[the release checklist](releasing.md), including artifacts, clean installation,
publication and public verification.

Require PRs and successful CI on both persistent integration branches. Configure
GitHub requirements using actual emitted check names; do not require an
unavailable second account's approval or bypass a configured review gate.
After a confirmed merge, synchronize the actual base and remove only verified
merged temporary topics with no remaining worktree or stack dependents. Preserve
the experiment even if it was the head of a promotion PR.

Retire only worktrees owned by the completed task. Finish their workers and stop
their owned processes, inspect tracked and untracked changes plus any valuable
ignored files, and verify that the commits were integrated into the intended
target. For cherry-picked or squashed work, verify patch equivalence explicitly.
Preserve active, dirty, user-retained, primary and unrelated worktrees. Remove
eligible worktrees normally with `git worktree remove` from a surviving checkout;
do not routinely force removal or delete their directories by hand. Delete a
temporary topic branch only after its worktrees and stack dependents are clear.
Check integration independently against the intended target: `git branch -d`
may consult a topic upstream and is not proof of integration. Prefer a clean
checkout on the actual target for deletion; retain the branch if no suitable
checkout exists or normal deletion is refused. Fetch the actual target without
switching the primary checkout to it, and fast-forward a checked-out target only
in its known clean checkout. Verify the primary checkout remains on `main`;
report any worktree retained and why.

Before handoff, verify owned test processes exited, remove owned scratch files,
and report PR/review/check state and publication state separately.


## Protection status (2026-09-25)

Active repository rulesets require PRs, resolved review threads, successful
checks, and an up-to-date base, and prevent force pushes or deletion of persistent
branches. There are no bypass actors. Required approval count is zero because
independent agent evidence under the author account is not a second GitHub
approver; independent adversarial review and the user's merge decision remain
explicit workflow requirements.

- Notebook mainline ruleset: `24000314`; source gate and runtime aggregate.
- Notebook experiment ruleset: `24000315`; source gate and runtime aggregate.
- Shared skill repository mainline ruleset: `24000310`; `verify-skill-package`.

The mainline ruleset was updated to the two stable gates after PR #6 merged;
the experiment uses the same pair. Inspect live rules before integration if
repository policy changes. Documentation-aware validation preserves these
required check names and does not change branch protection.

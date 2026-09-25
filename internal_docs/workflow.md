# Project workflow

## Branches and review

`main` is the default branch and stable source line.
`codex/agentic-notebook-experiments` is a persistent, installable experimental
integration target. Start each experimental slice from its current remote commit
on a temporary `codex/*` topic; create a PR back to the experiment. Stable fixes
may target `main` when their scope calls for it. Record the chosen base and commit
before editing. Never infer that every PR should target the default branch.

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

## Tracking and installed skills

Use the project-local `.agents/skills/gtw/SKILL.md` router. Native Gest records
task hierarchy, dependencies and execution notes in ignored `.gest/`; its graphs
are automatic. Serialize Gest operations. GitHub issues preserve durable intent:

- [Workflow adoption](https://github.com/rahuldave/nbinlineai/issues/1) is complete
  when this workflow is integrated into the experiment.
- [Notebook-agent initiative](https://github.com/rahuldave/nbinlineai/issues/2)
  remains open for handoff primitives, then one-kernel RLM/Python 3.14 work, then
  possible multiple-kernel research. These are proposals, not shipped features.

PRs into the non-default experiment use `Refs #N` and explicit issue links.
GitHub does not interpret their PR closing keywords as it does for default-base
PRs. Update issue status after merge against its stated acceptance scope; do not
close a release or initiative issue merely because one slice reached the experiment.

The installed bundle comes from `rahuldave/agent_gest_git_skills`. Exact revision
and managed file hashes are recorded in `.agents/gest-git-install.json`. Refresh
intentionally from a reviewed source commit; preserve local settings and project
instructions. The shared source PR must be accepted before merging an adoption
of an unmerged shared revision. Until then this is a reproducible preview.

## Verification and CI

`Justfile` maps the existing project commands. Source validation runs for any PR
base and pushes to `main` and the persistent experiment. Its single required
check, **Python, frontend, package, and browser**, runs lock/static checks, Python
and frontend tests, type checking, build/relink, distribution validation, clean
wheel installation and the deterministic browser suite sequentially. Existing
subscription runtime compatibility CI retains its platform matrix; its stable
**Runtime compatibility** gate requires every matrix job to pass. Both gates
apply to both integration targets. See the workflow files for exact commands.

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

Before handoff, verify owned test processes exited, remove owned scratch files,
and report PR/review/check state and publication state separately.

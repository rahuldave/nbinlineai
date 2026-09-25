# Task prompt: implement notebook execution handoffs

Copy the text below into a new Codex task. The referenced spec records the
approved behavior; the runtime feature is not implemented by these documents.

---

Implement the first same-notebook execution handoffs in nbinlineai:
`add_code_cell_and_execute`, `prompt_and_run`, and `run_and_prompt`.

## Branch and workspace

This is experimental work. Its integration target and PR base are
`codex/agentic-notebook-experiments`, **not `main`**. Keep the primary checkout
at `/Users/rahul/Projects/nbinlineai` on `main`. Do not run `git checkout`,
`git switch`, or otherwise change branches in that original folder. Do not
implement there. Fetch current refs, inspect existing worktrees, and create a
new owned physical worktree with a temporary `codex/*` topic based on
`origin/codex/agentic-notebook-experiments`. All file edits, builds and tests
belong in that worktree; use its absolute path explicitly in commands. Record
the starting SHA, worktree path/owner, topic, PR base and primary path/branch.
Preserve unrelated worktrees and persistent branches. Never rebase or force-push
the persistent experiment merely to obtain these documents.

The spec and this prompt are intended to exist on both integration branches.
Check their presence in the fetched experimental ref before editing. If missing,
locate their documentation PR/commit on `main` and integrate only that reviewed
documentation into the experimental worktree through the normal PR workflow;
do not silently switch the implementation target to `main` or merge unrelated
mainline work. If that documentation is still awaiting review/integration, report
the concrete dependency before starting runtime changes.

## Read first

From the new worktree, read in this order:

1. `AGENTS.md`, `internal_docs/README.md`, `internal_docs/developer_handoff.md`.
2. `internal_docs/notebook_execution_handoff_spec.md` — the approved contract.
3. `docs/architecture.md` — especially One prompt request, Context and live
   state, Native notebook execution, Processes/event loops, and Source map.
4. `internal_docs/cell_kernel_model_and_context_selection.md`,
   `internal_docs/bundled_tools.md`, `internal_docs/workflow.md`.
5. `internal_docs/notebook_execution_handoffs.md` and
   `internal_docs/jupyter_ai_compatibility.md` for pinned prior art and boundaries.
   The one-kernel RLM/Python 3.14 note is later-stage context only.

Use the installed `.agents/skills/gtw/SKILL.md` router and relevant stage skills.
Consult the project Gest store from the primary repository, serializing Gest
commands, while keeping source writes in the new worktree. Search for the
specification task `sxlqqqlxoxxssqouoytzwsnqzttlpzuz` and its linked `spec`
artifact. The committed spec is authoritative if the local artifact is absent
or stale. Track implementation with new follow-on tasks under the notebook-agent
initiative; do not reopen/complete the specification task as if it were runtime
delivery. Use `gpl`/`gis` for concrete tasks and dependency order, and preserve
GitHub issue discipline under https://github.com/rahuldave/nbinlineai/issues/2.
Do not create additional user-owned Codex tasks unless requested. Delegate useful
bounded coding work to gpt-6-sol agents in separate owned worktrees with explicit
file ownership, preserving others' changes; centralize Gest/GitHub integration.

## Execution contract

Follow Solveit's terminal queued handoff: the current AI turn or Python caller
finishes before its successor executes. `run_and_prompt` means code followed by
a **new separate real AI question**. `prompt_and_run` means a real AI question
explicitly selects/creates code, finishes, then that code executes.
`add_code_cell_and_execute` inserts and runs code without implying another AI
question. Support AI tools and direct Python helpers, including existing IDs
and newly inserted code as specified. Never execute arbitrary answer fences.

Use the ordinary notebook queue and current kernel namespace. Provider
orchestration already runs in Jupyter Server. Add no sidecar, nested event-loop
patch, parallel kernel lane or blocking wait for a successor behind its caller.
Solveit's sidecar-backed nested `Message.execute` is a separate capability.

Bind work to the live notebook/model/session/kernel and stable cell IDs, with
source preconditions, chain/step IDs and per-execution output attribution.
Preserve native execution/outputs/counts, Run All ordering and failure handling,
Keep, cancellation, provider defaults/overrides, context/tool selection and the
64,000-character submission estimate. Transfer the bounded actual predecessor
result to the successor. Handle ambiguous queue overlaps, stale targets, lost
acknowledgements and duplicate requests without replaying effects. End terminal
tool turns under host control in both API and ChatGPT subscription paths.

Start by inspecting the queue/executor, both tool loops, action-reply lifetime,
Python comm bridge and output/context boundaries identified in the spec. Choose
minimal signatures, finite limits and queue integration, record those choices,
then implement in coherent verified slices. The design direction is approved;
ask only if a concrete blocker would require changing it. Defer MCP/ACP adapters,
RLM, Python 3.14 concurrency and multiple kernels.

## Verification and delivery

Use uv and the worktree's environment. Add meaningful tests at changed Python,
frontend and transport boundaries, then use a real isolated JupyterLab/kernel
with deterministic providers on owned port 8897. Rebuild/relink before browser
tests, never concurrently with them. Never use, stop or restart the user's
JupyterLab on 8888; no paid provider tests without authorization.

Update experimental docs/examples and the developer handoff. Obtain independent
adversarial review at the exact base/head, address findings, commit/push verified
checkpoints and open PRs explicitly targeting the experimental branch. Require
its actual CI gates; report results and request merge only if that particular
runtime PR has not already been authorized. No PyPI release, version bump or
runtime promotion to `main` is authorized by this prompt. Keep the experiment
installable from Git. After an authorized merge, verify integration and retire
only clean, integrated worktrees/topics owned by this task, following the
installed cleanup policy. The primary checkout must still be on `main`.

# Spec: notebook execution handoffs

Status: **approved direction, awaiting implementation**, 2026-09-25. This is a
design contract, not shipped behavior. The user approved recording this spec on
`main` and making the same file available on `codex/agentic-notebook-experiments`.
All runtime work belongs on topics based on that experimental branch, in owned
worktrees. The primary checkout stays on `main`.

## Problem statement

A notebook agent can already inspect and edit live cells. It needs to hand off
to ordinary code execution and resume with a separate AI question, while keeping
the notebook's cells, Python namespace, outputs and execution order authoritative.
The two directions are independently useful: asking the AI to prepare code and
then running it, or running known code and then asking the AI about its result.

The existing per-notebook queue is serial. A job cannot await a successor placed
behind itself in that queue. A Python cell likewise cannot keep its main-shell
request active while awaiting another ordinary execution on the same shell.
Scheduling a successor and returning avoids both cycles.

## Proposed solution

### Three public operations

Names below are the desired capabilities. Exact Python signatures, schema
shapes, settings and UI wording are implementation choices, subject to these
semantics. Support both opt-in AI tools and direct notebook Python helpers.

| Operation | Contract |
| --- | --- |
| `add_code_cell_and_execute` | Insert ordinary code, return/bind its stable cell ID, and schedule that cell after the caller finishes. It does not imply another AI question. |
| `prompt_and_run` | Schedule a real AI question. That question must explicitly create or select one identified code cell, finish its AI turn, and hand off to native execution of that cell. |
| `run_and_prompt` | Schedule supplied code in a new cell, or an explicitly identified existing code cell, followed by a separate real AI question that receives the result of that particular execution. |

Use an unambiguous choice between new source and an existing target; reject
conflicting arguments. Existing code targets and code just inserted by the AI
are both supported. Cell placement is separate from the execution address.
Never infer executable code by scraping arbitrary fenced blocks from an answer.

```text
add_code_cell_and_execute: caller finishes -> C1
prompt_and_run:            caller finishes -> P1 finishes -> C1
run_and_prompt:            caller finishes -> C1 finishes -> P1

Existing AI question P0 can also insert/select C1 and terminally request C1:
P0 finishes -> C1                         (no new question required)
P0 finishes -> C1 finishes -> P1          (run_and_prompt composition)
```

Here P is an ordinary tagged AI question with its paired Markdown answer; C is
an ordinary code cell. `prompt_and_run` is not a second model request hidden
inside the originating Python cell. If called as a tool by P0, it schedules a
distinct P1 after P0 ends. The lower-level terminal execution handoff also lets
an already running question choose a cell directly. An AI question that does
not select a valid code target must report that no execution was scheduled;
prose that merely promises to run code is not sufficient.

### Follow Solveit's queued handoff

The pinned public `dialoghelper.run_and_prompt` adds runnable code, adds a
runnable prompt after the returned message ID, and returns `StopResponse` to end
the current AI tool loop. This supports **P0 -> C1 -> P1**; the continuation is
a separate prompt, not an embedded prompt executed inside C1. Its client shows
the request order; the private gateway scheduler was not inspected. See the
[pinned helper](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L629-L636).

The same library's `Message.execute`/`Dialog.execute` instead keep a caller
alive while awaiting another message. Their
[implementation](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L838-L855)
selects a persistent sidecar subshell. The
[source notebook](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/nbs/00_core.ipynb)
explains that a nested main-queue request would deadlock. That is a different
contract from scheduling and returning. A subshell is not an isolated Python
subinterpreter.

For this slice, use terminal handoffs on the ordinary notebook queue. No new
sidecar is required by the chosen semantics. nbinlineai already runs its model
orchestration in Jupyter Server, outside the kernel; “same notebook execution
thread” refers to serialized notebook work and ordinary main-shell code
execution, not moving provider networking into the kernel. See
[Architecture: processes and event loops](../docs/architecture.md#processes-event-loops-and-cancellation).
If implementation uncovers a concrete need for a still-active caller to await
nested execution, explain that incompatibility before expanding the design.

### Handoff lifecycle and queue ownership

1. Capture and validate the originating live notebook/model, session, kernel,
   source cell and current execution/AI run. Give the chain and each step an ID.
2. Prepare the identified successor(s) and acknowledge an in-memory schedule.
   An acknowledgement is neither execution completion nor a saved notebook.
3. End the current AI tool turn, or let the originating Python cell return.
   The Python helper returns a nonblocking receipt; it does not wait for the
   successor's output. Awaiting browser acknowledgement, if offered, must not
   become waiting for another kernel execution.
4. Once the predecessor has completed successfully, validate the bound targets
   again and run the next step through the normal notebook executor.
5. Record the actual result and terminal status, then permit the next step.

The host must recognize a terminal handoff in both API and ChatGPT subscription
tool loops. Do not implement it as a magic response string which relies on the
model deciding to stop. Validate handoff groups before effects: reject ambiguous
multiple terminal requests, and never execute tool calls after a terminal
handoff. Specify and test the policy for mixed tool groups during implementation.
A later cancellation/failure of the predecessor must prevent queued successors.

The continuation must outlive the current model turn's action-reply registry,
whose IDs presently expire when that turn ends. Give this responsibility an
explicit owner/lifetime; do not keep an old prompt request open to wait for it.
Use the existing execution-bound Python comm pattern as a starting point for
direct helpers. A timeout or lost acknowledgement is uncertain, never a reason
to replay a possibly executed action automatically.

Native Run All may already have later work queued. Define continuations as part
of their predecessor's ordered work: run a valid successor before unrelated
later work in that batch, without awaiting a tail job from inside itself. If the
same cell is also an upcoming explicit target in that batch, coalesce only the
matching target/source/step obligation; stop visibly on conflicting obligations.
Do not deduplicate intentional runs in later user batches. Cover these cases in
tests rather than assuming appending to the current queue supplies the order.
An implementation may reject a genuinely ambiguous overlap explicitly; it must
not silently reorder dependencies or execute a cell twice.

### Identity and source preconditions

An executable address is **captured live notebook model + stable cell ID**,
bound to the originating document/session/kernel lifecycle. Position, the
currently selected cell, an execution count and a filesystem path alone are
insufficient. `after_cell_id` controls insertion placement only.

Record the expected source (or its collision-resistant digest) when accepting
a target. Check it again before dispatch. Moving an unchanged cell must not
retarget the run. Deletion, conflicting edits, a changed session/kernel, or
closing the bound document invalidates pending work visibly. Capture relevant
prompt metadata/settings consistently with the normal request lifecycle, and
do not let a focus change redirect an action. Edits after execution has begun
cannot undo that execution; retain the executed source as result provenance.

Results need the chain/step ID, cell ID and Jupyter execution `msg_id` (where
applicable). Bind output through that request's `parent_header`, not by reading
the cell's latest output later. A rerun of the same cell is a different result.
Notebook cell IDs are only unique within a notebook; see
[nbformat](https://nbformat.readthedocs.io/en/5.6.1/format_description.html#cell-ids)
and [Jupyter messaging](https://jupyter-client.readthedocs.io/en/stable/messaging.html).

### Execution results and successor prompts

Execute code through the normal JupyterLab executor and bound kernel. Preserve
native output rendering, execution counts, error handling and the live Python
namespace. Insertion plus raw `exec(source)` in a hidden tool is not equivalent.

Record that run's status and a bounded representation of stdout/stderr, text
results and truncation/omission information. Only successful code execution
permits a successor prompt and transfers this result to it. On code error,
retain the error details in the failed step's visible result and stop the chain;
do not create a model request to interpret the error in this version. Support native
output updates/clears consistently or document a tested bounded textual
representation. Rich outputs remain visible in the code cell; this slice does
not promise image interpretation. Label result material as execution data, not
instructions. Ordinary snapshots and `read_cell` currently omit code outputs,
so explicit result transfer is new work.

Each successor is a normal AI question with a stable ID, paired answer, current
live snapshot, ordinary provider/default resolution, tool selection, context
selection and Keep behavior. Budget its explicit predecessor result alongside
fixed prompt/tool material before optional notebook context, under the existing
64,000-character host-submission estimate. Preserve preview/execution accounting
and both model transports. A fresh snapshot need not contain the same source
that ran earlier; identify those two facts separately.

A kept/skipped AI question does not make a new model call and must not replay a
previous handoff or its effects. If `prompt_and_run` reaches a kept answer and
has no fresh explicit handoff, stop with a visible skipped/no-new-execution
outcome. No old code choice may be silently recovered and executed.

### Failure, cancellation and bounds

Expose requested, scheduled, running, completed, failed, cancelled and skipped
states as appropriate, with target identity and a concise reason when stopped.
First version stops the chain on code error or cancellation. Prompt-after-error
debugging is a later explicit option. Cancellation cannot reverse effects that
already happened; never report a stopped running cell as never executed.

Use finite chains with one explicit successor choice per transition and a
shared, documented chain limit. Successors must inherit the chain budget rather
than resetting it with every prompt. Prevent cycles/unbounded prompt creation;
do not add automatic repair/retry loops. Distinguish `maxToolSteps` within one
model turn from this cross-turn limit. Once-per-step protection applies within
a live acknowledged run; no crash-durable exactly-once guarantee is claimed.

## Scope

### In scope

- One open JupyterLab notebook, its existing kernel and ordinary execution queue.
- The three operations, both AI-tool and direct Python entry points, explicit
  existing/new code targets, terminal handoff and bounded result transfer.
- Native Shift+Enter/Run All integration, compact status, cancellation and
  meaningful deterministic tests for both provider transports.
- Experimental Git-source installation remains buildable; update experimental
  documentation/examples and the handoff without presenting this as a release.

### Out of scope

- New sidecars/subshells, background or parallel kernel execution, blocking
  nested-await helpers, cross-notebook/kernel routing, and durable recovery.
- RLM, Python 3.14 free-threading/subinterpreters and changing minimum Python.
  Those are the next investigation after these primitives, before multi-kernel.
- New MCP/ACP adapters or combining external agent histories/authentication.
  Preserve a callable contract a later adapter can reuse. Jupyter AI's existing
  individual `run_cell` path is not equivalent to our native executor; see the
  [compatibility investigation](jupyter_ai_compatibility.md).
- A stable release, PyPI publication or promotion of runtime work into `main`.

## Acceptance criteria

1. AI-origin add/execute inserts an identifiable ordinary code cell; the AI turn
   ends, that code runs once in the same namespace, and no next prompt is implied.
2. `prompt_and_run` creates a real question, explicitly selects one newly created
   or existing code cell, ends the question, and executes that exact source once.
3. `run_and_prompt` covers both supplied source and existing ID: code completes,
   then a separate question uses that run's bounded actual result.
4. Direct Python callers return receipts and finish before successor work;
   no nested event loop or busy-main-shell wait occurs. The same three public
   meanings hold through both entry points.
5. Focus changes, offscreen/unsaved cells and reordering preserve identity;
   edits, deletion, document closure, kernel restart and source mismatch stop
   pending work. No stale count/output is mistaken for a new result.
6. Native Run All and overlapping requests preserve dependency order and batch
   error semantics without duplicate effects. Cancellation and lost replies
   never trigger automatic replay; kept answers never replay a handoff.
7. Both transports end terminal tool turns under host control. Invalid/mixed
   terminal groups, step limits and chain limits have deterministic coverage.
8. Text output, errors, truncation, output updates/clears and later reruns are
   covered. Successor context/settings/tools and preview/budget accounting remain
   consistent with the ordinary prompt contract.
9. Verify changed boundaries in Python/frontend unit tests and an isolated real
   JupyterLab/kernel with deterministic providers on owned port 8897. Rebuild
   and relink before browser tests. Never use the user's port 8888 or paid APIs.

## Open implementation choices

Choose minimal signatures, receipt/status placement, numerical chain/output
limits, queue integration structure and mixed tool-group validation policy.
Record the choices and acceptance evidence. These choices do not require
reopening the approved execution model. If a choice would require concurrency,
weaken cell/source binding or change the meanings above, discuss it first.

## References and tracking

- [Architecture and processing flow](../docs/architecture.md), especially one
  prompt request, native execution, processes/event loops and the source map.
- [Current handoff](developer_handoff.md), [cell/kernel model](cell_kernel_model_and_context_selection.md),
  [tool/bridge contract](bundled_tools.md), [project workflow](workflow.md).
- Source boundaries: `src/executionQueue.ts`, `src/index.ts`, `src/context.ts`,
  `src/frontendActions.ts`, `src/insertTools.ts`, `src/insertToolsProtocol.ts`,
  `nbinlineai/prompt.py`, `nbinlineai/frontend_bridge.py`,
  `nbinlineai/kernel_insert_tools.py`, `nbinlineai/kernel.py` and transport tests.
- [Preserved execution research](https://github.com/rahuldave/nbinlineai/blob/f2cdf022e67661048186bf41ccf23c621828997e/internal_docs/notebook_execution_handoffs.md)
  and [one-kernel RLM/Python 3.14 research](https://github.com/rahuldave/nbinlineai/blob/f2cdf022e67661048186bf41ccf23c621828997e/internal_docs/one_kernel_rlm_python314.md).
  Both also live on the experimental branch. This spec resolves the first
  research note's open choices; later research is context, not implementation scope.
- [Implementation task prompt](notebook_execution_handoff_task_prompt.md).
- [GitHub initiative #2](https://github.com/rahuldave/nbinlineai/issues/2) stays open.
  Gest specification task: `sxlqqqlxoxxssqouoytzwsnqzttlpzuz`, under
  `szoozvxqrkutslwunnnlmrmpytvywsrr`. A linked `spec` artifact mirrors this file;
  committed files are the portable source of truth. Use `gpl`/`gis` to create
  follow-on implementation tasks; completing this spec is not implementation.

Tag discovery: reuse `development`, `research` and `leaf`; add `spec` for the
artifact/document work. Do not label this slice a release or completed runtime
feature. No AST impact pass is needed for prose-only changes. Implementation
must inspect semantic dependers at the queue, executor, terminal tool loop,
comm/bridge, output attribution, Keep and context-budget boundaries.

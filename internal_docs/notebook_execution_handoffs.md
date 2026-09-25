# Notebook execution handoffs and agent identity

**Research and design note, 2026-09-25. No implementation is claimed here.** The
shipped baseline is nbinlineai 0.1.14. This note gathers the Solveit,
Jupyter AI/MCP, Jupyter kernel, and Python interpreter findings in one place,
then narrows the first product steps to **one open notebook and its existing
Python kernel**. Read the [developer handoff](developer_handoff.md),
[cell/kernel model](cell_kernel_model_and_context_selection.md),
[bundled tool contract](bundled_tools.md), and
[Jupyter AI coexistence investigation](jupyter_ai_compatibility.md) for current
behavior. This is a proposal; no new tool, queue operation, or prompt behavior
has shipped.

## The question: two directions of handoff

The useful primitives are best named by their arrows, since names such as
`prompt_and_run` can otherwise mean either “start by prompting” or “prompt,
then wait for a run”:

| Direction | Meaning | First same-notebook example |
| --- | --- | --- |
| **Prompt → run** | A running AI question finishes and transfers execution to a specifically identified code cell. | The AI inserts code, receives its cell ID, and requests that code cell's native execution. No further AI turn is implied. |
| **Run → prompt** | After a specifically identified code execution settles, a new AI question runs with that execution's result. | The AI asks to run code and then continue with “Continue.”; a Python code cell could also schedule a following AI question without waiting for it. |

The composed path is **AI question P0 → code C1 → AI question P1**. Solveit's
public helper calls this `run_and_prompt` because P0 is already in progress
when the helper is called: it queues C1 and then P1. We use “prompt → run”
for the first edge and “run → prompt” for the second. A fixed sequence laid
out in advance can already use native Run All; the missing ability is a
*dynamic handoff* chosen during a running cell or AI turn.

For a Python-origin meaning of `prompt_and_run`—code C0 asks AI question P1,
then runs already identified code C2—the same two edges compose as
**C0 → P1 → C2**. P1 cannot be expected to select C2 if C2 was fixed before
P1 ran; selection by the AI is a prompt → run action made during P1. Product
names should be chosen only after these meanings are fixed.

## What nbinlineai already identifies and executes

| Identity or action | Shipped behavior | Limit for a handoff |
| --- | --- | --- |
| Cell source and order | The captured live JupyterLab model supplies stable cell IDs, unsaved source, metadata, and order, including offscreen cells. `list_cells`, `find_cells`, `read_cell`, `insert_code`, and ordinary-cell edits use IDs. Insertion returns the new ID. [Source](../src/context.ts), [actions](../src/frontendActions.ts). | An ID names source in **one** notebook. An inserted code cell is unexecuted. No model-callable `execute_cell` action exists. |
| AI question and answer | Ordinary Markdown cells carry `metadata.nbinlineai`; an answer links to its question through `promptCellId`. An answer cell may be reused on rerun, subject to Keep. [Source](../src/index.ts). | This links cells, not one code execution to one continuation. Creating ordinary Markdown is not the same as creating and scheduling an AI question. |
| Active AI turn | Server `run_id` and action `request_id` bind an SSE/action-reply exchange to the prompt, notebook session, and kernel. Browser checks the captured panel/model and original cells. [Source](../nbinlineai/frontend_bridge.py), [source](../src/index.ts). | IDs expire when the turn ends. The action bridge is not a continuation queue or an external MCP endpoint. |
| Native execution | `INotebookCellExecutor` serializes AI questions and ordinary cells per notebook model. Normal code uses JupyterLab's cell executor; an AI question submits through Jupyter Server. A failure stops the rest of a native Run All batch. [Source](../src/index.ts), [queue](../src/executionQueue.ts). | The queue takes operations supplied by native execution, not a durable dependency such as “after this new cell, run that new question.” A code cell cannot synchronously wait for another main-shell execution request sent to itself. |
| Code-origin browser communication | `insert_tools()` sends a nonblocking comm that carries the Jupyter execute-request ID and source code-cell ID. The frontend verifies that exact request, panel/model, and kernel before inserting a declaration cell. [Source](../nbinlineai/kernel_insert_tools.py), [source](../src/insertTools.ts). | This proves a code cell can identify its own execution to the browser without blocking. It does not schedule an AI question or code execution. |
| AI context | The snapshot carries cell source, metadata, and code execution counts; live values and functions come from the kernel. Ordinary code outputs are absent from the snapshot and from `read_cell`. [Source](../src/context.ts), [model](cell_kernel_model_and_context_selection.md). | P1 must be given **C1's actual execution result**, rather than merely C1's source or latest execution count, to be a reliable continuation. |

The [nbformat cell-ID rule](https://nbformat.readthedocs.io/en/5.6.1/format_description.html#cell-ids)
requires uniqueness within a notebook only. In this first scope, the effective
cell address is **captured live notebook model + cell ID**. At execution time
we additionally check **session + kernel identity** and the cell's expected
source. The source precondition matters because an agent may inspect C1 and
then a human may edit it before it runs. The Jupyter
[request `msg_id` and output `parent_header`](https://jupyter-client.readthedocs.io/en/stable/messaging.html)
can correlate kernel output with one execution; a handoff also needs a
transient step/run ID that survives from request through successor scheduling.
Cell position remains a presentation choice, not the execution address.

## Solveit prior art: what is actually known

In the inspected public `dialoghelper` source at
[`99d2efa`](https://github.com/AnswerDotAI/dialoghelper/tree/99d2efa595239eaac76f727a7e574b6b9ea4b816),
[`run_and_prompt(code, prompt="Continue.")`](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L692-L699)
adds a code message with `run=True`, adds a prompt message with `run=True`
*after the returned code-message ID*, then returns `StopResponse`. `add_msg`
prepares a runnable code message with `%%py`
([source](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L591-L629)),
and [`run_msg` sends IDs to `add_runq_`](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L761-L768).
The current AI tool loop therefore finishes before the queued code and new
prompt run. The new prompt is a separate notebook message; it is not embedded
inside the code message. The public client demonstrates the request and queue
order, while the gateway's internal scheduling code was not available for
inspection.

Solveit exposes scheduling to notebook Python through `add_msg(..., run=True)`
and [`run_msg(ids)`](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L761-L768).
The helper submits work rather than synchronously making the queued message
finish. The [Solveit reference](https://gist.github.com/jph00/9e7b444aba5ecf6d14295ba2cee890c3)
states that declared AI tools are looked up and executed in the dialog kernel.
That establishes the tool location; it does not by itself establish where
ordinary prompt inference runs in the private Solveit service.

`Message.execute`/`Dialog.execute` are a **different** mechanism: they can
await another named message while their caller is still active. Their public
code selects a [persistent kernel sidecar](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L921-L939),
and the [source notebook's explanation](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/nbs/00_core.ipynb)
says an ordinary request to the busy main shell would deadlock. Its public
client calls this a persistent subshell, not another isolated Python
interpreter. This nested-await capability is **not needed** for a terminal
handoff in our first same-kernel step.

Solveit's multi-dialog client can address another dialog by path or an
existing kernel ID through
[`JupyAsyncCellsClient`](https://github.com/AnswerDotAI/jupyasyncclient/blob/5314e5272cce6feefc120bb90c6776e019965d94/jupyasyncclient/files.py#L111-L165).
That is useful later prior art, but cross-notebook routing is outside this
first proposal.

The [published Solveit RLM example](https://share.solveit.pub/d/024412293157f7aabef9fc2e7746e8bd)
uses yet another path: it creates an in-process
[`TerminalInteractiveShell`](https://github.com/AnswerDotAI/toolslm/blob/67b3d6262535fc12629fca8b82bb455d07563d07/toolslm/shell.py#L37-L46),
puts `context` and `llm_query` into its namespace, and lets an outer model
call `run_repl`, which calls `shell.run_cell`. The inner `llm_query` makes a
separate model request from Python. This inspected example does not use a
Jupyter subshell or a CPython subinterpreter; its enclosing notebook code
execution stays active until the call returns.

## Jupyter AI, ACP, and MCP prior art

The [Jupyter AI user guide](https://jupyter-ai.readthedocs.io/en/stable/users/)
describes a chat persona acting as an ACP client for an external agent such
as Claude Code or Codex, while the Jupyter MCP server supplies notebook
tools. In the inspected [ACP client](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/blob/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0/jupyter_ai_acp_client/default_acp_client.py),
the external session receives configured MCP servers and has its own chat
session/serialization. The agent's model loop is outside the notebook kernel.
MCP calls go **agent → Jupyter server/notebook**; MCP does not automatically
provide a callable from a code cell back into that same agent turn.

The inspected [Jupyter AI `run_cell`](https://github.com/jupyter-ai-contrib/jupyter-ai-tools/blob/4d1c823ed9e2d58c2a5690c8b7c440045df1ee01/jupyter_ai_tools/toolkits/jupyterlab.py#L77-L132)
accepts a cell ID and optional notebook path. In the default non-RTC path,
its [JupyterLab command](https://github.com/jupyter-ai-contrib/jupyterlab-ai-commands/blob/b696dbf2e1d4f56524a521183ad9fc94a8071170/src/notebook-commands.ts#L815-L930)
calls `CodeCell.execute` directly for code and treats Markdown as a no-op;
that bypasses our `INotebookCellExecutor` and cannot run an inline AI question.
The tool does not return cell outputs. If its wait times out, the underlying
command continues; a timeout is not an execution result. Jupyter AI's native
Run All path does reach our executor. An authenticated
[Codex ACP example](codex_acp_example_run.md) verified reads, an edit, and
three explicit code-cell executions; it did not run an inline AI question.
The [coexistence investigation](jupyter_ai_compatibility.md) records the
released component versions and this command distinction. A future MCP
adapter should call the *same handoff semantics* as inline AI rather than
assuming Jupyter AI's current individual `run_cell` is equivalent.

The two agents also have distinct histories. A Jupyter AI `.chat` and an
nbinlineai AI question are separate objects, with separate authentication,
permissions, and context choices. Linking an external agent turn to a
notebook execution would require an explicit correlation ID; changing the
cell-execution primitive alone does not merge their histories.

## Jupyter's loop and Python 3.14: later execution venues

An ipykernel notebook has a persistent asyncio loop and permits top-level
`await`, but an awaited ordinary cell still owns its main-shell execution
request. Synchronous blocking in that cell can also block its loop.
[IPython documents the persistent loop](https://ipython.readthedocs.io/en/stable/interactive/autoawait.html),
and [JEP 91](https://jupyter.org/enhancement-proposals/kernel-subshells/)
explains why ordinary shell requests are serial and how an optional subshell
thread can receive concurrent requests. A subshell shares the kernel process
and namespace; on an ordinary CPython build it does not provide another GIL.

Python 3.14 introduces standard-library
[`concurrent.interpreters`](https://docs.python.org/3.14/library/concurrent.interpreters.html)
and [`InterpreterPoolExecutor`](https://docs.python.org/3.14/library/concurrent.futures.html#interpreterpoolexecutor).
An interpreter on another thread has its own GIL, but its namespace is
isolated and values/results must be passed explicitly. The optional Python
3.14 free-threaded build is a separate facility; it is not enabled simply by
using Python 3.14. Neither facility makes Jupyter accept another main-shell
request while an ordinary cell is active. `await`ing an interpreter worker
can leave the event loop responsive while the cell itself remains busy;
launching it and returning frees the main shell but requires worker/result
identity. The [Python asyncio guide](https://docs.python.org/3.14/library/asyncio-eventloop.html#executing-code-in-thread-or-process-pools)
shows interpreter pools as an executor option. Project minimum Python is
still 3.12; the handoff records an isolated Python 3.14 package smoke, not
this execution architecture.

Subshells, subinterpreters, independent kernels, and nested RLM sessions
therefore remain future *execution venues*. The first notebook handoff
should keep the ordinary bound kernel and preserve native cell semantics.
The next research step, after the handoffs, is
[RLM and Python 3.14 inside one kernel](one_kernel_rlm_python314.md). Multiple
notebooks and kernels follow only after that one-kernel work.

## Small same-notebook steps

These steps are independent in behavior and can be reviewed separately. They
are design recommendations, not an implementation commitment.

1. **Prompt → run: execute an identified code cell after the AI turn ends.**
   The current question may point at an existing code cell or use `insert_code`
   and its returned ID. The request names that cell ID in the captured live
   model and checks the expected source, session, and kernel at execution.
   The AI turn finishes before the notebook queue runs the cell through the
   normal executor. Its output, error, cancellation, and execute-request ID
   belong to a single recorded run. This can stand alone: the user sees the
   result and no further AI call occurs. No synchronous kernel tool waits for
   its own main shell.
2. **Run → prompt: schedule one identified AI question after that code run.**
   A successful code run permits the successor; failure or cancellation stops
   it by default, consistent with native Run All. The successor must be a
   real tagged AI question with its own cell ID and normal Keep/provider
   settings. It receives a bounded representation of **that run's actual
   stdout/text result/error and any omitted-output notice**, explicitly
   identified by the run, rather than depending on source or current kernel
   state alone. This result enters the existing prompt budget before optional
   notebook context. A successor created by an AI tool is the second half of
   Solveit's `run_and_prompt` pattern.
3. **Permit a code cell to request a following prompt without waiting.**
   This is the Python-origin form of run → prompt. The current execution's
   request ID and source cell ID can establish origin, following the existing
   `insert_tools()` comm pattern. The request is acknowledged as *scheduled*;
   the code cell returns, and only then can the queued AI question run. A
   synchronous `await` inside that same code cell would reintroduce the
   main-shell wait cycle if the AI question needs the kernel.

Composing steps 1 and 2 produces **P0 → C1 → P1**. Composing step 3 with
step 1 produces **C0 → P1 → C2** when P1 chooses C2. The first cut needs only
one successor and no loops, cross-notebook actions, background workers,
automatic retries, or crash recovery. Every transition should expose its
target and status in the notebook so the user can tell what will run next.

### Conditions that make the first cut trustworthy

- **A target is a cell, not a position.** `after_cell_id` describes where to
  place a cell; it does not identify which cell will execute. Reordering
  should not silently retarget a queued run. Missing or changed targets fail
  visibly rather than selecting the new “next” cell.
- **A result is a run, not the latest cell output.** A run ID and Jupyter
  execute-request ID correlate the scheduled step, native cell outputs, and
  successor. Rerunning the cell later must not change what an already queued
  continuation means.
- **A model turn is a boundary.** A terminal AI tool may schedule a successor
  but must end before that successor enters the notebook queue. A Python
  helper may schedule a successor but must return before it runs. Avoid
  waiting on an ordinary request to the same occupied kernel.
- **Preserve existing policy.** Native Keep, cancellation, failure stop,
  provider choice, prompt context selection, tool declarations, and the
  64,000-character host-submission estimate apply to successor AI questions.
  Scheduling alone must not bypass them or replay earlier cell effects.
- **Make uncertainty visible.** An acknowledgement proves an in-memory
  schedule, not saved notebook state or durable recovery. A browser close,
  kernel restart, deleted cell, source change, or lost reply must not be
  described as completed execution. Do not infer execution from a code cell's
  old count or source.

The first useful acceptance sequence is: **P0 inserts C1 → P0 requests
execution of C1 → P0 ends → C1 runs once → P1 runs once with C1's observed
result**. A separate sequence starts with **C0 scheduling P1**, proving that
Python-origin prompting does not need a nested event loop or a second kernel.
Those two sequences exercise the two arrows independently before any RLM or
external-agent adapter is added.

## Open choices before coding

1. Should prompt → run allow an existing cell only, or also the cell just
   returned by `insert_code` in the same AI turn? The latter is the useful
   agent path; both need the same source check.
2. Where should a continuation show its predecessor's result to the user?
   The code cell already shows outputs. The AI request needs an explicit,
   bounded result reference, but duplicating huge outputs into Markdown would
   make the notebook harder to read.
3. Is a failed-code continuation allowed as an explicit later option for
   debugging? The first cut should stop on failure and make retry an explicit
   new run.
4. Should the user-facing controls name the two arrows, or expose one
   “Run this, then continue” action built from them? The arrows remain
   separate capabilities regardless of the control wording.

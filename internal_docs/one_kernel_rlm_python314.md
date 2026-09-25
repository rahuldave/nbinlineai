# RLM execution inside one notebook kernel

**Research and design note, 2026-09-25. No product implementation is claimed.**
This follows [notebook execution handoffs](notebook_execution_handoffs.md).
The order is deliberate: first establish **prompt → run** and **run → prompt**
for identified cells in one notebook; next investigate an RLM and Python 3.14
execution *within that notebook's single kernel*; only then consider multiple
notebooks or kernels. The [developer handoff](developer_handoff.md) remains the
source for shipped behavior. nbinlineai still supports Python 3.12 and has not
implemented an RLM, subinterpreter worker, or subshell scheduler.

## What an RLM requires, separately from concurrency

The [published Solveit RLM example](https://share.solveit.pub/d/024412293157f7aabef9fc2e7746e8bd)
has an outer model with a `run_repl` tool. That tool runs Python in a
`TerminalInteractiveShell` populated with a `context` string and an
`llm_query` function; `llm_query` makes a separate model request from Python.
The REPL can search, transform, or slice a large context and send selected
pieces to child model calls. Its output is capped before going back to the
outer model. The shell comes from
[`toolslm.get_shell`](https://github.com/AnswerDotAI/toolslm/blob/67b3d6262535fc12629fca8b82bb455d07563d07/toolslm/shell.py#L37-L46).

That example proves the **algorithmic loop**—outer model → Python REPL →
optional child model → result → outer model—inside a notebook. It does not
require Python 3.14, a Jupyter subshell, or another Jupyter kernel. Its
enclosing code cell stays active until the outer call returns. An RLM can
therefore be demonstrated before solving background execution; the latter
matters when the user wants to keep using notebook cells during the run.

For this project, there are three distinct questions:

1. **Who owns the outer model loop?** Notebook Python, a background kernel
   task, or a Jupyter Server/ACP process?
2. **What state does the REPL see?** The live notebook namespace, a separate
   namespace in the same interpreter, or a truly isolated interpreter?
3. **When may the main shell take the next cell?** Only after the current
   cell returns, or concurrently through an optional subshell?

These choices are independent. “One kernel” means one Jupyter kernel process
and session; it need not mean one Python interpreter or one execution thread.
The model service/server may live outside the kernel without making a second
Jupyter kernel.

## Execution venues and their blocking behavior

| Venue within one kernel | State visible to agent Python | While the outer call runs | Can the next ordinary main-shell cell run? | Value and cost |
| --- | --- | --- | --- | --- |
| **Main cell, in-process REPL** (Solveit example) | A REPL namespace explicitly populated from notebook Python; arbitrary notebook objects can be passed by reference because this is the same interpreter. | Synchronous model/REPL calls hold the code cell; blocking calls can stall its event-loop thread. | **No**, until the cell returns. | Immediate RLM proof on today's Python. It does not yield a responsive notebook during a long call. |
| **Main cell using `await`** | Live namespace, if the coroutine uses it. | The event loop can service other callbacks while awaiting I/O, but the main-shell execute request remains active. | **No** on the ordinary shell. | Better I/O responsiveness, no second main-shell execution. |
| **Kernel background task or ordinary thread, launched then cell returns** | Same interpreter and potentially live namespace; threads require synchronization. | Work can continue after the launching cell ends, provided its owner/lifecycle remains alive. An asyncio task needs the loop to keep running; a thread can make blocking network calls. | **Yes**, after the launching cell returns, subject to contention and Jupyter's normal queue. | A one-kernel long-running session, but progress, cancellation, result attribution and kernel restart must be explicit. On a conventional GIL build, Python CPU work in ordinary threads does not gain multicore parallelism. |
| **Server-owned outer loop, main kernel as REPL** | Live notebook namespace when the server sends normal `execute_request`s; no direct shared Python objects in the server. | Server/model may continue between kernel calls. A kernel call waits for an idle main shell. | **Yes between calls**; a pending ordinary execution cannot overtake an occupied main shell. | Closest to notebook-directed agent turns and cell handoffs. Needs a bounded execution/result bridge, not a nested call from a busy main cell. |
| **Jupyter subshell** (JEP 91) | Same kernel process namespace, via a separate subshell thread. | Another shell request can be served while the parent shell is busy. Each subshell serializes its own requests. | **No for the parent shell**, but a *subshell-targeted* request may run concurrently. | Useful for live inspection or nested execution with shared state. Optional kernel/client protocol support, thread safety, and output attribution matter; it is not another GIL. |
| **Python 3.14 subinterpreter on another thread** | Its *own* namespace/import state. Inputs and results are copied or passed through cross-interpreter channels; notebook objects do not appear automatically. | Its own GIL permits true CPU parallelism with the main interpreter, provided code/dependencies work there. | **Yes if the launching cell returns**; **no if it keeps awaiting the worker**. | A persistent isolated REPL/agent worker in the same kernel process. Needs a dispatcher and explicit state/result messages. It is not a Jupyter shell address by itself. |
| **Optional free-threaded Python 3.14 build** | Same interpreter/namespace for ordinary threads. | Threads can run Python CPU code in parallel when the runtime and extensions allow it. | Governed by Jupyter shell scheduling exactly as above. | A separate runtime choice with dependency/thread-safety questions; does not make cells or agent turns concurrent by itself. |

The [IPython autoawait guide](https://ipython.readthedocs.io/en/stable/interactive/autoawait.html)
says ipykernel's asyncio loop persists across notebook cells. `await` is
therefore possible inside a cell, but does not end its execution request.
Calling `asyncio.run()` in that same running loop is not the mechanism for an
inner agent call. A long synchronous model loop can also prevent that loop
from servicing messages. A background asyncio task launched from a cell is a
possibility, not yet a reliable notebook-facing session: it needs a durable
run handle and must avoid trying to reenter the occupied main shell.

[JEP 91](https://jupyter.org/enhancement-proposals/kernel-subshells/)
defines an optional `subshell_id` on shell requests. It targets a different
thread in the **same** kernel process/namespace. The spec also gives each
subshell its own execution count/history, routes output through parent
headers, and warns that kernels without subshell support may ignore an
unrecognized `subshell_id` and use the main shell instead. Thus any use must
verify support rather than assume it from a Python or ipykernel version.
Solveit's separate
[`Message.execute` sidecar](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L921-L939)
is evidence for this nested-await style; its `run_and_prompt` handoff is a
different, terminal scheduling mechanism.

## The Python 3.14 opportunity, precisely

[`concurrent.interpreters`](https://docs.python.org/3.14/library/concurrent.interpreters.html)
creates interpreters and offers `exec`, `call`, `call_in_thread`, and
`create_queue`. Creating an interpreter alone starts **no** thread; invoking
it on another thread is what allows overlap. Isolated interpreters have had
their own GIL since Python 3.12; Python 3.14 makes this accessible through a
standard-library API. Most passed objects are copied, often via pickle.
Third-party extension support is incomplete, and interpreter isolation is
not a security boundary. These facts make it well suited to an explicitly
messaged RLM worker, not a transparent second view of a notebook namespace.

[`InterpreterPoolExecutor`](https://docs.python.org/3.14/library/concurrent.futures.html#interpreterpoolexecutor)
offers a higher-level thread-plus-interpreter pool. It pickles each callable,
arguments, and result; each worker has a separate `__main__`, imports, and
`sys.stdout`. A function or object defined only in a notebook cell should
not be assumed to arrive with its live globals. A pool worker can persist,
but a generic pool does not itself give one named RLM session affinity to one
worker. For a stateful REPL, a specifically owned interpreter and a clear
message channel may be easier to reason about than unconstrained pool
scheduling. That is a design inference, not something tested in nbinlineai.

Python 3.14 also has an
[optional free-threaded build](https://docs.python.org/3.14/whatsnew/3.14.html#free-threaded-mode-improvements).
It differs from normal 3.14 interpreters with their own GILs. Native
extensions must support free threading or may
[re-enable the GIL](https://docs.python.org/3/howto/free-threading-extensions.html).
It may help a shared-namespace threaded agent, but does not change
Jupyter's shell protocol or the need to manage concurrent access to notebook
state. The project's earlier Python 3.14 install smoke validates packaging,
not either concurrency behavior.

## Where the RLM loop could live

**A. Entire loop in one code cell.** This is the Solveit-style research
baseline. Its `context`, REPL, and child model calls can be ordinary Python
objects. The user can watch output from that cell but cannot execute another
ordinary cell until it finishes. This is a valid RLM even without a new
notebook execution primitive.

**B. Outer loop off the main shell; notebook main shell is the REPL.** The
server or external agent owns the model turn, asks the notebook to execute
identified cells, receives the actual execution result, and continues. The
main shell is free between calls. This composes directly with the proposed
prompt → run → prompt handoffs. A cell-origin request must be terminal: the
origin cell schedules the model continuation and returns before that
continuation asks the same main shell to execute anything. The existing
nbinlineai browser tools and kernel inspection tools are useful boundaries,
but they do not currently expose a general model-callable notebook-cell
executor or a full RLM REPL session; see the
[tool contract](bundled_tools.md). An external Jupyter AI/ACP agent can own
the outer loop, but its current single-cell `run_cell` path has the
[executor mismatch](jupyter_ai_compatibility.md) described in the handoff
note.

**C. Outer loop off the main shell; RLM REPL in a worker interpreter.** This
could keep the main notebook shell usable while an isolated REPL explores a
bounded snapshot of context and makes child model calls. The worker returns
progress and final results by messages to its owner. If it needs *live*
notebook variables, it must request a main-shell operation through the
handoff bridge, which may wait for the main shell to become idle. A worker
cannot simply use its own `exec` as a Shift-Enter in the notebook's main
interpreter. Nor should it assume its stdout appears as a normal code-cell
output: it needs an explicit route and a run/cell identity.

**D. Subshell for shared-state nested execution.** A subshell could accept
kernel requests while a main code cell awaits a nested result, as in
Solveit's sidecar. This may be needed for a specific interactive UX, but it
changes the concurrency and state-safety contract. It is not a prerequisite
for the terminal handoffs or for an isolated-worker RLM.

The strongest first architecture to investigate **after** handoffs is B for
notebook-directed agent work and A as a minimal RLM proof. C answers the
user's Python 3.14 question: it offers useful parallelism and isolation
inside one kernel, if explicit state transfer is acceptable. D answers the
busy-main-shell/reentrant-execution question. These can coexist, but calling
all of them “run Python” would hide important differences from the user.

## Identity, progress, and deadlock boundaries

- **Name the work:** `notebook model/session/kernel + cell ID` addresses a
  notebook cell. A separate `run_id + step_id + Jupyter execute msg_id`
  addresses one execution. An RLM worker also needs a worker/session ID.
  These identifiers serve different scopes; Python subinterpreter IDs and
  Jupyter `subshell_id`s are not cell IDs.
- **Name the state transfer:** a worker can receive a snapshot of selected
  notebook content and serializable values, with an explicit size bound and
  provenance. It cannot inherit the unsaved live JupyterLab model or the
  main interpreter's arbitrary objects merely because it shares a process.
- **Return observed results:** progress, child-model answers, REPL output,
  errors, and cancellation should be attributed to the originating run.
  Later reruns must not silently replace an earlier RLM step's evidence.
  Worker output and standard Jupyter cell output have different capture paths.
- **Avoid cycles:** a main-shell cell awaiting a model turn that tries to
  execute another main-shell cell cannot complete. An `await` that yields
  asyncio control does not free that shell slot. A background or server-owned
  outer loop must begin any main-shell call only after the origin cell returns,
  unless it deliberately targets a supported subshell.
- **Bound recursion:** an `llm_query` child is a distinct model request, not
  automatically a continuation of the outer nbinlineai/ACP session. Depth,
  model budgets, output truncation, cancellation propagation, and visible
  trace need an explicit contract. The current nbinlineai subscription
  runtime is server-owned; the Solveit-style Python `llm_query` is not
  presently exposed by that runtime to notebook code.

## Proposed research order, without implementing it yet

1. Finish the two same-notebook handoff designs and their identity/result
   contract. They establish the “Shift-Enter on this exact cell, then
   continue” path independent of concurrency.
2. Reproduce the *behavioral* Solveit RLM shape conceptually on the current
   main-cell path: outer model, bounded REPL result, optional child model,
   and one final answer. Record that the cell remains busy.
3. Compare a server-owned outer loop against a launched kernel background
   task for a usable long-running one-kernel session. Determine the desired
   live-namespace access, progress display, cancellation, and restart story.
4. In an isolated Python 3.14 environment, evaluate a tiny interpreter
   worker for state persistence, message passing, dependency compatibility,
   result attribution, and behavior during an occupied main cell. This is a
   research probe, not a prerequisite for the basic RLM.
5. Investigate optional Jupyter subshell support only for a concrete need
   to execute against shared state *while* the parent shell is occupied.
   Verify actual kernel/client negotiation and output routing first.
6. After one-kernel semantics are stable, address other notebooks, kernels,
   cross-kernel routing, and shared substrates in a separate design.

### Sources and evidence boundaries

Primary sources above are the [Solveit published example](https://share.solveit.pub/d/024412293157f7aabef9fc2e7746e8bd),
[dialoghelper's sidecar source](https://github.com/AnswerDotAI/dialoghelper/blob/99d2efa595239eaac76f727a7e574b6b9ea4b816/dialoghelper/core.py#L921-L939),
[JEP 91](https://jupyter.org/enhancement-proposals/kernel-subshells/),
[IPython autoawait](https://ipython.readthedocs.io/en/stable/interactive/autoawait.html),
and the official Python
[interpreter](https://docs.python.org/3.14/library/concurrent.interpreters.html),
[executor](https://docs.python.org/3.14/library/concurrent.futures.html#interpreterpoolexecutor),
and [free-threading](https://docs.python.org/3.14/whatsnew/3.14.html#free-threaded-mode-improvements)
documentation. The option ranking and nbinlineai architecture implications
are inferences from those sources and the current repository. No live
subinterpreter, subshell, or RLM experiment was run for this note.

# ipylab and the frontend bridge nbinlineai needs

Research date: 2026-09-22. Inspected [ipylab](https://github.com/jtpio/ipylab) at commit [`083ca7c66c0696754bf3e789613cd13e7a3926b5`](https://github.com/jtpio/ipylab/tree/083ca7c66c0696754bf3e789613cd13e7a3926b5), cloned into a temporary directory. This is a source/API assessment, not an installed compatibility test. No ipylab dependency or runtime feature was added.

## Conclusion

ipylab provides a useful Python-to-JupyterLab connection through Jupyter Widgets. It can launch commands, manage widgets and menus, expose session information, and insert/run snippets in the active cell. It does not currently provide the complete, acknowledged, notebook-and-cell-specific read/edit interface that our AI tool loop needs.

Our extension already runs in the frontend and has `INotebookTracker`, notebook cell models, stable cell IDs, shared-model source editing/insertion, and native execution integration. The recommended next architectural step is a small request/reply interface around those existing facilities. Adopting ipylab would still leave us implementing that interface, while adding widget lifecycle/dependency requirements.

The recommendation is based on our product needs and the inspected code. It is not a claim that ipylab cannot be extended or cannot coexist with nbinlineai.

## Maintenance and compatibility facts

- Latest published release found: **1.1.0, June 24, 2025**. [PyPI](https://pypi.org/project/ipylab/1.1.0/)
- Latest `main` commit found: **June 26, 2025**, changing the minimum build JupyterLab requirement. [Commit](https://github.com/jtpio/ipylab/commit/083ca7c66c0696754bf3e789613cd13e7a3926b5)
- GitHub reported the repository was not archived. A repository's `updated_at` date is not evidence of a new code release.
- Version 1.0 added JupyterLab 4 support; version 1.1 added menu/toolbar customization. [Changelog](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/CHANGELOG.md)
- The inspected frontend manifest targets JupyterLab 4.x packages and depends on the Jupyter Widgets stack. This is a declared compatibility range, not proof that every operation works on our exact JupyterLab version. [Manifest](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/package.json)

## What is exposed

The [Python `JupyterFrontEnd` widget](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/ipylab/jupyterfrontend.py) exposes `shell`, `commands`, `sessions`, `menu`, and `toolbar`. It has `ready()` for frontend initialization. These are explicit wrappers, not an unrestricted Python proxy for every JavaScript object in JupyterLab.

| Need | ipylab support | Consequence for nbinlineai |
| --- | --- | --- |
| Open files/terminals, launch existing commands | `app.commands.execute(id, args)` | Useful for UI automation and prototypes. Behavior and targeting depend on the invoked command. |
| Add widgets/panels, menus and toolbar items | Public wrappers | Useful if we want Python-driven UI components; our extension already supplies its own controls. |
| Observe notebook/session changes | Shell signals and session information | Gives shell/widget/session information; does not constitute a complete notebook cell model. |
| Replace active cell with a snippet | `app.menu.insert_snippet(...)` | Real live editing, but it uses the active frontend cell, replaces its source, and changes it to code. It is not a stable-ID patch operation. |
| Insert and run a snippet | `app.menu.run_snippet(...)` | Runs through frontend notebook actions, but Python does not receive a command result/completion from `execute`. |
| Read arbitrary unsaved cell source and metadata by ID | No dedicated public wrapper found | We need a custom frontend operation that reads the model, including offscreen cells. |
| Atomically insert/patch a named cell and return its ID/revision | No dedicated public wrapper found | We need explicit targets, result messages, and edit-conflict behavior. |
| Enforce Keep answer and report code/AI run completion | Not a nbinlineai-aware contract | Our native executor already supplies the relevant behavior; any bridge should use it deliberately. |

Sources: [Python menu API](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/ipylab/menu.py), [snippet implementation](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/src/widgets/menu.ts#L231), [sessions](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/ipylab/sessions.py), [shell](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/ipylab/shell.py).

## The concrete command-result gap

In [Python `CommandRegistry.execute`](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/ipylab/commands.py#L59), the method sends a widget message and has no return/future for the frontend command's result. In [the frontend `_execute`](https://github.com/jtpio/ipylab/blob/083ca7c66c0696754bf3e789613cd13e7a3926b5/src/widgets/commands.ts#L107), the promise returned by the JupyterLab command registry is discarded with `void`.

Thus an AI tool cannot use this method alone to truthfully return “cell inserted, ID X,” distinguish a completed run from a merely requested run, or read back arbitrary command results. `await app.ready()` only establishes initial readiness; it does not change this execute contract. `SessionManager.refresh_running()` separately supports awaiting its session refresh, so it would be inaccurate to say ipylab has no asynchronous operations at all.

The open [awaitables request #11](https://github.com/jtpio/ipylab/issues/11) asks for result-returning command execution. [Issue #140](https://github.com/jtpio/ipylab/issues/140) reports a timing problem chaining cell insertion and text replacement. That report illustrates the concern; it is not a compatibility test of every current snippet helper, and fixed sleeps are not a completion protocol.

## Why active selection is insufficient for AI tools

A person can switch notebooks or click a different cell while a provider response is in flight. A command that edits “whatever is active now” can then act on a different target from the original prompt. An operation must carry the originating document/session identity and cell ID through the entire request, and reject an unavailable target rather than silently using current selection.

This distinction already exists in our implementation:

- [`src/context.ts`](../src/context.ts) iterates the ordered notebook model until the captured prompt ID. It reads current source from shared models, including unsaved edits and offscreen cells.
- [`src/index.ts`](../src/index.ts) uses `getCell(panel, id)` and `ensureOutput(panel, promptId)`, inserts the paired answer through `model.sharedModel.insertCell(...)`, and updates its source with `setSource(...)`.
- [`nbinlineai/handlers.py`](../nbinlineai/handlers.py) receives the frontend snapshot and resolves the specified session/kernel for the request.

We already possess the frontend capability. Imported Python functions and server-side model tool calls do not yet have a general API for requesting those operations and receiving their results.

## Proposed architecture, not implemented

Keep two kinds of operations explicit:

1. **Python tools:** inspect variables, calculate, access files, or call user functions in the existing kernel through `KernelDispatcher`.
2. **Notebook operations:** read/insert/patch live cells through the owning frontend document. Coordinate them from the Jupyter server, with a correlated reply from that frontend.

A possible transport extends the existing server-to-browser event stream with a typed action event, plus an authenticated reply endpoint. Another option is a dedicated WebSocket. Widget comms can be used for a future Python-facing API, but ipylab's command method alone does not supply the response contract. The transport choice needs a small prototype before commitment.

Each operation should include a run/request ID, document/session identity, target cell ID, operation name and bounded arguments. Mutations also need an expected revision or source hash. Replies should identify success/failure, affected/new cell IDs, and the resulting revision or returned source. Apply source/metadata changes in shared-model transactions and define undo behavior. Do not report success before the frontend reply arrives.

Timeouts, browser disconnect, closed documents, deleted cells, duplicate/replayed messages, two views of the same notebook, and edits made while the model is thinking all need explicit handling. Retrying an insertion must not create duplicate cells. Prompt/answer metadata and Keep settings need to survive operations on AI cells.

### Kernel/event-loop implications

ipylab is a widgets/comm connection to the browser, not a separate server that isolates execution concerns. The kernel, Jupyter server and browser already run separately. Server-to-frontend notebook operations can be awaited on the server without occupying the Python kernel with a waiting tool body.

Do not implement a synchronous kernel tool that sends a new execution to the same busy kernel and then waits for it. Nor should a callback depend on the same blocked kernel processing a reply before it can return. An actual async design and lifecycle tests are needed; `asyncio.run()` or a fixed sleep inside a tool is not the solution. Cell execution operations should join the existing notebook queue only in a way that avoids waiting on their own active run and respects effective Keep choices.

## Context-selection controls need less machinery

The requested per-cell include/exclude switches, whole-notebook mode, and a nearby-cell window can be implemented by extending the **existing frontend snapshot builder** plus server validation/context assembly. The frontend already knows ordered cells and the current prompt ID. They do not require ipylab or a Python-to-browser bridge just to choose source at request start.

Tools that ask to inspect a different live cell midway through a model response do need a request/reply interface. Automatic snapshot selection and interactive tool operations should share cell identity/selection rules, but they are separate features. They remain deferred until their context semantics are chosen, as requested.

## Recommendation

Use ipylab as a reference and optional interoperability option. Build the small notebook-specific protocol in nbinlineai when live-cell tools enter scope, reusing our existing frontend model and execution facilities. Begin with confirmed read-only live-cell operations, then insertion/editing with conflict checks, then execution orchestration. Do not add ipylab as a dependency merely to dispatch commands we can already invoke directly from our frontend.

This assessment does not expand or approve the pending bundled-tools release. See the [dialoghelper capability catalog](dialoghelper_tool_catalog.md) and [cell/kernel context notes](cell_kernel_model_and_context_selection.md).

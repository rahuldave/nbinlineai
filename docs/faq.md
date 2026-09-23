---
title: FAQ
---

# Frequently asked questions

These answers describe **nbinlineai 0.1.5**. See the [illustrated user guide](user-guide.md) for setup and controls, and [Architecture](architecture.md) for implementation details.

## Running cells and keeping answers

### Does Run All run the AI cells?

Yes, starting with **0.1.5**, JupyterLab's normal **Run All Cells** includes AI prompts. Code and AI cells execute in notebook order. An AI response and its function calls finish before the next selected cell runs.

Every prompt still respects its effective **Keep answer** choice. Run All does not force protected prompts to rerun.

In **0.1.4 and earlier**, native Run All rendered AI Markdown without making AI requests. Update the package and restart the whole Jupyter server to use the new behavior.

### Which wins: the notebook toggle or the cell toggle?

An explicit cell choice wins. Otherwise, the cell inherits the notebook's **Keep AI answers** setting, which defaults to on.

| Notebook default | Cell choice | Completed answer |
| --- | --- | --- |
| On | Inherit | Kept |
| Off | Inherit | Regenerated when executed |
| Either | Explicitly on | Kept |
| Either | Explicitly off | Regenerated when executed |

Changing a cell checkbox makes an explicit choice. Click **Use notebook setting** beside an overridden checkbox to restore inheritance. The cell checkbox displays the effective setting. Notebook and cell choices are saved with the notebook.

### Does Keep AI answers on prevent every API call?

No. It protects **completed, nonempty answers**. A new unanswered prompt can run once. A failed, cancelled, empty, or deleted answer can be retried.

If you need to execute only Python code, select the relevant code cells instead of assuming Keep answer disables AI throughout the notebook.

### What is a useful setting while developing a notebook?

Turn the notebook's **Keep AI answers** off. Unpinned AI prompts regenerate when you execute them. Turn **Keep answer** on for individual prompts once you want to preserve their answers.

For reading or working through an established notebook, leave the notebook default on. Check for any explicit cell overrides that still permit reruns.

### Do the other Run actions follow the same rules?

Yes. Normal selected-cell execution, Shift+Enter, Ctrl+Enter, and execution of cells above or below use the same native execution integration. **Run AI** also respects protection. Running an individual prompt does not automatically execute the code above it.

Plain Markdown, including answer cells, renders normally. Rendering an answer does not make an AI request.

### What happens after an AI error or cancellation during Run All?

The remaining cells in that execution batch are skipped. Resolve the problem and start another run when ready. A failed or cancelled answer is retryable even if Keep answer is on.

Cancellation is not an undo operation. A function call already sent to the kernel may still take effect, and completed side effects remain.

## Corrections and context

### Can I edit an AI answer directly?

Yes. Double-click the answer's Markdown, correct its explanation or code, then render it and save. Later AI prompts read the edited text when they run, provided the completed prompt/answer pair is above them and within the context limits.

There is no hidden, original answer that overrides your edit. A rerun of the original prompt replaces its answer, including your manual edits; turn that prompt's Keep answer on to preserve them.

### Why did a lower answer not change after I corrected one above?

Editing does not automatically regenerate later answers. A later prompt needs to run again with Keep answer off to produce a new response from the corrected context.

**Keeping an answer does not hide it from context.** It prevents regeneration of that answer. A corrected, protected answer above a new or rerun prompt is still available to it.

There is currently no stale-answer indicator or automatic tracking of which answers depend on an edited cell.

### How do I stop an early mistake from spreading?

1. Correct the earliest wrong answer or add a Markdown note explaining the correction.
2. Pin a corrected answer using that prompt's Keep answer checkbox.
3. Allow affected later prompts to rerun, using the notebook default or their cell overrides.
4. Execute those later cells in order so each new response sees the corrections and preceding updated answers.

If you edit a *question* instead, rerun it before using its answer as history; otherwise the notebook can contain a revised question paired with an old answer to a different question.

### Do failed or partial answers become conversation history?

Only completed, paired AI answers are included as conversation history. Failed, cancelled, and still-running answers are excluded, even if they contain some text.

Manually editing that partial text does not mark the exchange completed. To use it as context, copy the corrected text into an ordinary Markdown cell above your next prompt, or rerun the original prompt successfully.

### Does the AI see every cell and all Python variables?

No. It receives bounded code and ordinary Markdown **above the current prompt**, plus earlier completed AI exchanges. Code outputs, plots, image pixels, raw-cell content, later source cells, and automatic file contents are excluded.

Explicit references such as ``$`score` `` retrieve selected live values. A live value can have been created by a cell run below the prompt or out of order. Source context follows notebook order; live values reflect the current kernel. See the [context table and limits](user-guide.md#4-what-context-does-the-ai-receive).

## Kernel, browser, and server changes

### What happens if the kernel is lost or restarted?

Saved prompt and answer Markdown, notebook defaults, and cell overrides remain in the `.ipynb`. The kernel's variables, imports, and function definitions are lost when its process is replaced.

Start or reconnect to a Python kernel, then rerun the code that defines any live values or tools you need. A displayed old answer is not evidence that its old variables still exist.

### Why is a variable missing after restarting and running the whole notebook?

If an earlier AI tool call created or changed the variable, a kept answer skips that request and **does not replay the function call**. Normal code cells rerun, but preserving an AI answer does not reconstruct its old side effects.

For repeatable setup, create important variables in ordinary code cells. Otherwise, deliberately allow the relevant AI prompt to rerun, remembering that the model may choose different tool calls this time.

### What if the kernel changes while an AI request is running?

An in-flight provider request has already received its context snapshot. Replacing the kernel does not update that snapshot. Before a tool call, the extension checks that the notebook session still points to the kernel selected at the start; switching the session to another kernel is rejected. Restarting the same kernel can preserve its identity while clearing its Python state, so the old variables and functions may no longer exist.

Cancel the AI request, recreate the required Python state, and rerun the prompt. Changing or restarting a kernel during a tool-using response is not a reliable way to continue it.

### Does Interrupt Kernel cancel the AI request?

Not necessarily. Provider networking runs in Jupyter Server, separately from the Python kernel. **Interrupt Kernel** targets kernel execution; it does not by itself cancel a model's HTTP response.

Use the AI prompt's **Cancel** control to cancel that request. The extension also attempts to interrupt its own actively executing kernel operation when cancelled. Already-dispatched function calls and completed side effects cannot reliably be retracted.

### What happens if I reload the browser or lose the connection?

A request cannot resume its stream after reconnecting. Reloading or closing the notebook disconnects the client request; a network failure while the page remains open may leave a partial answer and an error. If partial text was saved before the interruption, it can remain in the notebook with an incomplete status.

Reopen the notebook, check that a Python kernel is connected, and rerun the prompt if needed. Reloading the browser alone does not necessarily restart the kernel: a still-running kernel can retain its state. Unsaved notebook changes have JupyterLab's usual save/recovery behavior; save important corrections normally.

### Does closing the notebook cancel a tool's effects?

No. Closing a notebook stops the extension's ongoing request, but it does not undo files written, variables changed, or other actions already performed by a tool. A kernel execute request already dispatched may still run.

## Saving, installation, and limits

### Which JupyterLab version do I need?

nbinlineai 0.1.5 requires **JupyterLab 4.2 or newer within version 4**. The native cell-execution hook used for Run All is unavailable in JupyterLab 4.0 and 4.1. Installing or upgrading nbinlineai lets the package manager enforce that requirement.

### Does Clear All Outputs remove AI answers?

No. AI answers are Markdown cell source, not code-cell outputs. Delete the answer cell if you want to remove it. Its prompt becomes eligible to generate a new answer, even with Keep answer on.

### Will these notebooks work without nbinlineai?

Their saved prompts and answers remain readable Markdown. AI requests require the extension in a running JupyterLab interface. Headless notebook execution does not load its browser plugin and therefore does not execute those Markdown cells as AI prompts.

### Do I lose API keys when I create another uv environment?

Normally no: environments under the same operating-system account share the saved per-user credential file on the computer running Jupyter Server. A different account, machine, or configuration root can use a different file.

Keys are not stored in the notebook. See [key storage](user-guide.md#7-where-keys-are-stored) for paths, environment overrides, and removal behavior.

### I updated the extension. Is refreshing the page enough?

Restart the **whole Jupyter server**, then refresh the browser. Restarting only the notebook kernel does not reload the server extension. Install the package in the environment that runs JupyterLab, not solely in a separate kernel environment.

### Does Learning mode guarantee the AI will never reveal a solution?

No. Its instructions ask for Socratic questions and small hints, but this is model guidance, not an enforced assessment restriction. You can edit the style instructions in Configure AI. See [response styles](user-guide.md#response-styles).

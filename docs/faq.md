---
title: FAQ
---

# Frequently asked questions

These answers describe **nbinlineai 0.1.6**. See the [illustrated user guide](user-guide.md) for setup and controls, and [Architecture](architecture.md) for implementation details.

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

The remaining cells in that execution batch are skipped. Resolve the problem and start another run when ready. After pressing Cancel, wait for **Cancelled** and for the Cancel button to become disabled before retrying; **Cancelling…** means the earlier request is still finishing. Another Run All issued during that time can join the pending cancelled work and stop too. A failed or cancelled answer is retryable even if Keep answer is on.

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

### How does nbinlineai choose context when the notebook is large?

Version 0.1.6 uses separate character limits, with different selection rules:

| Material | Selection rule |
| --- | --- |
| Ordinary code and Markdown above the question | Start at the **top of the notebook**, include up to 50,000 source characters, and stop. The last included cell can be cut partway through. Later source is omitted. |
| Completed earlier AI exchanges | Work backward from the most recent complete prompt/answer pair, keeping whole pairs within 16,000 characters. Stop at the first pair that does not fit, then send the retained pairs in their original order. |
| Current question | Accept up to 16,000 characters before inserting live variable values. |
| Number of preceding cells | Reject requests with more than 200 cells above the question, counting all cell types. This is a validation limit, not a rule that chooses 200 cells. |

There is no relevance search or automatic summary. Ordinary source currently favors **earlier** cells; only AI history favors recent exchanges. If the newest AI exchange alone exceeds its history budget, no earlier AI history is included. These limits do not modify or delete notebook cells.

The brief “Using … preceding cells” status counts the submitted cells; it does **not** guarantee that all their text reached the model. There is currently no detailed inclusion preview or visible truncation warning.

### What happens if the request exceeds the model's context window?

The character limits above do **not** guarantee that a request fits the selected model. nbinlineai does not yet count the complete request in model tokens or budget against that model's context window. Instructions, cell labels, inserted variable values, tool descriptions, and tool conversations add more input. Tool calls and results accumulate during a run without another context-selection pass.

If the provider rejects an oversized request, the run fails. In 0.1.6, this normally appears as **“Model request failed”**; context-overflow errors do not yet have their own helpful message. nbinlineai does not automatically summarize, shrink, or retry the request. An error also stops the remaining cells in the current Run All batch.

Partial answer text may remain, but the failed exchange is excluded from later AI history. Tool actions already completed remain in effect, so inspect any changes before rerunning. A failure on a later tool round can happen even though the first request fitted.

To reduce the request, use a shorter notebook containing the needed setup and notes, shorten long source cells and questions, offer fewer tools, or pass a small summary variable instead of a large value. A model with a larger context window may help with provider overflow; it does not change nbinlineai's own character and cell limits. There are no per-cell context exclusion controls yet.

### Is a long answer hitting an output limit the same problem?

No. A request can fit but the generated answer can reach its output allowance. nbinlineai reports **“Model response exceeded the output limit”** when the provider signals that condition, and marks the answer failed. It does not automatically continue the answer. Ask a narrower question or request a shorter response. See the [architecture's context and output limits](architecture.md#selection-budgets-and-provider-overflow).

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

## Tools and examples

### Can I put all my tool references in an ordinary Markdown cell?

That cell supplies context, but does not register callable tools. The `&` references must appear in the **current AI prompt**. References in past AI prompts also do not carry forward. Import the functions into the kernel first, and use `print(tools_markdown())` from `nbinlineai.tools` to generate a list you can paste and shorten. See [Tools and examples](tools.md).

The same scope rule applies to `$` references: ordinary Markdown and previous AI cells do not cause fresh variable lookups. References inside quotations or fenced code in the current AI prompt are still recognized.

### Why can't the file tools see my latest edit?

`list_notebooks`, `find_notebook_cells`, and `read_notebook_cell` inspect **saved `.ipynb` files**. Save your edits first, and check the path relative to the kernel's current working directory. To read the open notebook including unsaved changes, offer `list_cells` and `read_cell` instead. Automatic context also uses the current frontend source, but only above the prompt.

### Does listing all tools give the AI access to every function in the package?

No. `tools_markdown()` lists ten bundled tools from an explicit registry; it does not list helpers or automatically expose the Python namespace. You choose which references to paste into each prompt. The model can call only functions registered for that request. Ordinary functions run with the Python kernel's permissions; the four live notebook tools have a separate, limited browser interface.

### Can the AI read cells below my question now?

Only when you explicitly provide a tool that can do so. `list_cells` and `read_cell` inspect the current notebook, including below the question. Saved-file tools can also read other cells or notebooks from disk. These results enter the current tool conversation; automatic context still stops above the prompt. Whole-notebook and nearby-cell context selectors are not implemented.

### Does a tool insert a real note, or just text in the AI answer?

`insert_markdown` and `url_to_note` insert a separate, ordinary Markdown cell. The default position is after the AI answer, or you can ask for a particular cell ID. You can edit, move, or delete the note normally. Save the notebook to persist it. A note above a later AI prompt becomes ordinary source context.

`read_url` only returns page text to the current model conversation. Use `url_to_note` to keep an excerpt in its own cell. Tool results are not stored as a separate transcript in notebook metadata.

### Will rerunning or cancelling create or remove notes?

A deliberate rerun can insert a new note; it does not replace or remove notes from previous runs. Keep answer skips the completed request and therefore skips its tools. Cancel stops waiting for further work but does not undo an insertion already performed. If a connection fails just after insertion, check the notebook before retrying: the note may exist even if its acknowledgement was lost.

Repeated delivery of the same action within one live request is deduplicated. A new AI run is a new request and can intentionally repeat the action.

### What happens if I switch notebooks while a tool runs?

The action stays bound to the original notebook, session, and prompt; switching tabs does not redirect it. Closed notebooks, deleted target cells, and changed sessions fail clearly. The extension does not fall back to whichever cell happens to be selected.

### Why can't I call `insert_markdown(...)` directly in Python?

The kernel does not own the browser's document model. `list_cells`, `read_cell`, `insert_markdown`, and `url_to_note` are imported for tool descriptions, then handled through the frontend interface during an AI request. Their direct Python stubs raise an explanatory error. The other six bundled tools work directly in Python as well as through AI tool references.

### Can these tools edit or execute existing cells?

The built-in frontend interface can list cells, read their source, and insert Markdown. It does not replace or delete existing cells, execute code, save files, or control another notebook. Your own Python tools can still perform whatever actions you implement; offering an `&` reference permits those real function calls.

### The extension works, but importing the tools fails. Why?

Your Jupyter server and notebook kernel may use different Python environments. Install nbinlineai in the kernel's environment as well, then rerun the import cell. After a kernel restart, previous imports are gone even though their code and old answers remain visible.

### Does Learning mode guarantee the AI will never reveal a solution?

No. Its instructions ask for Socratic questions and small hints, but this is model guidance, not an enforced assessment restriction. You can edit the style instructions in Configure AI. See [response styles](user-guide.md#response-styles).

---
title: FAQ
---

# Frequently asked questions

These answers describe version **0.1.10**. See the [illustrated user guide](user-guide.md) for setup and controls, and [Architecture](architecture.md) for implementation details.

## Running cells and keeping answers

### Where are the controls for an individual AI question?

Starting in **0.1.9**, a cell's available Context/Tools controls sit above its own content, aligned with the text/editor. An AI answer has a Context control above its answer text but no Tools switch. An AI question's **Run AI**, **Cancel**, **Keep answer** and **Override** row sits below its Context line, still above its question text. The **AI defaults** and **Context** rows at the top of the notebook set notebook-wide choices; the cell's Override changes only that question.

In **0.1.8 and earlier**, the controls were at the bottom. A checked Context immediately above an AI question could therefore belong to the preceding cell. Update to 0.1.9 for the clearer placement. The current question is labeled **Current question · always included** rather than showing an empty checkbox: its text is always sent.

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

### Are the starter suggestions separate prompt types? Do they run immediately?

No. They are buttons shown only in an empty AI question. Choosing one inserts ordinary editable text and focuses the editor. The suggestions disappear when you type or choose one; clearing the question brings them back. Use **Run AI** or Shift+Enter when you are ready to submit. The notebook's response style and Context mode still apply.

### How do I ask about one cell while retaining earlier background?

Context selects what the AI can read; your question tells it what to focus on. You can leave earlier definitions and notes included while asking for a narrow explanation. For example:

> Explain only the nearest code cell above this question. Use earlier cells to explain its variables and purpose, without summarizing the whole notebook.

For a new piece of code, try:

> Write code to plot the grouped results. Reuse the variable names and imports already in this notebook. Put the proposed code in a fenced Python block.

These are ordinary questions, not special commands or new response styles. Learning mode still asks for tutoring rather than a complete solution. If several earlier cells could be the target, name a distinctive function, variable, or heading in your question. Check that the relevant source is included in Context; a narrow question does not automatically include an unchecked cell.

### What does “above” mean when another AI answer is between my question and the code?

The shared instructions distinguish the **cell immediately above** from the **nearest code cell above**. The immediate cell can be an AI answer; the nearest code cell skips intervening notes and AI exchanges. The model receives their real notebook positions and whether their source is available, even when context trimming removes other cells.

“Section above” uses the nearest earlier ordinary Markdown heading cell through the cell before your question. Section anchors currently use `#` through `######` headings outside fenced code; underline-style headings are not recognized. You can always name the intended heading or function explicitly. If the needed source is excluded or clipped, the model is instructed to explain the limitation instead of silently choosing another cell.

### Can I edit an AI answer directly?

Yes. Double-click the answer's Markdown text below its Context control, correct its explanation or code, then render it and save. Later AI prompts read the edited text when they run, provided the completed prompt/answer pair is above them and within the context limits.

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

No. Default receives bounded source above the current question and completed earlier AI pairs. Other Context modes can select below-question material or individual AI cells as labeled source. Code outputs, plots, image pixels, raw-cell content and automatic file contents remain excluded.

Explicit references such as ``$`score` `` retrieve selected live values. A live value can have been created by a cell run below the prompt or out of order. Source context follows notebook order; live values reflect the current kernel. See the [context table and limits](user-guide.md#4-what-context-does-the-ai-receive).

### How does nbinlineai choose context when the notebook is large?

Every Context mode uses a shared **64,000-character estimate** for each provider request:

| Material | Selection rule |
| --- | --- |
| Tools | Discover declarations throughout eligible cells above, then account for all their function descriptions first. Tools survive omission of the notes that declared them. |
| Current question and instructions | Account for the question **after** live-value substitution, system/style instructions, and message formatting. |
| Selected source and completed earlier AI exchanges | Start with the nearest eligible candidates, with above winning distance ties. Default considers earlier material only. Send retained material in original order. |
| Boundary cell | Keep the end of source above or the beginning of source below, marked as partial. AI history pairs stay whole; stop if the next pair will not fit. |
| Tool rounds | Recalculate with the accumulated tool calls and results. Older notebook context may be removed to make room; completed tools are not replayed. |

There is no relevance search or automatic summary. Selection stops at the first budget boundary instead of skipping to smaller distant cells. These limits do not modify or delete notebook cells. A separate transport safety limit accepts up to 10,000 cells in the ordered snapshot; oversize snapshots fail explicitly.

The status reports included cells and offered tools. **Done · context trimmed** means a provider round omitted or shortened eligible context. Hover over the status for included, omitted, and partial cell counts, tool names, and the character estimate. This report lasts in the open browser session; it is not a saved transcript or exact model-token count.

### How do Default and All above differ?

Default's boxes show the cells the backend estimates will fit. All above checks all eligible candidates and separately marks budget omissions or partial cells. Their ordinary-source and complete-pair selection follows the same budget. All above can additionally include a standalone AI question or completed answer as labeled source; Default retains the legacy complete-pair eligibility.

### Does a checked box guarantee the whole cell reaches the model?

In Full notebook, All above, either ten-cell mode or Custom, it means selected as a candidate. **Partial** and **omitted by budget** describe actual first-round inclusion. Default uses checked/mixed boxes for the fitted set itself. Full notebook remains budget limited. Current-question answers are always excluded, even if moved above their question.

### Which question do the controls describe?

The question named inside **Details** is the preview target. Click a question or its linked answer to change it; clicking a code or Markdown checkbox retains it. The collapsed toolbar only sets the notebook-wide mode. Execution uses the ID of the question actually running, so Run All takes a fresh snapshot for each question rather than reusing the preview target.

Before you click a question, the Context checkboxes are disabled because there is no request to describe yet. The instruction inside Details means click an existing AI question in the notebook; it is not a separate action on each cell. For example, a cell can be above one question but below another, and a question's own answer is always excluded.

### Must I check context before running an AI question?

No. **Run AI**, Shift+Enter and Run All calculate the context automatically for each question. **Details → Check context** is only for inspecting what would fit without an AI request, such as after changing a Python value or function. It does not regenerate an answer. Even Full notebook needs a question as the inspection target so its own answer can be excluded and the applicable tools and remaining budget can be calculated.

The button shows **Checking…** during inspection. Success displays **Context checked**, the included cell/tool counts and the check time. If nothing about the selection changed, the checkboxes stay the same; the new time confirms completion. A failed check displays its reason instead.

### What happens to Custom choices when I change modes or insert cells?

Unchecking a cell switches to **Custom**. Checking it again stays in Custom, even if the choices now match a preset. To restore automatic selection, choose **Default** in the main **Context** dropdown; use that same dropdown for any other preset.

Returning to Custom restores your choices. Editing a preset checkbox instead starts a new Custom set from that preset's displayed selection. If Default preview is unavailable, use **Details → Check context** before initializing Custom or start from an explicit preset. Initial choices cover all existing cells; an empty or failed cell retains its choice if it later becomes eligible. Newly inserted cells default to included when eligible. Moves preserve choices; duplicates copy metadata with JupyterLab's fresh cell ID. The mode and choices save in the notebook, while previews do not.

### Why is preview pending, stale or unavailable?

An accurate estimate needs an existing idle kernel and any functions/values referenced by this question. Preview does not start a kernel, contact a provider, run an offered function or create an answer. Source/settings/target/kernel changes invalidate a response. Use **Details → Check context** to inspect an updated estimate after changing live Python state. Running the question always takes a fresh snapshot; later tool rounds can trim more text. A preview is not a saved guarantee of a later request.

In Default, an invalidated estimate can leave the boxes unchecked and disabled, including after a run inserts or updates an answer. That means the preview needs updating; it does not mean the completed request had no context. The question's run status reports what that request used. To inspect the next request, use **Details → Check context** once the kernel is idle.

### How do I exclude text without losing tools—or disable the tools too?

Use the two independent cell controls. **Context** selects text. **Tools** appears on Markdown and AI question cells containing declarations, and defaults to on. Uncheck Tools to withdraw that cell's declarations. A duplicate declaration in another enabled applicable cell can still offer the same tool. Tool choices save across every Context mode; new declaration cells default to enabled.

Choose **Current question only** to deselect all optional text while retaining your Tools choices. Automatic budget omissions never disable tools, and this mode never re-enables deliberately disabled ones. Below-question declarations remain out of scope even when their source is selected. The current question's Tools checkbox can withdraw its own declarations without excluding its required text.

These controls do not reset Python state. Only the current question's `$` references resolve live values. Previously executed code can affect the kernel from anywhere, and offered read tools can retrieve other text. Restart/rerun setup only when you deliberately want to reset Python state.

### Why can a tool still be available after I disable one declaration cell?

A Tools checkbox means **use declarations from this cell**, not disable those function names everywhere. For example:

| Notebook order | Saved Tools choice | Effect on the current question |
| --- | --- | --- |
| Markdown A declares `search` | Off | A does not offer it. |
| Markdown B also declares `search` | On | B still offers `search`. |
| **Current AI question** | — | Can use `search` through B. |
| Markdown C declares `calculate` | On | C is below, so `calculate` is unavailable here. |

Turn Tools off on both A and B to withdraw `search` from this question. A stays off when switching Default, Custom or any other Context mode, and after saving/reopening. Full notebook can select C's text, but its enabled declaration applies only to a later question. An AI question's own enabled declarations also apply to itself.

### What happens if the request exceeds the model's context window?

The character estimate above does **not** guarantee that a request fits the selected model. nbinlineai counts its serialized messages and tools, but does not yet use the model's tokenizer or reserve capacity according to its input, output, and reasoning rules. Custom models can have different limits.

Before each provider call, nbinlineai trims optional notebook context to its character budget. If tools, instructions, the current question, and the ongoing tool conversation alone exceed that budget, it stops with an actionable size error. If the provider still rejects the request as too large, a recognized context-overflow error explains the problem. It does not automatically summarize or retry a rejected request. An error also stops the remaining cells in the current Run All batch.

Partial answer text may remain, but the failed exchange is excluded from later AI history. Tool actions already completed remain in effect, so inspect any changes before rerunning. A failure on a later tool round can happen even though the first request fitted.

To reduce the request, shorten long source cells and questions, remove unwanted tool declarations above, use smaller tool results, or pass a small summary variable instead of a large value. A model with a larger context window may help with provider overflow; it does not change nbinlineai's own character budget. Use Custom or Current question only to reduce optional text; use Tools checkboxes to reduce offered function descriptions.

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

### Can I run nbinlineai alongside Jupyter AI for Claude or Codex ACP chat?

An isolated test of **nbinlineai 0.1.9 + Jupyter AI 3.2.0 + JupyterLab 4.6.4** successfully installed and opened both extensions. A deterministic execution check also preserved native Run All ordering, kept completed AI answers, and retained nbinlineai metadata when a Jupyter AI command edited a question. No paid model or authenticated ACP-agent request was used in that check.

There is an important command difference in Jupyter AI's default setup:

| Action | Effect on nbinlineai cells |
| --- | --- |
| nbinlineai **Run AI**, or JupyterLab's native Shift+Enter | Runs the AI question according to Keep answer. |
| Native **Run All**, including Jupyter AI's Run All command | Includes AI questions and respects their Keep choices. New unanswered questions can make API requests. |
| Jupyter AI's individual **Run Cell** tool | Executes code directly; treats a Markdown AI question as a no-op. It also bypasses nbinlineai's code/AI ordering queue. |

Jupyter AI requires separately installed ACP adapters and their own authentication. Its Claude/Codex chat does not use nbinlineai's saved API keys or turn inline cells into subscription-backed requests. Follow [Jupyter AI's setup instructions](https://jupyter-ai.readthedocs.io/en/stable/getting-started.html). Install both extensions in the Jupyter server's environment and restart the whole server.

Both systems can change the same live notebook. Avoid asking an agent to edit or execute it during an inline request whose context you want to keep stable. Jupyter AI also starts its own local MCP server; multiple Jupyter instances may need its port configuration adjusted. The [versioned investigation](https://github.com/rahuldave/nbinlineai/blob/main/internal_docs/jupyter_ai_compatibility.md) records source links, light/dark visual checks, tested paths, and remaining RTC/concurrency limits.

A separate **authenticated Codex ACP trial** successfully read a teaching notebook, fixed one function and ran its three specified Python cells; all checks passed. Try the [Codex worked example](https://github.com/rahuldave/nbinlineai/blob/main/examples/codex-acp-worked-example.ipynb). The committed template keeps the starting bug for you to solve. Its two nbinlineai questions are unrun: use them afterward for an explanation and a Learning follow-up with your API provider. See the [exact run record](https://github.com/rahuldave/nbinlineai/blob/main/internal_docs/codex_acp_example_run.md).

### Does Jupyter AI have the same AI cells as nbinlineai?

The Jupyter AI 3.2 setup we checked uses a chat sidebar and agents that can operate on notebook cells. It does not provide nbinlineai's paired, editable Markdown question/answer cells. Its optional `%ai` and `%%ai` magics are a separate code-cell workflow. You can use Jupyter AI for agent-assisted code development and keep nbinlineai explanations or tutoring conversations beside that code. See the [combined example](https://github.com/rahuldave/nbinlineai/blob/main/examples/jupyter-ai-and-nbinlineai.ipynb).

### Why use Jupyter AI's Run Cell instead of Shift+Enter? Does it run my selection?

It is an **agent tool**, not a faster keyboard shortcut. The agent supplies a particular cell ID to execute that code cell during its task. The standard tool requires the ID; it does not automatically run all selected cells. Its underlying frontend command can fall back to the active cell if called directly without an ID, but that is not the normal agent-tool contract.

For manual work, use Shift+Enter as usual. Native Shift+Enter also recognizes nbinlineai questions; the default Jupyter AI single-cell tool treats those Markdown cells as a no-op. See the [pinned command source](https://github.com/jupyter-ai-contrib/jupyterlab-ai-commands/blob/a281ddb0a6d79e518ff7dc33e9ad7d032375075f/src/notebook-commands.ts) and [agent tool contract](https://github.com/jupyter-ai-contrib/jupyter-ai-tools/blob/4d1c823ed9e2d58c2a5690c8b7c440045df1ee01/jupyter_ai_tools/toolkits/jupyterlab.py).

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

Yes, from **0.1.7**. Import the functions into the kernel, then put their `&` references in an ordinary Markdown note above your AI questions. Every question below inherits them. Earlier AI questions can declare tools too, even without running. Several notes can add tools at different positions; duplicates are included once. AI answers, code, raw cells, and cells below the question do not register tools. Use `print(tools_markdown())` from `nbinlineai.tools` to generate a list you can paste and shorten. See [Tools and examples](tools.md).

Live `$` lookups still happen only in the current question. Tool references inside quotations or fenced code in eligible Markdown count as declarations; use a plain function name when merely discussing one.

### Does an early tool disappear when its note no longer fits in context?

No. Tool discovery scans all eligible cells above before choosing the text window. Its function schema stays available when the note is unchecked for Context, outside the window or omitted by budget, provided its separate Tools checkbox is enabled. An enabled callable must still exist in the live kernel; rerun imports or definitions after restarting it. Keep answer on the declaration's AI question does not disable inheritance.

### Can I create the tools note without copying and pasting?

Yes. Run `from nbinlineai.tools import insert_tools`, then `insert_tools(["search_kernel_names"])` in a Python cell after importing that function. The helper requests an ordinary Markdown declaration cell immediately below its calling code cell, without making an AI request. Custom functions are supported through the same `custom` mapping as `tools_markdown()`. See the [helper example](tools.md#insert-the-declaration-note-directly).

Save normally. A deliberate rerun creates another note; simply reopening the notebook does not. The helper needs the nbinlineai JupyterLab frontend. `tools_markdown()` remains the option for plain text without a browser.

### How do I stop offering an inherited tool?

Uncheck Tools on every applicable cell that declares it, or remove/move those declarations below the question. The choice is per declaration cell; another enabled declaration of the same name still offers it. Changes apply on the next AI run; an already-running request keeps its snapshot. Deleting or renaming the Python function alone leaves a missing declaration, which causes an error rather than silently dropping the tool.

### Why can't the file tools see my latest edit?

`list_notebooks`, `find_notebook_cells`, and `read_notebook_cell` inspect **saved `.ipynb` files**. Save your edits first, and check the path relative to the kernel's current working directory. To read the open notebook including unsaved changes, offer `list_cells` and `read_cell` instead. Selected context also uses the current frontend source, including below-question source when the mode selects it.

### Does listing all tools give the AI access to every function in the package?

No. `tools_markdown()` lists eleven bundled tools from an explicit registry; it does not list helpers or automatically expose the Python namespace. You choose which references to paste into Markdown notes or AI questions. The model can call only functions declared above or in the current question. Ordinary functions run with the Python kernel's permissions; the five live notebook tools have a separate, limited browser interface.

### Can the AI read cells below my question now?

Yes. Full notebook, 10 above + below and Custom can select below-question source. Later AI cells are labeled source, never prior chat history. Independently, offered `list_cells` and `read_cell` tools can inspect below; saved-file tools can read other cells or notebooks. Unchecking a cell does not prohibit separately offered tools from reading it.

### Does a tool insert a real note, or just text in the AI answer?

`insert_markdown` and `url_to_note` insert a separate, ordinary Markdown cell. The default position is after the AI answer, or you can ask for a particular cell ID. You can edit, move, or delete the note normally. Save the notebook to persist it. A note above a later AI prompt becomes ordinary source context.

`read_url` only returns page text to the current model conversation. Use `url_to_note` to keep an excerpt in its own cell. Tool results are not stored as a separate transcript in notebook metadata.

### Can I ask the AI to call `insert_markdown`?

Yes. First run this import in an ordinary code cell:

```python
from nbinlineai.tools import insert_markdown
```

Then write and run an AI question such as:

```markdown
Use &`insert_markdown` to add a short summary note below your answer.
```

The AI can call the offered tool. nbinlineai sends the insertion request to the frontend, which creates a separate Markdown cell while retaining the AI answer. You do not need a second Python cell that calls `insert_markdown(...)`. Save the notebook to keep the new note.

### Once I register the tool above, can I just ask in normal language?

Yes. After running the import, put this declaration in an ordinary Markdown note above your AI questions:

```markdown
Available tools:
- &`insert_markdown`
```

An AI question below can then say:

> Summarize the main ideas and insert the summary into a new Markdown cell below your answer.

The question inherits the tool and its description. You do not need to repeat its reference or function name. Saying “Use `insert_markdown`” makes your request more explicit if the model does not choose it. Offering a tool permits its use; it does not guarantee a call. Keep the declaration's **Tools** checkbox on and rerun imports after a kernel restart.

### Is that the same as running `insert_tools()` in a code cell?

They serve different purposes:

| Operation | Where you use it | What it creates |
| --- | --- | --- |
| `tools_markdown(...)` | Python code | A string of tool declarations for you to copy into a Markdown cell. |
| `insert_tools(...)` | Python code | A Markdown declaration note below that code cell, without an AI request. |
| `insert_markdown` | An offered tool called during an AI question | A new Markdown note, normally below the AI answer. |
| `insert_code` | An offered tool called during an AI question | A new, unexecuted code cell, normally below the AI answer. |

`insert_tools()` creates the registration note; it does not ask the model to write lesson content. The two AI insertion tools create the content requested in your question through the frontend request/reply interface.

### How do I ask for a new code cell while keeping the AI answer?

In version **0.1.10**, run `from nbinlineai.tools import insert_code` in a code cell and put `` &`insert_code` `` in a Markdown declaration note above your AI question. Then ask, for example:

> Write code to plot these results and insert it into a new code cell below your answer. Explain briefly what the code does.

The default order is **AI question → AI answer → new code cell**. The answer stays in its paired Markdown cell. The new code is ordinary editable source with no execution result; review it and run it yourself when ready. Insertion itself never executes code, even when the AI question is running as part of Run All: the new cell is outside that already-started batch. A later ordinary Run All includes that code cell. The model is instructed to apply your response style to inserted content too, including Learning's small-hint limit.

### Will rerunning or cancelling create or remove notes?

A deliberate rerun can insert a new note; it does not replace or remove notes from previous runs. Keep answer skips the completed request and therefore skips its tools. Cancel stops waiting for further work but does not undo an insertion already performed. If a connection fails just after insertion, check the notebook before retrying: the note may exist even if its acknowledgement was lost.

Repeated delivery of the same action within one live request is deduplicated. A new AI run is a new request and can intentionally repeat the action.

### What happens if I switch notebooks while a tool runs?

The action stays bound to the original notebook, session, and prompt; switching tabs does not redirect it. Closed notebooks, deleted target cells, and changed sessions fail clearly. The extension does not fall back to whichever cell happens to be selected.

### Why can't I call `insert_markdown(...)` directly in Python?

The kernel does not own the browser's document model. `list_cells`, `read_cell`, `insert_markdown`, `insert_code`, and `url_to_note` are imported for tool descriptions, then handled through the frontend interface during an AI request. Their direct Python stubs raise an explanatory error. The other six bundled tools work directly in Python as well as through AI tool references.

### Can these tools edit or execute existing cells?

The built-in frontend interface can list cells, read their source, and insert Markdown or unexecuted code. It does not replace or delete existing cells, execute code, save files, or control another notebook. Your own Python tools can still perform whatever actions you implement; offering an `&` reference permits those real function calls.

### The extension works, but importing the tools fails. Why?

Your Jupyter server and notebook kernel may use different Python environments. Install nbinlineai in the kernel's environment as well, then rerun the import cell. After a kernel restart, previous imports are gone even though their code and old answers remain visible.

### Does Learning mode guarantee the AI will never reveal a solution?

No. Its instructions ask for Socratic questions and small hints, but this is model guidance, not an enforced assessment restriction. You can edit the style instructions in Configure AI. See [response styles](user-guide.md#response-styles).

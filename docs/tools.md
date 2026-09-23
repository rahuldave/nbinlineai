---
title: Tools and examples
---

# Tools and example notebooks

nbinlineai includes ten tools and a helper that writes their Markdown references for you. Tools can inspect Python state, read saved notebooks, read the open notebook's unsaved cells, retrieve public documentation, and insert Markdown notes. From **0.1.7**, declare tools once in ordinary Markdown or an AI question and they remain available to later AI questions below. Importing them alone does not expose them to the model.

## Import, print, paste

Run this in a **Python code cell**:

```python
from nbinlineai.tools import (
    search_kernel_names,
    list_notebooks,
    find_notebook_cells,
    read_notebook_cell,
    inspect_python,
    read_url,
    list_cells,
    read_cell,
    insert_markdown,
    url_to_note,
    tools_markdown,
)

print(tools_markdown())
```

Copy the printed Markdown into an **ordinary Markdown cell above your AI questions**. Remove any tool lines you do not want available. For example, this note declares just one tool:

```text
- &`search_kernel_names` — Search names in the live Python kernel.
```

Now add an AI Prompt below it:

```text
Use the search tool to find live variables containing "score", and tell me their types.
```

Run the AI cell. The software finds the declaration above and sends the model a function description. Later AI questions inherit it too, without repeating `&`. It is still the model's choice whether to call a tool; ask it to use the tool when the task requires a lookup. You can also declare tools directly in an AI question, as in earlier versions.

To print only a subset:

```python
print(tools_markdown(["find_notebook_cells", "read_notebook_cell"]))
```

`tools_markdown()` returns a string. It is a convenience function for you, and is not included in the generated tool list. Six tools also work as direct Python calls; the four tools that access the open notebook require an AI prompt running through the extension.

![A Markdown tool declaration shared by AI questions below it](images/inherited-tools.png)

This demonstration uses a simulated provider and a real Python kernel; the declared custom function actually changes the live bonus counter.

### Where do the references belong?

| Where a reference appears | What happens |
| --- | --- |
| In the **current AI prompt**, as ``&`function_name` `` | Registers that function for this request and makes it available to later questions below. |
| In the **current AI prompt**, as ``$`variable_name` `` | Reads that variable's current kernel value into the request. |
| In an ordinary Markdown cell above | `&` declares tools for questions below; `$` stays literal text. The note need not be executed. |
| In an earlier AI question | `&` declares tools for questions below, even if that question was never run or its answer is kept. `$` is not read again. |
| In an AI answer | Does not register tools or read variables, including after manual edits. Copy an intended declaration into an ordinary Markdown note. |
| In code source, raw cells, or printed output | Does not register tools. Copy the references into a Markdown note or AI question. |
| In any cell below the current question | Does not register tools for that question. |

References in eligible Markdown are detected even inside fenced code blocks or quotations. Use a plain name such as `search_kernel_names` when merely discussing a function. Only simple Python names are supported in references: import a function directly rather than writing a module-qualified reference such as `tools.list_notebooks`.

Several notes can add tools at different points; duplicates are registered once. Discovery scans the full preceding snapshot **before** text is shortened to fit the context budget, so enabled declarations survive even when their prose is unchecked, outside the selected window or omitted by budget. A separate Tools checkbox on each declaring Markdown/AI question cell can withdraw its declarations; this saved choice defaults to enabled. Function descriptions still consume budget. Functions are inspected afresh in the live kernel on each run: rerun imports after a restart, and rerun a definition to use its changed implementation.

To withdraw a tool, uncheck Tools on every applicable declaration cell, remove its `&` declarations, or move them below the question. Another enabled declaration of the same name can still offer it. The current question has its own Tools checkbox when it declares functions. A missing declared function causes an error before contacting the provider. A note inserted by `insert_markdown` or `url_to_note` is ordinary Markdown, so any literal tool references in it also become declarations for later questions; review imported notes accordingly.

### Insert the declaration note directly

To avoid copying the printed output, run this in a Python code cell in JupyterLab:

```python
from nbinlineai.tools import search_kernel_names, inspect_python, insert_tools

insert_tools(["search_kernel_names", "inspect_python"])
```

`insert_tools()` requests a new ordinary Markdown declaration cell directly below the code cell where it is called. It uses the same selection and `custom` aliases as `tools_markdown()`. Import or define the selected functions first. The helper is not a model tool and makes no provider request; the AI questions below inherit the inserted declarations normally.

The immediate result says **requested**. The browser inserts the cell and acknowledges it asynchronously. To inspect the acknowledgement, assign `receipt = insert_tools(...)`, then examine `receipt.status`, `receipt.cell_id`, or `receipt.error` in a later code cell. No acknowledgement within 30 seconds marks the receipt as an error; check whether the note already appeared before retrying, since a lost acknowledgement does not undo insertion.

Edit the new note to remove tools or add explanation, then save the notebook. Running the helper again requests another note; it does not overwrite an edited declaration. Reopening the notebook does not rerun the insertion. This helper needs the running nbinlineai JupyterLab frontend, so use `tools_markdown()` to obtain plain text in a terminal or headless notebook.

The notebook's Python kernel needs ipykernel 6.18 or newer for this helper. Installing nbinlineai enforces that requirement in its environment; if you select a kernel from a different environment, install or upgrade nbinlineai there too.

## Included tools

| Function | What it does |
| --- | --- |
| `search_kernel_names(query, limit=20)` | Matching names and types in the live IPython namespace. It does not return variable values. Use an explicit `$` reference if you want a value. |
| `list_notebooks(path=".", limit=30)` | Saved `.ipynb` paths under an explicit directory. |
| `find_notebook_cells(path, query, limit=10)` | Literal text matches in a saved notebook's cell source, with identifiers and excerpts. |
| `read_notebook_cell(path, cell_id, start_line=1, end_line=40)` | A saved cell's source with line numbers. Use an identifier returned by the search tool. |
| `inspect_python(name, section="help")` | Documentation, signature, or source for a named Python object in the kernel. |
| `read_url(url)` | A bounded text/Markdown excerpt from a public web page, returned to the model. |
| `list_cells(start=0, limit=20)` | IDs, types, and short source previews from the current live notebook, including cells below the prompt. |
| `read_cell(cell_id, start_line=1, end_line=40)` | Numbered source from a live cell, including unsaved edits. |
| `insert_markdown(content, after_cell_id="")` | Insert an ordinary Markdown note in the live notebook. |
| `url_to_note(url, after_cell_id="")` | Fetch a public page and insert a source-attributed Markdown excerpt as an ordinary note. |

### Python and saved notebooks

The file tools read **saved files on disk**, including cells below your prompt or in another notebook if you ask them to. Save first if you want them to see recent edits. They do not execute the notebook they inspect.

Relative paths use the **kernel's current working directory**. You can check it with `Path.cwd()` from `pathlib`. Renaming or moving an open notebook does not necessarily change that directory. These functions have the same file permissions as your Python kernel; a directory argument is a search location, not a security sandbox.

Results are bounded text with truncation notices. Use narrower searches or a smaller line range for more detail. Rich cell outputs and image pixels are not returned. `inspect_python` supports `help`, `signature`, and `source`; source may be unavailable for built-in functions or objects created interactively. Its name can contain up to four public identifier segments, such as `statistics.mean`, resolved from the live namespace or Python builtins without evaluating an expression. Use explicit `$` references for variable values.

If importing `nbinlineai.tools` fails, install nbinlineai in the environment that runs your **notebook kernel**. Installing the extension only in a separate Jupyter server environment does not install Python imports in every kernel. After a kernel restart, rerun the import cell.

### Live cells and notes

Import `list_cells`, `read_cell`, and `insert_markdown` in a code cell, then try this AI prompt:

```text
Use &`list_cells` to find the exercise below this question.
Use &`read_cell` to read it, then use &`insert_markdown` to add
one hint after your answer. Do not solve the exercise.
```

These tools act on the **notebook that started the AI request**. Switching to another tab does not redirect them. They use stable cell IDs from the notebook model, so the target does not have to be visible or selected. Get IDs from `list_cells`; use those IDs with `read_cell` or the insertion tools.

Without `after_cell_id`, notes are inserted after the current AI answer; multiple notes from that run appear in the order they were requested. Supply an existing cell ID to insert after that cell instead. Notes render as ordinary Markdown. They do not execute code, change the selected cell, or automatically save the notebook. **Save normally to keep them on disk.**

You can edit the new notes just like any Markdown cell. A note above a later AI prompt contributes to its ordinary source context. It is separate from the AI answer, so rerunning that answer does not replace the note. A rerun can insert another note; Keep answer prevents the entire completed request from running again. Cancelling does not undo notes already inserted.

![An AI prompt calls an imported tool and creates a separate editable Markdown note](images/live-notebook-tools.png)

The provider response in this demonstration is simulated; the extension performs the actual notebook insertion.

These four functions (`list_cells`, `read_cell`, `insert_markdown`, `url_to_note`) are imported to describe the tools, but their work is routed through the server and browser. Calling their Python stubs directly raises an explanatory error. Headless notebook execution cannot perform these actions. Missing/deleted target cells, a closed notebook, an expired request, or a changed kernel session produce an error rather than selecting a different notebook or cell.

### Public documentation

Use `read_url` when the model needs to consult a page in its answer. Use `url_to_note` when you want an editable excerpt **in its own Markdown cell**:

```text
Use &`url_to_note` to add a reading note from
https://docs.python.org/3/tutorial/datastructures.html
Use &`read_cell` to read the inserted cell, then ask me one
question to consider while reading it.
```

The note contains a text conversion of the page, with its source URL. It is not a model-generated summary or a complete offline copy. These tools support public HTTP(S) HTML, Markdown, and plain text; they do not log in, run page JavaScript, or download PDFs and images. Local/private network addresses and URLs containing credentials are rejected. Downloads, redirects, text length, and wait times are bounded; long pages are truncated.

`read_url` fetches from the kernel's machine and returns page text to the model. `url_to_note` fetches from the Jupyter server's machine, asks the browser to insert it, and returns the new cell ID. Offer `read_cell` too if you want the model to read that note during the same request. A later prompt below the note receives it as ordinary source context, within the usual limits. Neither web tool sends your provider API key to the page. Review retrieved text like other outside material.

![A public-page excerpt with a source link inserted as its own Markdown note](images/web-tools.png)

This demonstration uses a simulated provider and sample page content. The note is inserted through the real frontend interface.

### What enters later context?

Default context uses bounded earlier source and completed AI exchanges. The Context dropdown and per-cell checkboxes can select wider source. Offered tools can independently read other cells or files; unchecking Context does not withdraw those tools; uncheck Tools on the declaration cells to do that. Current question only excludes surrounding text while retaining Tools choices. Including text below never registers its declarations.

Tool results are available to the current model conversation. They are not saved as a separate tool transcript for future prompts. To retain material as notebook context, insert it as a note, or include it in the answer. Its position then determines whether a later prompt sees it.

## Example notebooks

The [examples folder on GitHub](https://github.com/rahuldave/nbinlineai/tree/main/examples) contains notebooks you can download and open in JupyterLab. Keep the `data/` folder alongside the examples. The package also installs a copy under `share/doc/nbinlineai/examples/` in its Python environment; copy that directory into your project before editing it.

These notebooks contain prompts, setup code, and instructions, with no API keys or pre-generated AI answers. Configure your provider as usual. Run the Learning example one step at a time so you can answer the tutor before continuing.

| Notebook | Try it |
| --- | --- |
| [Context selection](https://github.com/rahuldave/nbinlineai/blob/main/examples/context-selection.ipynb) | Compare context modes, restore Custom choices, and control declaration cells separately with Tools (0.1.8). |
| [Quick start](https://github.com/rahuldave/nbinlineai/blob/main/examples/quickstart.ipynb) | One live variable, one custom function, and your first AI call. |
| [Live variables and tools](https://github.com/rahuldave/nbinlineai/blob/main/examples/live-variables-and-tools.ipynb) | Compare a live value with a function call; inspect a real change to Python state. |
| [Socratic learning dialogue](https://github.com/rahuldave/nbinlineai/blob/main/examples/socratic-learning-dialog.ipynb) | Answer the tutor in successive AI cells, edit an answer, and explore Keep overrides. |
| [Bundled tools](https://github.com/rahuldave/nbinlineai/blob/main/examples/bundled-tools.ipynb) | Generate tool references, find live variable names, and search/read the supplied saved notebook. |
| [Live notebook tools](https://github.com/rahuldave/nbinlineai/blob/main/examples/live-notebook-tools.ipynb) | Read unsaved cells below a question and insert an editable hint without selecting the target cell. |
| [Python and web tools](https://github.com/rahuldave/nbinlineai/blob/main/examples/python-and-web-tools.ipynb) | Inspect Python documentation/source, consult a public page, and turn it into a notebook note. |

For a locally installed copy, this Python code prints the examples directory. Run it in the environment where nbinlineai is installed:

```python
from pathlib import Path
import sysconfig

print(Path(sysconfig.get_path("data")) / "share/doc/nbinlineai/examples")
```

An AI call uses your configured provider and incurs normal API usage. **Keep answer** preserves a completed answer but does not replay a tool's past actions. The custom-tool example makes a visible change to Python state; its setup code can restore the initial state.

## Your own functions

Any suitable synchronous Python function imported or defined in the kernel can be registered with an `&` reference. Use named, typed parameters and a docstring explaining what it does. Functions may calculate results, update variables, or perform other operations you implement. See [variables and functions](user-guide.md#5-reference-live-variables-and-functions) for the supported signatures.

The helper can include your own functions or imported aliases. The mapping keys must be the simple names actually available in your kernel:

```python
from nbinlineai.tools import read_cell as read_live

print(tools_markdown(["read_live"], custom={"read_live": read_live}))
```

Copying the resulting reference into a Markdown note makes the alias available to AI questions below. A reference in an AI question works for that question and later ones too. The helper does not import or register anything on its own.

The bundled tools were inspired by [dialoghelper](https://github.com/AnswerDotAI/dialoghelper)'s helpers. They use Jupyter's kernel, saved `.ipynb` files, and nbinlineai's own frontend interface; installing nbinlineai does not require Solveit, dialoghelper, or ipylab.

[User guide](user-guide.md) · [FAQ](faq.md) · [Architecture](architecture.md)

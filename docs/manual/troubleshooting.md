---
title: Troubleshooting and limits
---

# Troubleshooting and limits

[Manual](../user-guide.md) · [Previous: Saved notebooks and privacy](saving-and-privacy.md)

| Symptom | What to do |
| --- | --- |
| **Configure AI** or **+ AI Prompt** is missing | Open a notebook, confirm installation in the server environment, restart the whole server, and refresh the page. |
| Server endpoint unavailable / 404 | Try **Retry** in Configure AI. If you just installed or updated, restart the whole server; browser reload alone may leave the server component unloaded. |
| Provider unavailable / Run disabled | Save that provider's key, or select one already configured. |
| Name is not defined | Run the Python cell defining the referenced variable or function in this notebook's kernel. |
| AI misses your notes | Select the intended question, check its Context mode and cell choices, use **Details → Check context** if you want a fresh estimate, and inspect partial/omitted feedback. Rerun with Keep answer off after editing. |
| AI misses a plot or code output | Context checkboxes do not automatically include rich output. Declare `list_outputs`/`read_output` to inspect a selected result, add a text explanation to Markdown, or explicitly confirm a still-image attachment for one question. |
| AI asks questions when you want a direct answer | Choose Compact or Full in the notebook defaults or the cell's Override controls, then run it again. |
| One cell ignores changed notebook defaults | Check its **Override** controls. Choose **Notebook default** in the provider menu to clear its provider, model, and effort choices, or **Use notebook defaults** to clear its provider, model, style, and effort choices. |
| A completed AI prompt will not run again | Turn off Keep answer on that prompt. Protected prompts are skipped by Shift+Enter. |
| Later answers still contain a mistake you corrected above | Rerun the affected prompts with Keep answer off. Editing earlier text does not update existing later answers automatically. |
| A prompt ignores the notebook's Keep AI answers toggle | Reset that cell's explicit Keep answer choice to inherit the notebook default. |
| Run All does not run AI prompts | Restart the Jupyter server after installing or updating the extension, refresh the page, and check Keep answer. Headless notebook execution does not activate the JupyterLab frontend hook. |
| A variable is missing after restarting and running all | A kept AI answer did not repeat its old function calls. Recreate the variable in a code cell or deliberately rerun the AI prompt that created it. |
| A tutor conversation keeps starting over | Put your reply in a new AI Prompt below the tutor's answer. Rerunning the original prompt replaces that exchange. |
| Code will not copy | If the browser blocks clipboard access, select the code text and copy it manually. |
| Old answer disappeared after rerunning | Reruns replace the paired answer. Copy text into an ordinary Markdown cell beforehand to preserve another version. |
| Model unavailable / key rejected / quota reached | Check the selected connection and model. For ChatGPT, reconnect if needed or wait for the displayed reset time; your selection is preserved. For API mode, check the key and that account's access or quota. |
| A media receipt says `running` after its Python cell ended | This is the expected initial acknowledgement. Complete any visible permission or chooser step, then run the later inspection cell again. The original receipt changes as the browser finishes. |
| An AI media answer has no image or source ID yet | The tool reply is an initial snapshot. Ask `operation_status` for its exact operation ID in a later question; wait for a completed result before using dependent IDs. Status lookup itself does not wait. |
| A media save has no file, or reports `unsupported` | Run `capabilities = browser_capabilities()` in one code cell. After its receipt completes, inspect `capabilities.result["file_media_supported"]` in a later cell. An in-memory capture can still work when this server cannot safely save files. A file save also requires an unused server-root-relative destination. |
| A camera, microphone, or display action waits for permission | Use the visible browser control and chooser, on a supported secure origin when required. A passive capabilities check does not request device permission. Stop the source when finished. |

Current size limits are deliberately bounded:

| Item | Limit and behavior |
| --- | --- |
| Request context | A 64,000-character host estimate for each submitted question or notebook-tool round, including tool definitions and message framing. Tools, instructions, the expanded question, and completed tool results take priority; remaining space goes to nearest selected source and complete earlier AI pairs. The ChatGPT runtime may make internal inference or recovery requests within a round; this limit does not account for those internal calls. |
| Notebook snapshot | Up to 10,000 ordered cells as a transport safety limit. All earlier eligible Markdown/AI questions are scanned for declarations before text selection. |
| Source at the context boundary | Source may contribute only its ending above or beginning below, labeled partial. AI history pairs are never split. More distant material is omitted. |
| Current prompt | Up to 16,000 characters before live-value substitution. |
| Live references | Up to 20 distinct names combined: current-question variables plus all inherited/current tools. |
| Variable representation | Up to 2,000 characters per value. |
| Function result | Up to 4,000 characters per tool result. |
| Notebook-tool rounds | Default 5; configurable from 0 to 10 in nbinlineai's JupyterLab settings. One returned group may contain several declared tool calls; internal ChatGPT inference does not count as another notebook-tool round. |

Code outputs and plots are not automatically read as notebook text. Use a declared output tool to inspect a selected output, or explicitly confirm an image attachment for one question. Generated code remains unexecuted until you choose to run it.

[Manual](../user-guide.md) · [Previous: Saved notebooks and privacy](saving-and-privacy.md)

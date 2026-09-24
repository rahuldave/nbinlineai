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
| AI misses a plot or code output | These are not currently included; add a text explanation to a Markdown cell above the prompt or to the prompt itself. |
| AI asks questions when you want a direct answer | Choose Compact or Full in the notebook defaults or the cell's Override controls, then run it again. |
| One cell ignores changed notebook defaults | Check its Override controls. Return it to notebook defaults if its saved choices are no longer needed. |
| A completed AI prompt will not run again | Turn off Keep answer on that prompt. Protected prompts are skipped by Shift+Enter. |
| Later answers still contain a mistake you corrected above | Rerun the affected prompts with Keep answer off. Editing earlier text does not update existing later answers automatically. |
| A prompt ignores the notebook's Keep AI answers toggle | Reset that cell's explicit Keep answer choice to inherit the notebook default. |
| Run All does not run AI prompts | Confirm version 0.1.5 or newer, restart the server after upgrading, and check Keep answer. Headless notebook execution does not activate the extension's frontend hook. |
| A variable is missing after restarting and running all | A kept AI answer did not repeat its old function calls. Recreate the variable in a code cell or deliberately rerun the AI prompt that created it. |
| A tutor conversation keeps starting over | Put your reply in a new AI Prompt below the tutor's answer. Rerunning the original prompt replaces that exchange. |
| Code will not copy | If the browser blocks clipboard access, select the code text and copy it manually. |
| Old answer disappeared after rerunning | Reruns replace the paired answer. Copy text into an ordinary Markdown cell beforehand to preserve another version. |
| Model unavailable / key rejected / quota reached | Check the selected connection and model. For ChatGPT, reconnect if needed or wait for the displayed reset time; your selection is preserved. For API mode, check the key and that account's access or quota. |

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

This version supports text prompts and Python kernels. It does not automatically include rich outputs or images or execute generated code.

[Manual](../user-guide.md) · [Previous: Saved notebooks and privacy](saving-and-privacy.md)

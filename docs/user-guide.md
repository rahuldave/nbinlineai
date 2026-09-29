---
title: User guide
---

<span id="nbinlineai-user-manual"></span>

# User guide

nbinlineai puts AI questions and answers beside your code in a JupyterLab notebook. Ask about selected notebook text, refer to a live Python value, or offer a function for the AI to call. Questions and answers stay as editable Markdown cells, so you can read, correct, and share the conversation with your work.

## Start with one question

1. [Install and connect](manual/setup.md). In **Configure AI**, connect your ChatGPT subscription or an API provider, then choose the connection for this notebook.
2. Open the [Quick start notebook](https://rahuldave.com/nbinlineai/notebooks/quickstart.html) and run its Python setup. Read the saved examples before trying your own question.
3. Select a cell and click **+ AI Prompt**. Write a question, choose **Compact** for a concise answer, and press **Run AI** or Shift+Enter. The answer appears in a paired cell below.
4. To continue the conversation, add another AI question below the answer. To replace an answer, turn off that question's **Keep answer**, edit the question, and rerun it.

The **AI defaults** row sets this notebook's connection, model, style, and effort. A question's **Override** changes those choices for that question. Changing settings does not rewrite an answer you already have.

## Choose what the AI can use

Three controls serve different purposes:

| You want the AI to… | How to provide it |
| --- | --- |
| Read code or notes | Choose notebook **Context**. Default starts with eligible cells above the question. Preview the selection in **Details**. |
| Read a live Python value | Put a reference such as ``$`score` `` in the current question, after running the code that defines it. |
| Call a function | Import or define the function in Python, then declare it with a reference such as ``&`show_doc` `` in the question or an earlier Markdown note with **Tools** enabled. |
| See an image | Use `attach_media` and confirm the exact image for that question, then run the question with an image-capable model. A displayed plot alone is not sent. |

Context describes notebook text; a live value describes the kernel now. They can differ if you edited code without rerunning it. Tool declarations remain available even when the note declaring them is excluded from text context. Read [Context](manual/context-selection.md) and [Live values and tools](manual/variables-and-tools.md) when these distinctions matter.

The [Tool catalog](tools.md) gives each tool a normal-use example and an AI example. Most tools can be called directly in Python. Live editor tools such as `insert_code` are called by the AI through JupyterLab; their normal-use comparisons show the corresponding manual edit. The [notebook gallery](examples.md) groups short walkthroughs separately from the complete tool catalog notebooks.

## Understand browser receipts before using media tools

Camera capture, recording, importing, playback, and other browser operations can continue after their Python call returns. The return value is a **`BrowserReceipt`**: a live record of the operation, rather than its finished image or clip.

Work through three steps:

1. **Start.** Run a call such as `receipt = browser_capabilities()` in a code cell. Let that cell finish.
2. **Inspect later.** In another cell, read `receipt.status`, `receipt.result`, and `receipt.error`. The same receipt updates as the browser works. Its first printed value is only a snapshot.
3. **Use the result.** Continue with dependent work when `receipt.status` is `completed`. For a capture, this can mean displaying the returned image or clip; for a save, checking the saved media descriptor.

For interactive operations, use the browser's permission dialog, chooser, or Media row as directed. `waiting_for_user`, `running`, `paused`, and `saving` all mean there is more to do. A `failed`, `cancelled`, or `expired` receipt is finished without a successful result; read its error before retrying.

An AI tool call receives a snapshot, not that changing Python object. If it starts an operation and returns an operation ID, finish the visible action and use a later AI question to call `operation_status` for that ID. An initial acknowledgement does not establish that a photo exists or a file was saved.

The [Browser media receipts guide](browser-media-foundation.md) shows a complete save-and-inspect example, explains the fields and status lookups, and covers cancellation and cleanup. Start there, then choose [camera and recording](browser-media-capture.md), [notebook outputs](browser-media-outputs.md), [import and playback](browser-media-playback.md), [transformations](browser-media-transforms.md), or [image attachments](browser-media-attachment.md).

## Run and save deliberately

**Run All includes AI questions**, respecting their Keep choices. It waits for each AI request, but a request can finish after starting a browser operation that is still running. It also does not turn a Python receipt into a wait for the browser. Run interactive media calls and their dependent inspection cells separately.

Saved answers and code outputs let you read a worked notebook without repeating its actions. They do not recreate Python variables, open a camera, or restore a recording session. After a kernel restart, rerun setup; deliberately rerun any AI action you need again. Keeping an answer preserves its text and skips its tool calls.

Save the notebook to retain questions, answers, and outputs. Save media separately when you want a reusable file. Capturing or previewing media does not automatically send it to the model; [explicit attachment](browser-media-attachment.md) gives you that choice.

## Read the chapters you need

<span id="contents"></span>

1. [Install and connect](manual/setup.md) — install the extension, connect ChatGPT or an API key, and understand account limits.
2. [Write and run AI questions](manual/prompts.md) — create prompts, continue conversations, copy code, and request a new code cell.
3. [Models, styles, and effort](manual/models-and-styles.md) — choose providers and models, customize response styles, and set thinking effort.
4. [Edit, rerun, and run notebooks](manual/editing-and-running.md) — correct answers, use Keep answer, and run a whole notebook safely.
5. [Choose notebook context](manual/context-selection.md) — select cells and tools, preview what fits, and compare OpenAI API, Claude API, and ChatGPT context budgets.
6. [Live values and tools](manual/variables-and-tools.md) — reference kernel values and offer Python functions and bundled notebook tools.
7. [Saved notebooks and privacy](manual/saving-and-privacy.md) — understand saved AI cells, key storage, account state, and the request path.
8. [Troubleshooting and limits](manual/troubleshooting.md) — resolve common problems and check size and tool-round limits.

The [FAQ](faq.md) covers common questions about receipts, Run All, context, connections, and saved work.

<!-- Existing links to the former single-page manual continue to the corresponding chapter. -->
<script>
(() => {
  const legacy = {
    '1-install-and-set-up': 'manual/setup.html',
    'chatgpt-connection': 'manual/setup.html#chatgpt-connection',
    '2-create-and-run-an-ai-cell': 'manual/prompts.html',
    'recognize-questions-and-answers': 'manual/prompts.html#recognize-questions-and-answers',
    'start-a-question': 'manual/prompts.html#start-a-question',
    'copy-code-from-an-answer': 'manual/prompts.html#copy-code-from-an-answer',
    'ask-for-a-new-code-cell': 'manual/prompts.html#ask-for-a-new-code-cell',
    'provider-and-model-choices': 'manual/models-and-styles.html#provider-and-model-choices',
    'response-styles': 'manual/models-and-styles.html#response-styles',
    'edit-the-style-instructions': 'manual/models-and-styles.html#edit-the-style-instructions',
    'thinking-effort': 'manual/models-and-styles.html#thinking-effort',
    'a-learning-conversation': 'manual/models-and-styles.html#a-learning-conversation',
    '3-edit-rerun-and-save': 'manual/editing-and-running.html',
    'edit-questions-and-answers': 'manual/editing-and-running.html#edit-questions-and-answers',
    'choose-a-notebook-default': 'manual/editing-and-running.html#choose-a-notebook-default',
    'correct-a-mistake-and-continue': 'manual/editing-and-running.html#correct-a-mistake-and-continue',
    'run-a-whole-notebook-or-a-range': 'manual/editing-and-running.html#run-a-whole-notebook-or-a-range',
    '4-what-context-does-the-ai-receive': 'manual/context-selection.html',
    'choose-the-notebooks-context-mode': 'manual/context-selection.html#choose-the-notebooks-context-mode',
    'choose-individual-cells': 'manual/context-selection.html#choose-individual-cells',
    'understand-ai-history-and-source': 'manual/context-selection.html#understand-ai-history-and-source',
    'preview-and-limits': 'manual/context-selection.html#preview-and-limits',
    'why-a-selected-cell-may-be-missing': 'manual/context-selection.html#why-a-selected-cell-may-be-missing',
    'choose-text-and-tools-separately': 'manual/context-selection.html#choose-text-and-tools-separately',
    '5-reference-live-variables-and-functions': 'manual/variables-and-tools.html',
    '6-how-cells-are-stored': 'manual/saving-and-privacy.html#how-cells-are-stored',
    '7-where-keys-are-stored': 'manual/saving-and-privacy.html#where-keys-are-stored',
    '8-how-it-works-underneath': 'manual/saving-and-privacy.html#how-it-works-underneath',
    '9-troubleshooting-and-limits': 'manual/troubleshooting.html'
  };
  const redirectLegacyFragment = () => {
    let fragment;
    try {
      fragment = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(legacy, fragment)) {
      location.replace(new URL(legacy[fragment], location.href));
    }
  };
  window.addEventListener('hashchange', redirectLegacyFragment);
  redirectLegacyFragment();
})();
</script>

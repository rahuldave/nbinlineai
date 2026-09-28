---
title: User guide
---

<span id="nbinlineai-user-manual"></span>

# User guide

Start with setup, then read the chapters you need. These chapters describe version **0.1.15**, including Configure AI's two tabs, default connection settings, inherited cell choices, and cleaner waiting answer cells. The [FAQ](faq.md) answers common edge cases.

<span id="contents"></span>

1. [Install and connect](manual/setup.md) — install the extension, connect ChatGPT or an API key, and understand account limits.
2. [Write and run AI questions](manual/prompts.md) — create prompts, continue conversations, copy code, and request a new code cell.
3. [Models, styles, and effort](manual/models-and-styles.md) — choose providers and models, customize response styles, and set thinking effort.
4. [Edit, rerun, and run notebooks](manual/editing-and-running.md) — correct answers, use Keep answer, and run a whole notebook safely.
5. [Choose notebook context](manual/context-selection.md) — select cells and tools, preview what fits, and compare OpenAI API, Claude API, and ChatGPT context budgets.
6. [Live values and tools](manual/variables-and-tools.md) — reference kernel values and offer Python functions and bundled notebook tools.
7. [Saved notebooks and privacy](manual/saving-and-privacy.md) — understand saved AI cells, key storage, account state, and the request path.
8. [Troubleshooting and limits](manual/troubleshooting.md) — resolve common problems and check size and tool-round limits.

The [tools reference](tools.md) lists callable functions, and the [examples guide](examples.md) has notebooks you can try.

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

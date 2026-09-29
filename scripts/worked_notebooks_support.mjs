// Pure helpers for public-safe worked notebook evidence.
export function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  text = text.replace(/(?:Bearer\s+|token[=:]\s*)[^\s"']+/ig, '[redacted]')
    .replace(/(?:\/Users\/|\/home\/|\/tmp\/|\/(?:private\/)?var\/folders\/)[^\s"']+/g, '[local path]')
    .replace(/((?:device_id|deviceId|group_id|groupId|source_id|sourceId)["']?\s*[:=]\s*["'])[^"']+/gi,
      '$1[opaque hardware reference]')
    .replace(/[A-Za-z0-9+/_-]{200,}={0,2}/g, '[large or opaque value]');
  return text.slice(0, 700);
}
export function frames(body) {
  return body.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(item => item.startsWith('data: '));
    if (!line) return [];
    try { return [JSON.parse(line.slice(6))]; } catch { return []; }
  });
}
export function observedTrace(questionId, events) {
  const calls = [];
  const byId = new Map();
  for (const event of events) {
    if (event.type === 'tool_start') {
      const call = { questionId, name: event.name, arguments: redact(event.arguments),
        result: '[no result event]', invoked: true, resultState: 'unresolved', frontendAction: false };
      calls.push(call);
      byId.set(event.id, call);
    } else if (event.type === 'frontend_action') {
      // The action event carries run_id/request_id, not the model tool-call ID.
      // Prompt emits start, optional action, then result for each call in order.
      const pending = [...calls].reverse().find(call => call.result === '[no result event]');
      if (pending) pending.frontendAction = true;
    } else if (event.type === 'tool_result') {
      const call = byId.get(event.id);
      if (!call) continue;
      const raw = String(event.text ?? '');
      call.resultState = toolResultState(raw);
      call.result = call.name === 'list_media_sources'
        ? '[real device list returned; labels and identifiers withheld from public copy]'
        : redact(raw);
    }
  }
  return calls;
}
export function toolResultState(value) {
  const trimmed = value.trim();
  if (!trimmed || /^Error\s*:/i.test(trimmed)) return 'failed';
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const status = String(parsed.status ?? parsed.state ?? '').toLowerCase();
      if (['error', 'failed', 'expired', 'unsupported', 'cancelled', 'canceled'].includes(status)) return 'failed';
      if (parsed.ok === false || parsed.error) return 'failed';
      if (['accepted', 'pending', 'running', 'queued'].includes(status)) return 'receipt accepted';
    }
  } catch { /* A plain successful tool text is valid. */ }
  return 'completed';
}
export function normalizePublicCopy(notebook) {
  let replaced = 0;
  const localPath = /(?:\/Users\/[^\s"'<>|]+|\/home\/[^\s"'<>|]+|\/tmp\/nbinlineai-[^\s"'<>|]+|\/(?:private\/)?var\/folders\/[^\s"'<>|]+)/g;
  const normalize = value => {
    if (typeof value === 'string') return value.replace(localPath, () => {
      replaced += 1;
      return '[temporary local path]';
    });
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
    }
    return value;
  };
  for (const cell of notebook.cells) {
    if (cell.cell_type === 'code') {
      cell.outputs = normalize(cell.outputs ?? []);
      if (cell.id.startsWith('capture-list_media_sources-')) {
        cell.outputs = [{ output_type: 'stream', name: 'stdout',
          text: ['Real hardware source discovery completed; labels and identifiers withheld from public copy.\n'] }];
        replaced += 1;
      }
    }
    if (cell.metadata?.nbinlineai?.isOutputCell || cell.metadata?.nbinlineaiWorkedTrace) {
      cell.source = normalize(cell.source);
    }
  }
  notebook.metadata ??= {};
  if (replaced) notebook.metadata.nbinlineaiWorked = {
    ...notebook.metadata.nbinlineaiWorked,
    savedCopyNormalization: `${replaced} temporary local path reference(s) replaced in displayed results`
  };
}
export function addTraceAppendix(notebook, traces) {
  if (!traces.length) return;
  const grouped = new Map();
  for (const item of traces) grouped.set(item.questionId, [...(grouped.get(item.questionId) ?? []), item]);
  for (const [questionId, items] of grouped) {
    const answerIndex = notebook.cells.findIndex(cell => cell.metadata?.nbinlineai?.isOutputCell &&
      cell.metadata.nbinlineai.promptCellId === questionId);
    if (answerIndex < 0) throw new Error(`No saved answer for observed tool call in ${questionId}`);
    const tableCell = value => value.replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
    const rows = items.map(item => `| \`${item.name}\` | ${item.resultState} | ${tableCell(item.arguments)} | ${tableCell(item.result)} |`);
    notebook.cells.splice(answerIndex + 1, 0, { cell_type: 'markdown', id: `worked-trace-${questionId}`,
      metadata: { nbinlineaiWorkedTrace: true, questionCellId: questionId },
      source: ['**Observed live tool calls for the answer above** (actual subscription events; private fields shortened).\n\n',
        '| Tool | Result state | Submitted arguments | Observed result |\n',
        '| --- | --- | --- | --- |\n', ...rows.map(row => `${row}\n`)] });
  }
}
export function assertSafeNotebook(notebook) {
  const encoded = JSON.stringify(notebook);
  for (const pattern of [/(?:Bearer\s+|sk-[A-Za-z0-9_-]{20,})/i,
    /(?:\/Users\/|\/home\/rahul\/|\/tmp\/nbinlineai-|\/(?:private\/)?var\/folders\/)/,
    /(?:device_code|verification_url|auth_url)["']?\s*:/i]) {
    if (pattern.test(encoded)) throw new Error('Saved notebook contains a sensitive field or local path');
  }
  if (encoded.length > 30_000_000) throw new Error('Saved notebook exceeds the worked-output size limit');
}

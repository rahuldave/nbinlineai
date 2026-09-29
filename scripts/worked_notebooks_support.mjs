// Pure helpers for public-safe worked notebook evidence.
export function requiresSubscription(entry) {
  return Array.isArray(entry?.steps) && entry.steps.some(step => step?.action === 'ai');
}

export function rejectLimitedSubscription(choice) {
  if (choice?.state === 'limited') {
    throw new Error('Managed ChatGPT usage is limited; actual AI questions must wait for the account reset');
  }
}

export function boundKernelSession(created, sessions, path) {
  if (!created || typeof created.id !== 'string' || typeof created.kernel?.id !== 'string' ||
      !Array.isArray(sessions)) throw new Error('Created notebook session is invalid');
  const matches = sessions.filter(item => item?.path === path);
  if (matches.length > 1) throw new Error('Notebook has multiple kernel sessions');
  if (!matches.length) return null;
  if (matches[0].id !== created.id || matches[0].kernel?.id !== created.kernel.id) {
    throw new Error('Notebook changed its owned kernel session');
  }
  return created.kernel.id;
}
export function verifiedCodeWidgetSource(cell, renderedCode) {
  if (cell?.cell_type !== 'code' || typeof renderedCode !== 'string')
    throw new Error('Current code widget or model source is missing');
  const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
  // CodeMirror may insert zero-width layout characters and omit the final
  // display newline. Ordinary spaces remain significant inside code strings.
  const rendered = value => String(value ?? '').replace(/\r\n/g, '\n')
    .replace(/\u200b/g, '').replace(/\n$/, '');
  if (rendered(source) !== rendered(renderedCode)) {
    const expected = rendered(source);
    const actual = rendered(renderedCode);
    let index = 0;
    while (index < expected.length && index < actual.length && expected[index] === actual[index]) index++;
    throw new Error(`Current code widget disagrees with saved model source at offset ${index} ` +
      `(model length ${expected.length}, display length ${actual.length}, ` +
      `codepoints ${expected.codePointAt(index) ?? 'end'}/${actual.codePointAt(index) ?? 'end'})`);
  }
  return cell;
}
export function liveCellIndex(cells, id, kind) {
  if (!Array.isArray(cells) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    throw new Error('Current cell model is invalid');
  }
  const matches = cells.flatMap((cell, index) => cell?.id === id ? [index] : []);
  if (matches.length !== 1) throw new Error(`Current cell ${id} is missing or duplicated`);
  const cell = cells[matches[0]];
  if (kind === 'code' ? cell.cell_type !== 'code' :
      kind === 'question' ? cell.cell_type !== 'markdown' || cell.metadata?.nbinlineai?.isPromptCell !== true : true) {
    throw new Error(`Current cell ${id} has the wrong type`);
  }
  return matches[0];
}
export function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  text = text.replace(/(?:Bearer\s+|token[=:]\s*)[^\s"']+/ig, '[redacted]')
    .replace(/(?:\/Users\/|\/home\/|\/tmp\/|\/(?:private\/)?var\/folders\/)[^\s"']+/g, '[local path]')
    .replace(/(["']?(?:device_id|deviceId|group_id|groupId|source_id|sourceId|label)["']?\s*[:=]\s*["'])[^"']+/gi,
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
      const submitted = typeof event.arguments === 'string' ? parsedObject(event.arguments) : event.arguments;
      call.targetOperationId = safeOperationId(submitted?.operation_id);
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
      const result = parsedObject(raw);
      call.operationId = safeOperationId(result?.operation_id);
      if (['requested', 'accepted', 'pending', 'waiting_for_user', 'running', 'paused',
        'saving', 'completed', 'cancelled', 'failed', 'expired', 'inserted'].includes(result?.status)) {
        call.operationState = result.status;
      }
      call.result = call.name === 'list_media_sources'
        ? '[real device list returned; labels and identifiers withheld from public copy]'
        : redact(raw);
    }
  }
  return calls;
}
function parsedObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function safeOperationId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(value) ? value : undefined;
}
export function structuredEvidence(questionId, calls) {
  return { questionCellId: questionId, observedTools: calls.map(call => ({
    name: call.name, resultState: call.resultState, frontendAction: call.frontendAction,
    ...(call.operationId ? { operationId: call.operationId } : {}),
    ...(call.targetOperationId ? { targetOperationId: call.targetOperationId } : {}),
    ...(call.operationState ? { operationState: call.operationState } : {}),
  })) };
}
export function toolResultState(value) {
  const trimmed = value.trim();
  if (!trimmed || /^Error\s*:/i.test(trimmed)) return 'failed';
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const status = String(parsed.status ?? parsed.state ?? '').toLowerCase();
      if (['error', 'failed', 'expired', 'unsupported', 'cancelled', 'canceled'].includes(status)) return 'failed';
      if (parsed.ok === false || parsed.error ||
          (typeof parsed.code === 'string' && typeof parsed.message === 'string')) return 'failed';
      if (['accepted', 'pending', 'running', 'queued', 'waiting_for_user', 'saving', 'paused'].includes(status)) {
        return 'receipt accepted';
      }
    }
  } catch { /* A plain successful tool text is valid. */ }
  return 'completed';
}
export function sensitiveHardwareValues(text) {
  const values = [];
  const pattern = /["']?(?:device_id|deviceId|group_id|groupId|source_id|sourceId|label)["']?\s*[:=]\s*(["'])([^"']{1,200})\1/gi;
  for (const match of String(text).matchAll(pattern)) values.push(match[2]);
  return values;
}
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}
export function normalizePublicCopy(notebook, privateHardwareValues = new Set()) {
  let replaced = 0;
  const localPath = /(?:\/Users\/[^\s"'<>|]+|\/home\/[^\s"'<>|]+|\/tmp\/nbinlineai-[^\s"'<>|]+|\/(?:private\/)?var\/folders\/[^\s"'<>|]+)/g;
  for (const cell of notebook.cells) {
    if (cell.cell_type !== 'code') continue;
    for (const outputText of stringsIn(cell.outputs ?? [])) {
      for (const value of sensitiveHardwareValues(outputText)) privateHardwareValues.add(value);
    }
  }
  const normalize = value => {
    if (typeof value === 'string') {
      let text = value.replace(localPath, () => {
        replaced += 1;
        return '[temporary local path]';
      });
      text = text.replace(/(["']?(?:device_id|deviceId|group_id|groupId|source_id|sourceId|label)["']?\s*[:=]\s*["'])[^"']+/gi,
        (_full, prefix) => { replaced += 1; return `${prefix}[opaque hardware reference]`; });
      for (const privateValue of privateHardwareValues) {
        if (!privateValue || !text.includes(privateValue)) continue;
        if (privateValue.length < 4) {
          const escaped = privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          text = text.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g'),
            '[private device detail]');
        } else {
          text = text.replaceAll(privateValue, '[private device detail]');
        }
        replaced += 1;
      }
      return text;
    }
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
    savedCopyNormalization: `${replaced} private path/device reference(s) replaced in displayed results`
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
      metadata: { nbinlineaiWorkedTrace: true, questionCellId: questionId,
        nbinlineaiWorkedEvidence: structuredEvidence(questionId, items) },
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
  for (const cell of notebook.cells) {
    const displayed = cell.cell_type === 'code' ? cell.outputs :
      (cell.metadata?.nbinlineai?.isOutputCell || cell.metadata?.nbinlineaiWorkedTrace ? cell.source : []);
    const actualHardwareValues = stringsIn(displayed).flatMap(sensitiveHardwareValues).filter(
      value => !value.startsWith('[opaque hardware reference]') && !value.startsWith('[private device detail]'));
    if (actualHardwareValues.length) throw new Error('Saved notebook contains a raw hardware detail');
  }
  if (encoded.length > 30_000_000) throw new Error('Saved notebook exceeds the worked-output size limit');
}

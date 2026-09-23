import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedContextText, contextTooltip, contextWasTrimmed, parseContextReport, runningContextText, runningProgressText } from '../../src/contextStatus';

const reportEvent = {
  cell_count: 7,
  preceding_cell_count: 12,
  omitted_cell_count: 4,
  partial_cell_count: 1,
  context_chars: 24500,
  context_budget_chars: 64000,
  tool_schema_chars: 1200,
  source_truncated: true,
  history_truncated: false,
  tools: ['read_cell', 'insert_markdown']
};

test('reports included cells and tools while running, then names trimmed context', () => {
  const report = parseContextReport(reportEvent);
  assert.ok(report);
  assert.equal(runningContextText(report), 'Using 7 cells · 2 tools…');
  assert.equal(runningProgressText('Running read_cell…', report), 'Running read_cell… · 7 cells · 2 tools');
  assert.equal(contextWasTrimmed(report), true);
  assert.equal(completedContextText(contextWasTrimmed(report)), 'Done · context trimmed');
  const tooltip = contextTooltip(report);
  for (const detail of ['7 included of 12 submitted', '4 omitted', '1 partial', 'read_cell, insert_markdown',
    '24,500 / 64,000 budget', 'tool schemas: 1,200 characters', 'not tokens or exact model usage']) {
    assert.ok(tooltip.includes(detail), detail);
  }
});

test('an untrimmed final round still discloses an earlier trimmed round', () => {
  const report = parseContextReport({ ...reportEvent, omitted_cell_count: 0, partial_cell_count: 0,
    source_truncated: false, history_truncated: false, tools: [] });
  assert.ok(report);
  assert.equal(contextWasTrimmed(report), false);
  assert.equal(completedContextText(true), 'Done · context trimmed');
  assert.match(contextTooltip(report, true), /earlier provider round trimmed context/);
});

test('older or invalid reports fall back instead of showing misleading counts', () => {
  assert.equal(parseContextReport({ cell_count: 3, tools: ['read_cell'] }), null);
  assert.equal(parseContextReport({ ...reportEvent, cell_count: -1 }), null);
  assert.equal(parseContextReport({ ...reportEvent, context_budget_chars: 0 }), null);
  assert.equal(parseContextReport({ ...reportEvent, partial_cell_count: 8 }), null);
  assert.equal(parseContextReport({ ...reportEvent, tools: ['read_cell', 42] }), null);
  assert.equal(parseContextReport({ ...reportEvent, source_truncated: 'yes' }), null);
  assert.equal(runningProgressText('Generating…', null), 'Generating…');
  assert.equal(completedContextText(false), 'Done');
});

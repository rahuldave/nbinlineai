import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightStructured, pythonResultChars, resultFits } from '../../src/browserMediaResultBudget';

test('result bound counts Python ASCII escapes and default separator spaces', () => {
  assert.equal(pythonResultChars({ text: 'é😀' }), 30); // {"text": "\\u00e9\\ud83d\\ude00"}
  assert.equal(resultFits({ text: 'é'.repeat(240) }), false);
  assert.equal(resultFits({ text: 'é'.repeat(200) }), true);
  assert.equal(resultFits({ values: Array.from({ length: 200 }, (_, index) => index) }), false);
});

test('structured preflight refuses huge live tables before JSON stringify', () => {
  assert.doesNotThrow(() => preflightStructured({ rows: [{ value: 'small' }] }));
  assert.throws(() => preflightStructured({ rows: Array.from({ length: 300 }, () => 'x') }, 500),
    /too large/);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => preflightStructured(cycle), /cycle/);
});

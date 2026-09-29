import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedPasteResult } from '../../src/browserMediaPasteResult';
import { resultFits } from '../../src/browserMediaResultBudget';

test('short paste remains intact and reports its original code-point count', () => {
  const result = boundedPasteResult('two 🧪 samples');
  assert.deepEqual(result, { text: 'two 🧪 samples', truncated: false, original_chars: 13 });
  assert.equal(resultFits(result), true);
});

test('2000 ASCII characters return an explicit bounded prefix', () => {
  const source = 'x'.repeat(2000);
  const result = boundedPasteResult(source);
  assert.equal(result.truncated, true);
  assert.equal(result.original_chars, 2000);
  assert.ok(result.text.length > 1000 && result.text.length < 2000);
  assert.equal(resultFits(result), true);
  assert.equal(source.startsWith(result.text), true);
  assert.equal(resultFits({ ...result, text: result.text + 'x' }), false);
});

test('Unicode paste keeps whole code points under the Python JSON bound', () => {
  const source = '🧪é'.repeat(1000);
  const result = boundedPasteResult(source);
  assert.equal(result.truncated, true);
  assert.equal(result.original_chars, 2000);
  assert.equal(resultFits(result), true);
  assert.equal(source.startsWith(result.text), true);
  assert.equal(result.text.endsWith('\ud83e'), false);
});

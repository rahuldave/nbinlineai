import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedCapabilityFacts } from '../../src/browserMediaCapabilities';

test('large family registry keeps every availability bit while bounding optional detail', () => {
  const entries = Array.from({ length: 45 }, (_, index): [string, { available: boolean; reason: string; formats: string[] }] => [
    `operation_${String(index).padStart(2, '0')}`,
    { available: index % 2 === 0, reason: 'needs a supported device or format '.repeat(8),
      formats: ['image/png', 'image/jpeg', 'audio/webm', 'video/webm', 'video/mp4'] }
  ]);
  const summary = boundedCapabilityFacts(entries);
  assert.ok(summary.omitted_details > 0);
  assert.equal(Object.keys(summary.operations).length, 45);
  assert.equal(summary.operations.operation_00, true);
  assert.equal(summary.operations.operation_01, false);
  assert.ok(JSON.stringify(summary).length <= 2600);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
});

test('maximum registered names still retain all availability values', () => {
  const entries = Array.from({ length: 48 }, (_, index): [string, { available: boolean }] => [
    `tool_${String(index).padStart(2, '0')}_${'x'.repeat(32)}`, { available: index % 2 === 0 }
  ]);
  const summary = boundedCapabilityFacts(entries);
  assert.equal(Object.keys(summary.operations).length, 48);
  assert.ok(JSON.stringify(summary).length <= 2500);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BrowserSource } from '../../src/browserMediaClient';
import { mediaSourcePage, settingsFor } from '../../src/browserMediaCaptureResults';
import { resultFits } from '../../src/browserMediaResultBudget';

function pythonLength(value: unknown): number {
  const interpreter = process.env.VIRTUAL_ENV ? join(process.env.VIRTUAL_ENV,
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') : 'python3';
  const output = execFileSync(interpreter, ['-c',
    'import json,sys; print(len(json.dumps(json.load(sys.stdin))))'],
  { input: JSON.stringify(value), encoding: 'utf8' });
  return Number(output.trim());
}

test('Unicode device paging fits Python JSON, preserves exact IDs and advances the cursor', () => {
  const devices = [
    { kind: 'videoinput', deviceId: '界'.repeat(200), label: 'é'.repeat(100) },
    { kind: 'audioinput', deviceId: 'microphone', label: '😀'.repeat(50) },
    { kind: 'videoinput', deviceId: 'camera', label: 'Camera' }
  ];
  let cursor = 0;
  const seen: string[] = [];
  let truncated = false;
  for (let pageNumber = 0; pageNumber < devices.length; pageNumber++) {
    const page = mediaSourcePage(devices, cursor, 50);
    assert.ok(resultFits(page));
    assert.ok(pythonLength(page) <= 1500);
    seen.push(...page.devices.map(device => device.device_id));
    truncated ||= page.labels_truncated;
    if (!page.next_cursor) break;
    const next = Number(page.next_cursor);
    assert.ok(next > cursor, 'A nonterminal page must advance the cursor.');
    cursor = next;
  }
  assert.deepEqual(seen, devices.map(device => device.deviceId));
  assert.equal(truncated, true);
});

test('source settings retain usable exact IDs or explicitly omit oversized browser IDs', () => {
  const source = (deviceId: string, facingMode: string): BrowserSource => ({
    sourceId: 'source', kind: 'camera', state: 'live', actions: [], onEnded() {},
    tracks: [{ kind: 'video', getSettings: () => ({ deviceId, facingMode, width: 640, height: 480 }) } as MediaStreamTrack]
  });
  const exact = settingsFor(source('界'.repeat(200), '🌟'.repeat(100)));
  assert.equal(exact.device_id, '界'.repeat(200));
  assert.equal(exact.settings_truncated, true);
  assert.ok(resultFits(exact));
  assert.ok(pythonLength(exact) <= 1500);
  const omitted = settingsFor(source('😀'.repeat(300), 'user'));
  assert.equal(omitted.device_id, undefined);
  assert.equal(omitted.device_id_omitted, true);
  assert.ok(pythonLength(omitted) <= 1500);
});

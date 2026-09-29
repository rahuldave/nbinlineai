import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLiveReceipt, waitForReceiptStates } from '../scripts/worked_receipt_ready.mjs';

const id = 'AbCdEf0123456789_-AbCdEf01234567';

test('mixed completed and running receipts wait for every exact variable', async () => {
  let round = 0;
  const seen = [];
  const states = await waitForReceiptStates({ name: 'outputs', variables: ['raster_listing', 'text_listing'],
    timeoutMs: 1000, read: async variable => {
      seen.push(variable);
      if (variable === 'text_listing') return { operationId: id, status: round++ ? 'completed' : 'running' };
      return { operationId: id, status: 'completed' };
    }, sleep: async () => {} });
  assert.deepEqual(seen, ['raster_listing', 'text_listing', 'raster_listing', 'text_listing']);
  assert.deepEqual(states.map(state => state.status), ['completed', 'completed']);
});

test('a running receipt without a registered ID is provisional even for active readiness', async () => {
  let reads = 0;
  const states = await waitForReceiptStates({ name: 'recording', variables: ['recording'],
    expectedStatus: 'running', timeoutMs: 1000,
    read: async () => (++reads === 1
      ? { operationId: null, status: 'running' } : { operationId: id, status: 'running' }),
    sleep: async () => {} });
  assert.equal(reads, 2);
  assert.equal(states[0].operationId, id);
});

test('terminal error rejects before another named receipt can conceal it', async () => {
  const seen = [];
  await assert.rejects(waitForReceiptStates({ name: 'outputs', variables: ['failed_one', 'other'],
    timeoutMs: 1000, read: async variable => {
      seen.push(variable); return { operationId: id, status: variable === 'failed_one' ? 'failed' : 'completed' };
    } }), /failed for failed_one/);
  assert.deepEqual(seen, ['failed_one']);
});

test('remaining deadline bounds serial probes and rejects an unfinished receipt', async () => {
  let clock = 0;
  const remaining = [];
  await assert.rejects(waitForReceiptStates({ name: 'outputs', variables: ['first', 'second'],
    timeoutMs: 1000, now: () => clock, sleep: async ms => { clock += ms; },
    read: async (_variable, budget) => { remaining.push(budget); clock += 450;
      return { operationId: id, status: 'running' }; } }), /timed out/);
  assert.deepEqual(remaining, [1000, 550]);
  assert.equal(clock, 1000);
});

test('a completed probe arriving after the deadline is not accepted', async () => {
  let clock = 0;
  await assert.rejects(waitForReceiptStates({ name: 'late', variables: ['receipt'],
    timeoutMs: 100, now: () => clock,
    read: async () => { clock = 101; return { operationId: id, status: 'completed' }; },
  }), /timed out/);
});

test('a timed-out receipt subprocess is killed and cannot hold the runner open', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'nbinlineai-receipt-test-'));
  const script = join(folder, 'linger.mjs');
  await writeFile(script, 'setInterval(() => {}, 1000);\n');
  let child;
  let closed;
  try {
    await assert.rejects(readLiveReceipt(process.execPath, script, 'kernel', 'receipt', {
      timeoutMs: 100, spawnProcess: (...args) => {
        child = spawn(...args);
        closed = new Promise(resolve => child.once('close', resolve));
        return child;
      },
    }), /timed out/);
    assert.equal(child.killed, true);
    await closed;
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('insert_tools state uses a separate explicit probe kind', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'nbinlineai-insertion-test-'));
  const script = join(folder, 'probe.mjs');
  await writeFile(script, 'process.stdout.write(JSON.stringify({kind:process.argv.slice(2)}));\n');
  try {
    const insertion = await readLiveReceipt(process.execPath, script, 'kernel', 'receipt',
      { kind: 'insert_tools', timeoutMs: 2000 });
    assert.deepEqual(insertion.kind, ['kernel', 'receipt', '--kind', 'insert_tools']);
    const browser = await readLiveReceipt(process.execPath, script, 'kernel', 'receipt',
      { timeoutMs: 2000 });
    assert.deepEqual(browser.kind, ['kernel', 'receipt']);
    assert.throws(() => readLiveReceipt(process.execPath, script, 'kernel', 'receipt',
      { kind: 'unrecognized' }), /Invalid receipt kind/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

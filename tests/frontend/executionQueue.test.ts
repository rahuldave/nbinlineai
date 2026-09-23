import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueNotebookCell } from '../../src/executionQueue';

const deferred = () => {
  let resolve!: (value: boolean) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<boolean>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('native concurrent executor calls run in notebook order', async () => {
  const notebook = {};
  const first = deferred();
  const calls: string[] = [];
  const codeBefore = enqueueNotebookCell(notebook, async () => {
    calls.push('code before');
    return first.promise;
  });
  const ai = enqueueNotebookCell(notebook, async () => { calls.push('AI'); return true; });
  const codeAfter = enqueueNotebookCell(notebook, async () => { calls.push('code after'); return true; });
  await Promise.resolve();
  assert.deepEqual(calls, ['code before']);
  first.resolve(true);
  assert.deepEqual(await Promise.all([codeBefore, ai, codeAfter]), [true, true, true]);
  assert.deepEqual(calls, ['code before', 'AI', 'code after']);
});

test('false and cancellation skip the current run but a later run starts fresh', async () => {
  const notebook = {};
  const calls: string[] = [];
  const failed = enqueueNotebookCell(notebook, async () => { calls.push('cancelled AI'); return false; });
  const skipped = enqueueNotebookCell(notebook, async () => { calls.push('later code'); return true; });
  assert.deepEqual(await Promise.all([failed, skipped]), [false, false]);
  assert.deepEqual(calls, ['cancelled AI']);

  const fresh = await enqueueNotebookCell(notebook, async () => { calls.push('new run'); return true; });
  assert.equal(fresh, true);
  assert.deepEqual(calls, ['cancelled AI', 'new run']);
});

test('rejection skips queued work without poisoning the next batch or another notebook', async () => {
  const notebook = {};
  const otherNotebook = {};
  const first = deferred();
  const calls: string[] = [];
  const failed = enqueueNotebookCell(notebook, async () => { calls.push('first'); return first.promise; });
  const skipped = enqueueNotebookCell(notebook, async () => { calls.push('skipped'); return true; });
  const independent = enqueueNotebookCell(otherNotebook, async () => { calls.push('other'); return true; });

  await Promise.resolve();
  assert.deepEqual(calls, ['first', 'other']);
  assert.equal(await independent, true);
  const later = enqueueNotebookCell(notebook, async () => { calls.push('later batch'); return true; });
  first.reject(new Error('kernel failed'));
  await assert.rejects(failed, /kernel failed/);
  assert.equal(await skipped, false);
  assert.equal(await later, true);
  assert.deepEqual(calls, ['first', 'other', 'later batch']);
});

test('a second native run joins pending AI without a second request and stops its later cells on failure', async () => {
  const notebook = {};
  const response = deferred();
  const calls: string[] = [];
  const firstAI = enqueueNotebookCell(notebook, async () => { calls.push('AI request'); return response.promise; });
  const firstLater = enqueueNotebookCell(notebook, async () => { calls.push('first later code'); return true; });
  await Promise.resolve(); // A separate command starts after the first native run's synchronous batch.
  const secondBefore = enqueueNotebookCell(notebook, async () => { calls.push('second earlier code'); return true; });
  const joinedAI = enqueueNotebookCell(notebook, () => firstAI);
  const secondLater = enqueueNotebookCell(notebook, async () => { calls.push('second later code'); return true; });
  response.resolve(false);
  assert.deepEqual(await Promise.all([firstAI, firstLater, secondBefore, joinedAI, secondLater]), [false, false, true, false, false]);
  assert.deepEqual(calls, ['AI request', 'second earlier code']);
});

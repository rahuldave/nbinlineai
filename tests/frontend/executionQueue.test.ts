import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueNotebookCell, scheduleNotebookContinuation } from '../../src/executionQueue';

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

test('terminal handoff runs before later native batch work and coalesces the same source obligation', async () => {
  const notebook = {};
  const calls: string[] = [];
  const first = enqueueNotebookCell(notebook, async () => {
    calls.push('prompt');
    scheduleNotebookContinuation(notebook, async () => { calls.push('handoff code'); return true; },
      { cellId: 'c1', source: 'print(1)' });
    return true;
  });
  const duplicate = enqueueNotebookCell(notebook, async () => { calls.push('duplicate code'); return true; },
    { cellId: 'c1', source: 'print(1)' });
  const later = enqueueNotebookCell(notebook, async () => { calls.push('later code'); return true; });
  assert.deepEqual(await Promise.all([first, duplicate, later]), [true, true, true]);
  assert.deepEqual(calls, ['prompt', 'handoff code', 'later code']);
});

test('conflicting same-cell batch obligation fails visibly and stops later work', async () => {
  const notebook = {};
  const calls: string[] = [];
  const first = enqueueNotebookCell(notebook, async () => {
    scheduleNotebookContinuation(notebook, async () => { calls.push('wrong run'); return true; },
      { cellId: 'c1', source: 'print(2)' });
    return true;
  });
  const conflict = enqueueNotebookCell(notebook, async () => { calls.push('native run'); return true; },
    { cellId: 'c1', source: 'print(1)' });
  await assert.rejects(first, /different source/);
  assert.equal(await conflict, false);
  assert.deepEqual(calls, []);
});

test('failed predecessor never dispatches a scheduled continuation', async () => {
  const notebook = {};
  const calls: string[] = [];
  const predecessor = enqueueNotebookCell(notebook, async () => {
    scheduleNotebookContinuation(notebook, async () => { calls.push('successor'); return true; }, undefined,
      () => calls.push('discarded'));
    return false;
  });
  assert.equal(await predecessor, false);
  assert.deepEqual(calls, ['discarded']);
});

test('one source execution schedules at most one successor, while a successor may chain onward', async () => {
  const notebook = {};
  const calls: string[] = [];
  const result = await enqueueNotebookCell(notebook, async () => {
    scheduleNotebookContinuation(notebook, async () => {
      calls.push('first successor');
      scheduleNotebookContinuation(notebook, async () => { calls.push('second successor'); return true; });
      return true;
    });
    assert.throws(() => scheduleNotebookContinuation(notebook, async () => true), /already scheduled/);
    return true;
  });
  assert.equal(result, true);
  assert.deepEqual(calls, ['first successor', 'second successor']);
});

/** Bounded, read-only receipt polling between notebook kernel turns. */
import { spawn } from 'node:child_process';

const STATES = new Set(['pending', 'waiting_for_user', 'running', 'saving', 'paused',
  'completed', 'failed', 'cancelled', 'expired']);
const EXPECTED = new Set(['pending', 'waiting_for_user', 'running', 'saving', 'paused', 'completed']);
const TERMINAL_ERRORS = new Set(['failed', 'cancelled', 'expired']);
const VARIABLE = /^[A-Za-z_][A-Za-z_0-9]{0,100}$/;
const OPERATION_ID = /^[A-Za-z0-9_-]{16,100}$/;

export function readLiveReceipt(python, script, kernelId, variable,
  { timeoutMs = 25_000, allowUnregistered = false, kind = 'browser', spawnProcess = spawn } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid receipt probe timeout');
  if (!['browser', 'insert_tools'].includes(kind)) throw new Error('Invalid receipt kind');
  return new Promise((resolveReceipt, rejectReceipt) => {
    const args = [script, kernelId, variable, ...(allowUnregistered ? ['--allow-unregistered'] : []),
      ...(kind === 'insert_tools' ? ['--kind', kind] : [])];
    const child = spawnProcess(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectReceipt(error);
      else resolveReceipt(result);
    };
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Live receipt probe timed out'));
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 500) {
        child.kill('SIGKILL');
        finish(new Error('Live receipt state was oversized'));
      }
    });
    child.stderr.on('data', () => { /* Never print kernel connection details. */ });
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (code !== 0) return finish(new Error('Live receipt state could not be verified'));
      try { finish(null, JSON.parse(stdout)); }
      catch { finish(new Error('Live receipt state was invalid')); }
    });
  });
}

export async function waitForReceiptStates({ name, variables, expectedStatus = 'completed', timeoutMs,
  read, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!Array.isArray(variables) || !variables.length || variables.length > 8 ||
      variables.some(value => typeof value !== 'string' || !VARIABLE.test(value)) ||
      !EXPECTED.has(expectedStatus) || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error(`${name} has invalid receipt readiness criteria`);
  }
  const deadline = now() + Math.min(timeoutMs, 60_000);
  while (true) {
    const states = [];
    for (const variable of variables) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error(`${name} receipt readiness timed out`);
      const state = await read(variable, remaining);
      if (now() > deadline) throw new Error(`${name} receipt readiness timed out`);
      if (!state || !STATES.has(state.status) ||
          (state.operationId !== null && (typeof state.operationId !== 'string' ||
            !OPERATION_ID.test(state.operationId)))) {
        throw new Error(`${name} receipt readiness returned invalid state`);
      }
      if (TERMINAL_ERRORS.has(state.status)) {
        throw new Error(`${name} receipt readiness failed for ${variable}`);
      }
      states.push(state);
    }
    // A new Python BrowserReceipt can be running before its operation ID is
    // registered. Never accept that provisional state as final evidence.
    if (states.every(state => state.status === expectedStatus && state.operationId !== null)) return states;
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`${name} receipt readiness timed out`);
    await sleep(Math.min(350, remaining));
  }
}

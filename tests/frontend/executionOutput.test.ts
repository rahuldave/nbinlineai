import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionTextCollector } from '../../src/executionOutput';

test('clear_output(wait) retains old text until next output, then replaces it', () => {
  const output = new ExecutionTextCollector();
  output.accept('stream', { text: 'before' });
  output.accept('clear_output', { wait: true });
  assert.equal(output.snapshot().text, 'before');
  output.accept('stream', { text: 'after' });
  assert.equal(output.snapshot().text, 'after');
});

test('display update replaces only its matching display, even with duplicate text', () => {
  const output = new ExecutionTextCollector();
  output.accept('display_data', { data: { 'text/plain': 'same' }, transient: { display_id: 'a' } });
  output.accept('display_data', { data: { 'text/plain': 'same' }, transient: { display_id: 'b' } });
  output.accept('update_display_data', { data: { 'text/plain': 'new' }, transient: { display_id: 'b' } });
  assert.equal(output.snapshot().text, 'same\nnew\n');
});

test('bounded output marks truncation and omitted rich-only output', () => {
  const output = new ExecutionTextCollector();
  output.accept('stream', { text: '123456' });
  output.accept('display_data', { data: { 'image/png': 'encoded' } });
  assert.deepEqual(output.snapshot(4), { text: '1234', truncated: true, rich_output_omitted: true });
});

test('a rich-only output after deferred clear removes old text and reports omission', () => {
  const output = new ExecutionTextCollector();
  output.accept('stream', { text: 'old' });
  output.accept('clear_output', { wait: true });
  output.accept('display_data', { data: { 'image/png': 'encoded' } });
  assert.deepEqual(output.snapshot(), { text: '', truncated: false, rich_output_omitted: true });
});

test('error text remains available for a failed step', () => {
  const output = new ExecutionTextCollector();
  output.accept('error', { ename: 'ValueError', evalue: 'bad value' });
  assert.match(output.snapshot().text, /ValueError: bad value/);
});

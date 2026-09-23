import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyCodeText } from '../../src/codeCopy';

test('copy takes exact rendered code including whitespace, excluding adjacent button text', async () => {
  const code = { textContent: '  x = 1\nprint(x)\n' };
  const button = { textContent: 'Copy code' };
  let copied = '';
  await copyCodeText(code, async value => { copied = value; });
  assert.equal(copied, '  x = 1\nprint(x)\n');
  assert.ok(!copied.includes(button.textContent));
});

test('copy failure propagates so UI can report it', async () => {
  await assert.rejects(copyCodeText({ textContent: 'print(1)' }, async () => {
    throw new Error('Clipboard denied');
  }), /Clipboard denied/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commonRequestFields, readCommonOverride } from '../../src/commonInstructions';

test('common instructions distinguish inherited default from explicit empty override', () => {
  assert.equal(readCommonOverride(undefined), undefined);
  assert.equal(readCommonOverride(''), '');
  assert.equal(readCommonOverride('x'.repeat(8000)), 'x'.repeat(8000));
  for (const invalid of [null, 17, {}, 'x'.repeat(8001)]) {
    assert.equal(readCommonOverride(invalid), undefined);
  }
  assert.deepEqual(commonRequestFields(undefined), {});
  assert.deepEqual(commonRequestFields(''), { common_instructions: '' });
  assert.deepEqual(commonRequestFields('Shared'), { common_instructions: 'Shared' });
});

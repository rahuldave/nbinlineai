import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasOverride, resolveAI, snapshotDefaults, supportedEffort } from '../../src/defaults';

const user = { backend: 'openai_api' as const, models: { openai_api: 'user-openai', anthropic_api: 'user-claude' }, promptMode: 'compact' as const };
const availability = { openai_api: { configured: true }, anthropic_api: { configured: true } };

test('untouched cells inherit notebook then user defaults at run time', () => {
  assert.deepEqual(resolveAI({}, { backend: 'anthropic_api', model: 'notebook-claude', promptMode: 'learning' }, user, availability), {
    backend: 'anthropic_api', model: 'notebook-claude', promptMode: 'learning', reasoningEffort: ''
  });
  assert.deepEqual(resolveAI({}, {}, user, availability), { backend: 'openai_api', model: 'user-openai', promptMode: 'compact', reasoningEffort: '' });
});

test('legacy provider and model overrides stay explicit and do not borrow another provider model', () => {
  assert.deepEqual(resolveAI({ backend: 'openai_api', model: 'legacy-openai' }, { backend: 'anthropic_api', model: 'notebook-claude', promptMode: 'full' }, user, availability), {
    backend: 'openai_api', model: 'legacy-openai', promptMode: 'full', reasoningEffort: ''
  });
  assert.equal(resolveAI({ backend: 'openai_api' }, { backend: 'anthropic_api', model: 'notebook-claude' }, user, availability).model, 'user-openai');
  assert.equal(hasOverride({}), false);
  assert.equal(hasOverride({ model: 'legacy-openai' }), true);
});

test('inherited notebook effort falls back for a cell model that cannot use it', () => {
  const solNotebook = { backend: 'openai_api' as const, model: 'gpt-6-sol', reasoningEffort: 'none' };
  const astraCell = resolveAI({ model: 'gpt-6-astra' }, solNotebook, user, availability);
  assert.equal(astraCell.reasoningEffort, 'none');
  assert.equal(supportedEffort(astraCell.reasoningEffort, ['low', 'medium', 'high', 'xhigh', 'max']), '');
  const haikuCell = resolveAI({ model: 'claude-haiku-4-5' }, { backend: 'anthropic_api', model: 'claude-sonnet-5', reasoningEffort: 'high' }, user, availability);
  assert.equal(supportedEffort(haikuCell.reasoningEffort, []), '');
  assert.equal(solNotebook.reasoningEffort, 'none');
});

test('first AI use snapshots effective book defaults and preserves header choices', () => {
  const effective = resolveAI({}, { backend: 'anthropic_api', promptMode: 'learning' }, user, availability);
  assert.deepEqual(snapshotDefaults({ backend: 'anthropic_api', promptMode: 'learning' }, { ...effective, model: 'claude-sonnet-5' }), {
    backend: 'anthropic_api', model: 'claude-sonnet-5', promptMode: 'learning', reasoningEffort: 'default', keepAnswers: true
  });
  assert.equal(snapshotDefaults({}, { ...effective, model: 'claude-haiku-4-5' }).reasoningEffort, 'default');
  assert.equal(snapshotDefaults({ reasoningEffort: 'high' }, { ...effective, model: 'claude-sonnet-5' }).reasoningEffort, 'high');
  assert.equal(snapshotDefaults({ keepAnswers: false }, { ...effective, model: 'claude-sonnet-5' }).keepAnswers, false);
});

test('explicit Model default cancels an inherited notebook effort', () => {
  const notebook = { backend: 'openai_api' as const, model: 'gpt-6-sol', reasoningEffort: 'high' };
  assert.equal(resolveAI({}, notebook, user, availability).reasoningEffort, 'high');
  const cell = resolveAI({ reasoningEffort: 'default' }, notebook, user, availability);
  assert.equal(cell.reasoningEffort, 'default');
  assert.equal(supportedEffort(cell.reasoningEffort, ['low', 'medium', 'high']), '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellProvider, configured, defaultProvider } from '../../src/providerChoice';

const onlyAnthropic = { openai_api: { configured: false }, anthropic_api: { configured: true } };
const both = { openai_api: { configured: true }, anthropic_api: { configured: true } };
const neither = { openai_api: { configured: false }, anthropic_api: { configured: false } };

test('new cells use sole configured provider and settings preference when both work', () => {
  assert.equal(defaultProvider('openai_api', onlyAnthropic), 'anthropic_api');
  assert.equal(defaultProvider('openai_api', both), 'openai_api');
  assert.equal(defaultProvider('openai_api', null), 'openai_api');
  assert.equal(defaultProvider('openai_api', neither), 'openai_api');
});

test('saved provider remains explicit even when its key is missing', () => {
  assert.equal(cellProvider('openai_api', 'anthropic_api', onlyAnthropic), 'openai_api');
  assert.equal(cellProvider(undefined, 'openai_api', onlyAnthropic), 'anthropic_api');
  assert.equal(configured(onlyAnthropic, 'openai_api'), false);
  assert.equal(configured(null, 'openai_api'), null);
});

test('a prompt created before status loads follows the sole provider once status arrives', () => {
  const savedBackend = undefined;
  assert.equal(cellProvider(savedBackend, 'openai_api', null), 'openai_api');
  assert.equal(cellProvider(savedBackend, 'openai_api', onlyAnthropic), 'anthropic_api');
  assert.equal(cellProvider('openai_api', 'openai_api', onlyAnthropic), 'openai_api');
});

test('explicit custom model and first run pin Anthropic when OpenAI later becomes available', () => {
  const effectiveBefore = cellProvider(undefined, 'openai_api', onlyAnthropic);
  assert.equal(effectiveBefore, 'anthropic_api');
  const metadataAfterModelChoice = { backend: effectiveBefore, model: 'claude-custom-school' };
  assert.equal(cellProvider(metadataAfterModelChoice.backend, 'openai_api', both), 'anthropic_api');
  const metadataAfterFirstRun = { backend: effectiveBefore };
  assert.equal(cellProvider(metadataAfterFirstRun.backend, 'openai_api', both), 'anthropic_api');
});

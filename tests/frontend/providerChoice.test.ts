import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellProvider, configured, defaultProvider, hasSelectableProvider, isBackend, PROVIDERS, subscriptionConnectionErrorMessage, subscriptionSelectionIssue, unavailableMessage, visibleBackends } from '../../src/providerChoice';

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

test('ChatGPT subscription is explicit and never auto-selected as a billing fallback', () => {
  const subscription = 'openai_codex_subscription';
  const available = { ...neither, [subscription]: { configured: true } };
  assert.equal(defaultProvider('openai_api', available), 'openai_api');
  assert.equal(defaultProvider(subscription, neither), subscription);
  assert.equal(cellProvider(subscription, 'openai_api', neither), subscription);
  assert.equal(configured(neither, subscription), false);
  assert.equal(PROVIDERS[subscription].label, 'ChatGPT subscription');
  assert.equal(unavailableMessage(subscription, true), 'ChatGPT subscription unavailable. Your selection is kept.');
  assert.equal(unavailableMessage(subscription, false), 'ChatGPT subscription unavailable. Your selection is kept.');
});

test('subscription choice appears only when advertised or already saved', () => {
  assert.deepEqual(visibleBackends(neither), ['openai_api', 'anthropic_api']);
  assert.deepEqual(visibleBackends(neither, 'openai_codex_subscription'), ['openai_api', 'anthropic_api', 'openai_codex_subscription']);
  assert.deepEqual(visibleBackends({ ...neither, openai_codex_subscription: { configured: false } }),
    ['openai_api', 'anthropic_api']);
  assert.deepEqual(visibleBackends({ ...neither, openai_codex_subscription: { configured: true } }),
    ['openai_api', 'anthropic_api', 'openai_codex_subscription']);
  assert.equal(isBackend('openai_codex_subscription'), true);
  assert.equal(isBackend('other'), false);
});

test('cell provider selector accepts a capable ChatGPT-only connection', () => {
  const chatGptOnly = { ...neither, openai_codex_subscription: { configured: true } };
  assert.equal(hasSelectableProvider(chatGptOnly, true), true);
  assert.equal(hasSelectableProvider(chatGptOnly, false), false);
  assert.equal(hasSelectableProvider({ ...neither, openai_codex_subscription: { configured: false } }, true), false);
  assert.equal(hasSelectableProvider(onlyAnthropic, false), true);
});

test('unavailable ChatGPT model and effort cannot be silently replaced', () => {
  const status = {
    subscription_capable: true,
    providers: { openai_codex_subscription: { configured: true, default_model: 'gpt-6-sol', models: ['gpt-6-sol'] } },
    default_models: {},
    model_capabilities: { openai_codex_subscription: { 'gpt-6-sol': { efforts: ['medium'], default_effort: 'medium' } } }
  };
  assert.equal(subscriptionSelectionIssue(status, 'gpt-6-luna', ''),
    'Selected ChatGPT model is unavailable. Choose an available model.');
  assert.equal(subscriptionSelectionIssue(status, 'gpt-6-sol', 'high'),
    'Selected ChatGPT reasoning effort is unavailable for this model. Choose another effort.');
  assert.equal(subscriptionSelectionIssue(status, 'gpt-6-sol', 'medium'), null);
  assert.equal(subscriptionSelectionIssue(status, '', 'default'), null);
  assert.equal(subscriptionSelectionIssue({ ...status, subscription_capable: false }, 'gpt-6-luna', ''), null);
});

test('a refreshed ChatGPT connection state gives a safe run error', () => {
  const status = {
    providers: { openai_codex_subscription: { configured: false, default_model: null, models: [], state: 'expired' } },
    default_models: {}
  };
  assert.equal(subscriptionConnectionErrorMessage(status), 'ChatGPT sign-in expired. Open Configure AI to sign in again.');
  assert.match(subscriptionConnectionErrorMessage({ ...status, providers: {
    openai_codex_subscription: { ...status.providers.openai_codex_subscription, state: 'limited' }
  } }) || '', /usage limit reached/);
  assert.equal(subscriptionConnectionErrorMessage({ ...status, providers: {
    openai_codex_subscription: { ...status.providers.openai_codex_subscription, state: 'connected' }
  } }), null);
  assert.equal(subscriptionConnectionErrorMessage(null), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableModels, CUSTOM_MODEL, DEFAULT_MODEL, resolvedDefault, selectedModelChoice, serverUnavailableMessage, promptHttpErrorMessage } from '../../src/modelChoice';

test('model picker restores default, listed, and prior custom model IDs', () => {
  const models = availableModels(['gpt-6-sol', 'gpt-6-luna', 'gpt-6-sol']);
  assert.deepEqual(models, ['gpt-6-sol', 'gpt-6-luna']);
  assert.equal(selectedModelChoice('', models), DEFAULT_MODEL);
  assert.equal(selectedModelChoice('gpt-6-luna', models), 'gpt-6-luna');
  assert.equal(selectedModelChoice('my-private-model', models), CUSTOM_MODEL);
  assert.equal(selectedModelChoice('', availableModels(['claude-sonnet-5'])), DEFAULT_MODEL); // changing provider clears the override
  assert.equal(selectedModelChoice('my-private-model', availableModels(['claude-sonnet-5'])), CUSTOM_MODEL); // saved custom metadata survives reload
  assert.equal(resolvedDefault('teacher-model', 'gpt-6-sol'), 'teacher-model');
  assert.equal(resolvedDefault('', 'gpt-6-sol'), 'gpt-6-sol');
});

test('404 guidance names the whole server restart and Retry', () => {
  assert.match(serverUnavailableMessage('settings'), /restart the whole Jupyter server/);
  assert.match(serverUnavailableMessage('settings'), /Retry/);
  assert.match(serverUnavailableMessage('settings'), /If you just installed or updated/);
  assert.match(serverUnavailableMessage('prompt'), /run the prompt again/);
});

test('prompt HTTP errors never use raw HTML or server response bodies', () => {
  assert.match(promptHttpErrorMessage(404), /server endpoint is unavailable/);
  assert.match(promptHttpErrorMessage(400), /request was rejected/);
  assert.equal(promptHttpErrorMessage(500), 'The AI server returned an error (500). Try again or check the Jupyter server log.');
  assert.doesNotMatch(promptHttpErrorMessage(500), /<html>/);
});

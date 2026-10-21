import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { installBackgroundFixture, assertBackgroundFixture } from '../scripts/worked_background_fixture.mjs';

test('background media uses owned canvas and silent audio without native device access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worked-fixture-test-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const file = join(directory, 'index.html');
    await writeFile(file, '<!doctype html><title>Owned background fixture test</title>');
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.nativeDeviceCalls = 0;
      window.activeFixtureTimers = new Set();
      const nativeInterval = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window);
      window.setInterval = (...args) => { const id = nativeInterval(...args); window.activeFixtureTimers.add(id); return id; };
      window.clearInterval = id => { window.activeFixtureTimers.delete(id); nativeClear(id); };
      window.activeFixtureAudio = 0;
      const NativeAudio = window.AudioContext;
      window.AudioContext = class extends NativeAudio {
        constructor(...args) { super(...args); window.activeFixtureAudio++; }
        close() { window.activeFixtureAudio--; return super.close(); }
      };
      const forbidden = async () => { window.nativeDeviceCalls++; throw new Error('native device request'); };
      navigator.mediaDevices.getUserMedia = forbidden;
      navigator.mediaDevices.getDisplayMedia = forbidden;
      navigator.mediaDevices.enumerateDevices = forbidden;
      if (navigator.clipboard) for (const name of ['read', 'readText', 'write', 'writeText']) {
        navigator.clipboard[name] = forbidden;
      }
    });
    await installBackgroundFixture(context);
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href);
    await assertBackgroundFixture(page);
    const observed = await page.evaluate(async () => {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const camera = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      const clipboardBlocked = [];
      if (navigator.clipboard) for (const name of ['read', 'readText', 'write', 'writeText']) {
        try { await navigator.clipboard[name](); clipboardBlocked.push(false); }
        catch (error) { clipboardBlocked.push(error.name === 'NotAllowedError'); }
      }
      const result = { clipboardBlocked, nativeCalls: window.nativeDeviceCalls, devices: await navigator.mediaDevices.enumerateDevices(),
        size: [display.getVideoTracks()[0].getSettings().width, display.getVideoTracks()[0].getSettings().height],
        cameraVideo: camera.getVideoTracks().length, cameraAudio: camera.getAudioTracks().length,
        microphoneAudio: microphone.getAudioTracks().length };
      for (const stream of [display, camera, microphone]) for (const track of stream.getTracks()) track.stop();
      result.remainingTimers = window.activeFixtureTimers.size;
      result.remainingAudio = window.activeFixtureAudio;
      return result;
    });
    assert.deepEqual(observed, { clipboardBlocked: [true, true, true, true], nativeCalls: 0, devices: [], size: [1000, 600], cameraVideo: 1, cameraAudio: 1, microphoneAudio: 1, remainingTimers: 0, remainingAudio: 0 });
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});


test('a browser-side installation failure blocks notebook execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worked-fixture-failure-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const file = join(directory, 'index.html');
    await writeFile(file, '<!doctype html><title>Owned fixture failure test</title>');
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, 'read', {
        value: async () => { throw new Error('native sentinel must never be called'); },
        configurable: false, writable: false,
      });
    });
    await installBackgroundFixture(context);
    const page = await context.newPage();
    // A failing init script alone does not cause navigation to reject.
    await page.goto(pathToFileURL(file).href);
    await assert.rejects(() => assertBackgroundFixture(page), /refusing notebook execution/);
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});


for (const method of ['getUserMedia', 'getDisplayMedia', 'enumerateDevices']) {
  test(`a locked native ${method} blocks notebook execution`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'worked-media-failure-'));
    const browser = await chromium.launch({ headless: true });
    try {
      const file = join(directory, 'index.html');
      await writeFile(file, '<!doctype html><title>Owned media guard test</title>');
      const context = await browser.newContext();
      await context.addInitScript(name => {
        Object.defineProperty(navigator.mediaDevices, name, {
          value: async () => { throw new Error('native sentinel must never be called'); },
          configurable: false, writable: false,
        });
      }, method);
      await installBackgroundFixture(context);
      const page = await context.newPage();
      await page.goto(pathToFileURL(file).href);
      await assert.rejects(() => assertBackgroundFixture(page), /refusing notebook execution/);
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

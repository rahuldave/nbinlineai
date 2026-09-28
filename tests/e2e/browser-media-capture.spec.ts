import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

async function fixtureNotebook(page: Page, request: APIRequestContext, sources: string[]): Promise<void> {
  const name = `capture-${Date.now()}-${Math.floor(Math.random() * 100000)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const created = await request.put(`/api/contents/${name}`, { headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: { cells: sources.map((source, index) => ({
      id: `capture-${index}`, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null
    })), metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
    nbformat: 4, nbformat_minor: 5 } } });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(sources.length);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  if (await select.isVisible().catch(() => false)) await select.click();
  const no = page.getByRole('button', { name: 'No', exact: true });
  if (await no.isVisible().catch(() => false)) await no.click();
  await expect(page.getByRole('button', { name: /Python.*\| Idle$/ })).toBeVisible({ timeout: 30_000 });
}

async function runCell(page: Page, index: number): Promise<string> {
  const cell = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').nth(index);
  const before = await cell.locator('.jp-InputPrompt').textContent();
  await cell.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => {
    const prompt = await cell.locator('.jp-InputPrompt').textContent();
    return prompt !== before && /\[[0-9]+\]:/.test(prompt ?? '');
  }).toBeTruthy();
  return await cell.locator('.jp-OutputArea').textContent() ?? '';
}

async function inspectLater(page: Page, index: number, wanted: string): Promise<string> {
  let last = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    const output = await runCell(page, index);
    last = output;
    if (output.includes(wanted)) return output;
    await page.waitForTimeout(250);
  }
  throw new Error(`Receipt did not reach ${wanted} on a later kernel turn: ${last}`);
}

async function syntheticDevices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let frame: MediaStream | undefined;
    let audio: AudioContext | undefined;
    const displayRequests: boolean[] = [];
    Object.defineProperty(window, '__nbinlineaiCaptureDisplayRequests', { value: displayRequests });
    const video = (): MediaStream => {
      if (frame && frame.getVideoTracks().some(track => track.readyState === 'live')) return frame.clone();
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 48;
      const draw = (): void => {
        const graphics = canvas.getContext('2d');
        if (!graphics) return;
        graphics.fillStyle = '#336699'; graphics.fillRect(0, 0, 64, 48);
      };
      draw();
      window.setInterval(draw, 100);
      frame = canvas.captureStream(10);
      return frame.clone();
    };
    const microphone = (): MediaStream => {
      audio ??= new AudioContext();
      const oscillator = audio.createOscillator();
      oscillator.frequency.value = 440;
      const output = audio.createMediaStreamDestination();
      oscillator.connect(output);
      oscillator.start();
      void audio.resume();
      return output.stream;
    };
    const media = {
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'synthetic-camera', label: 'Deterministic camera' },
        { kind: 'audioinput', deviceId: 'synthetic-mic', label: 'Deterministic microphone' }
      ],
      getUserMedia: async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
        if (constraints.audio) {
          const sound = microphone();
          return new MediaStream([...video().getVideoTracks(), ...sound.getAudioTracks()]);
        }
        // Include an unsolicited audio track to prove video-only calls discard it.
        return new MediaStream([...video().getVideoTracks(), ...microphone().getAudioTracks()]);
      },
      getDisplayMedia: async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
        displayRequests.push(Boolean(constraints.audio));
        return constraints.audio ? video() :
          new MediaStream([...video().getVideoTracks(), ...microphone().getAudioTracks()]);
      }
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
  });
}

test('deterministic camera still and shared recorder deliver typed Python results', async ({ page, request }) => {
  await syntheticDevices(page);
  await fixtureNotebook(page, request, [
    'from nbinlineai.tools import list_media_sources, start_camera, capture_camera, start_recording, stop_recording, stop_source\ndevices = list_media_sources()\ncamera = start_camera(audio=False)',
    "print('CAMERA_READY' if camera.status == 'completed' and camera.result else camera.status, devices.result, camera.result, devices.error, camera.error)",
    "camera_id = camera.result['source_id']\nstill = capture_camera(camera_id, save_to=None)",
    "print(still.status, type(still.result).__name__, still.result.size if still.result else None)",
    "recording = start_recording(camera_id, save_to=None, duration=5)",
    "print('RECORDING_READY' if recording.status == 'running' and recording.operation_id else recording.status, recording.operation_id)",
    "stopped = stop_recording(recording.operation_id)",
    "print(stopped.status, recording.status, type(recording.result).__name__, recording.media)",
    'second_stop = stop_recording(recording.operation_id)',
    'print(second_stop.status, second_stop.result)',
    'closed = stop_source(camera_id)',
    'from nbinlineai.tools import record_camera\nconvenience = record_camera(save_to=None, duration=2, audio=False)',
    'print(convenience.status, type(convenience.result).__name__, convenience.media)'
  ]);
  await runCell(page, 0);
  const ready = await inspectLater(page, 1, 'CAMERA_READY');
  expect(ready).toContain('synthetic-camera');
  expect(ready).toContain("'audio': False");
  await runCell(page, 2);
  expect(await inspectLater(page, 3, 'PngImageFile (64, 48)')).toContain('completed');
  await runCell(page, 4);
  expect(await inspectLater(page, 5, 'RECORDING_READY')).toContain('RECORDING_READY');
  await page.waitForTimeout(500); // Produce an encoded timeslice before an explicit Stop.
  await runCell(page, 6);
  const stopped = await inspectLater(page, 7, 'MediaClip');
  expect(stopped).toContain('completed');
  expect(stopped).toContain('stop_reason');
  await runCell(page, 8);
  expect(await inspectLater(page, 9, 'already_stopped')).toContain('completed');
  await runCell(page, 10);
  await expect(page.locator('.nbinlineai-capture-source')).toHaveCount(0);
  await runCell(page, 11);
  expect(await inspectLater(page, 12, 'MediaClip')).toContain('completed');
  await expect(page.locator('.nbinlineai-capture-source')).toHaveCount(0);
});

test('requested display audio needs a second explicit silent-share click', async ({ page, request }) => {
  await syntheticDevices(page);
  await fixtureNotebook(page, request, [
    'from nbinlineai.tools import start_share, stop_share\nsharing = start_share(audio=True)',
    'print(sharing.status, sharing.result)',
    "closed = stop_share(sharing.result['source_id'])"
  ]);
  await runCell(page, 0);
  await expect(page.locator('.nbinlineai-capture-message')).toContainText('Click Share screen to open');
  expect(await page.locator('.nbinlineai-capture-panel button').first().evaluate(button => {
    const box = button.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button;
  })).toBe(true);
  await page.locator('.nbinlineai-capture-panel button').filter({ hasText: 'Share screen' }).click();
  await expect(page.locator('.nbinlineai-capture-message')).toContainText('Screen audio was unavailable');
  await expect(page.locator('.nbinlineai-capture-panel button').filter({ hasText: 'Share without audio' })).toBeVisible();
  await page.locator('.nbinlineai-capture-panel button').filter({ hasText: 'Share without audio' }).click();
  const share = await inspectLater(page, 1, 'source_id');
  expect(share).toContain('completed');
  expect(share).toContain("'audio': False");
  expect(await page.evaluate(() =>
    (window as unknown as { __nbinlineaiCaptureDisplayRequests: boolean[] }).__nbinlineaiCaptureDisplayRequests
  )).toEqual([true, false]);
  await runCell(page, 2);
});

test('deterministic microphone levels and convenience audio recording stay local', async ({ page, request }) => {
  await syntheticDevices(page);
  await fixtureNotebook(page, request, [
    'from nbinlineai.tools import start_microphone, read_audio_levels, record_microphone, stop_source\nmicrophone = start_microphone()',
    "print('MIC_READY' if microphone.status == 'completed' and microphone.result else microphone.status, microphone.result, microphone.error)",
    "microphone_id = microphone.result['source_id']\nlevels = read_audio_levels(microphone_id, window_ms=100)",
    'print(levels.status, levels.result)',
    'clip = record_microphone(save_to=None, duration=2)',
    'print(clip.status, type(clip.result).__name__, clip.media)',
    'closed = stop_source(microphone_id)'
  ]);
  await runCell(page, 0);
  const microphone = await inspectLater(page, 1, 'MIC_READY');
  expect(microphone).toContain('source_id');
  expect(microphone).toContain("'video': False");
  await runCell(page, 2);
  expect(await inspectLater(page, 3, 'rms')).toContain('completed');
  await runCell(page, 4);
  const clip = await inspectLater(page, 5, 'MediaClip');
  expect(clip).toContain('audio/');
  expect(clip).toContain('stop_reason');
  await expect(page.locator('.nbinlineai-capture-source')).toHaveCount(1);
  await runCell(page, 6);
  await expect(page.locator('.nbinlineai-capture-source')).toHaveCount(0);
});

test('screen chooser is activated by the visible Share button and stop is idempotent', async ({ page, request }) => {
  await syntheticDevices(page);
  await fixtureNotebook(page, request, [
    'from nbinlineai.tools import setup_share, start_share, capture_screen, stop_share\ncontrols = setup_share()\nsharing = start_share(audio=False)',
    'print(controls.status, sharing.status, sharing.result)',
    "screen_id = sharing.result['source_id']\nscreen = capture_screen(source_id=screen_id, save_to=None)",
    'print(screen.status, type(screen.result).__name__)',
    'from nbinlineai.tools import capture_tool\nalias_frame = capture_tool(source_id=screen_id, save_to=None)',
    'print(alias_frame.status, type(alias_frame.result).__name__)',
    'first = stop_share(screen_id)',
    'print(first.status, first.result)',
    'second = stop_share()',
    'print(second.status, second.result)'
  ]);
  await runCell(page, 0);
  await expect(page.locator('.nbinlineai-capture-message')).toContainText('Click Share screen to open');
  await expect(page.locator('.nbinlineai-capture-panel button').filter({ hasText: 'Share screen' })).toBeVisible();
  await page.locator('.nbinlineai-capture-panel button').filter({ hasText: 'Share screen' }).click();
  expect(await inspectLater(page, 1, 'source_id')).toContain('completed');
  await runCell(page, 2);
  expect(await inspectLater(page, 3, 'PngImageFile')).toContain('completed');
  await runCell(page, 4);
  expect(await inspectLater(page, 5, 'PngImageFile')).toContain('completed');
  await runCell(page, 6);
  expect(await inspectLater(page, 7, 'completed')).toContain('stopped');
  await runCell(page, 8);
  expect(await inspectLater(page, 9, 'already_stopped')).toContain('completed');
});

test('model capture_tool reply states that no image pixels were attached', async ({ page, request }) => {
  await syntheticDevices(page);
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  const key = await request.post('/nbinlineai/settings/keys', {
    headers, data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(key.ok(), await key.text()).toBeTruthy();
  const name = `capture-model-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, { headers,
    data: { type: 'notebook', format: 'json', content: { cells: [
      { id: 'share', cell_type: 'code', source: 'from nbinlineai.tools import start_share, capture_tool\nsharing = start_share()',
        metadata: {}, outputs: [], execution_count: null },
      { id: 'ask', cell_type: 'markdown', source: 'E2E_CAPTURE_TOOL_DESCRIPTOR &`capture_tool`',
        metadata: { nbinlineai: { isPromptCell: true } } }
    ], metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
    nbformat: 4, nbformat_minor: 5 } } });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  if (await select.isVisible().catch(() => false)) await select.click();
  const no = page.getByRole('button', { name: 'No', exact: true });
  if (await no.isVisible().catch(() => false)) await no.click();
  await expect(page.getByRole('button', { name: /Python.*\| Idle$/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.nbinlineai-prompt-cell')).toHaveCount(1);
  await runCell(page, 0);
  await expect(page.locator('.nbinlineai-capture-message')).toContainText('Click Share screen to open');
  await page.locator('.nbinlineai-capture-panel button').filter({ hasText: 'Share screen' }).click();
  await expect(page.locator('.nbinlineai-media-status')).toContainText('Media completed');
  const action = page.waitForRequest(item => item.url().endsWith('/nbinlineai/action-reply') && item.method() === 'POST');
  await page.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  const reply = JSON.parse((await action).postData() || '{}') as { ok: boolean; text: string };
  expect(reply.ok).toBe(true);
  expect(reply.text.length).toBeLessThan(3800);
  const descriptor = JSON.parse(reply.text) as { operation_id: string; model_pixels_attached: boolean; note: string };
  expect(descriptor.operation_id).toBeTruthy();
  expect(descriptor.model_pixels_attached).toBe(false);
  expect(descriptor.note).toContain('no image pixels');
  expect(reply.text).not.toContain('data:image');
  await expect(page.locator('.nbinlineai-response-cell')).toContainText('CAPTURE_TOOL_DESCRIPTOR');
});

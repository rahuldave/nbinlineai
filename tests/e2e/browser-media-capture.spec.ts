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
  for (let attempt = 0; attempt < 12; attempt++) {
    const output = await runCell(page, index);
    if (output.includes(wanted)) return output;
    await page.waitForTimeout(250);
  }
  throw new Error(`Receipt did not reach ${wanted} on a later kernel turn`);
}

async function syntheticDevices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let frame: MediaStream | undefined;
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
    const media = {
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'synthetic-camera', label: 'Deterministic camera' },
        { kind: 'audioinput', deviceId: 'synthetic-mic', label: 'Deterministic microphone' }
      ],
      getUserMedia: async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
        if (constraints.audio) throw new DOMException('Synthetic microphone unavailable', 'NotFoundError');
        return video();
      },
      getDisplayMedia: async (): Promise<MediaStream> => video()
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
  });
}

test('deterministic camera still and shared recorder deliver typed Python results', async ({ page, request }) => {
  await syntheticDevices(page);
  await fixtureNotebook(page, request, [
    'from nbinlineai.tools import list_media_sources, start_camera, capture_camera, start_recording, stop_recording, stop_source\ndevices = list_media_sources()\ncamera = start_camera(audio=False)',
    "print('CAMERA_READY' if camera.status == 'completed' and camera.result else camera.status, devices.result, camera.result)",
    "camera_id = camera.result['source_id']\nstill = capture_camera(camera_id, save_to=None)",
    "print(still.status, type(still.result).__name__, still.result.size if still.result else None)",
    "recording = start_recording(camera_id, save_to=None, duration=5)",
    "print('RECORDING_READY' if recording.status == 'running' and recording.operation_id else recording.status, recording.operation_id)",
    "stopped = stop_recording(recording.operation_id)",
    "print(stopped.status, recording.status, type(recording.result).__name__, recording.media)",
    'closed = stop_source(camera_id)'
  ]);
  await runCell(page, 0);
  const ready = await inspectLater(page, 1, 'CAMERA_READY');
  expect(ready).toContain('synthetic-camera');
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
});

test('screen chooser is activated by the visible Share button and stop is idempotent', async ({ page, request }) => {
  await syntheticDevices(page);
  await fixtureNotebook(page, request, [
    'from nbinlineai.tools import setup_share, start_share, capture_screen, stop_share\ncontrols = setup_share()\nsharing = start_share(audio=False)',
    'print(controls.status, sharing.status, sharing.result)',
    "screen_id = sharing.result['source_id']\nscreen = capture_screen(source_id=screen_id, save_to=None)",
    'print(screen.status, type(screen.result).__name__)',
    'first = stop_share(screen_id)\nsecond = stop_share(screen_id)',
    'print(first.status, second.status, second.result)'
  ]);
  await runCell(page, 0);
  await expect(page.locator('.nbinlineai-capture-message')).toContainText('Click Share screen to open');
  await expect(page.locator('.nbinlineai-capture-panel button').filter({ hasText: 'Share screen' })).toBeVisible();
  await page.locator('.nbinlineai-capture-panel button').filter({ hasText: 'Share screen' }).click();
  expect(await inspectLater(page, 1, 'source_id')).toContain('completed');
  await runCell(page, 2);
  expect(await inspectLater(page, 3, 'PngImageFile')).toContain('completed');
  await runCell(page, 4);
  expect(await inspectLater(page, 5, 'already_stopped')).toContain('completed');
});

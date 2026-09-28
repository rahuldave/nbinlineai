import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '../support/e2e-fixtures';

const samplePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==', 'base64');

test('the public notebook imports, plays, controls, copies and pastes disposable media', async ({ page, request, browserName }) => {
  const example = JSON.parse(await readFile(join(process.cwd(), 'examples/browser-media-playback.ipynb'), 'utf8'));
  const ids = example.cells.filter((cell: { cell_type: string }) => cell.cell_type === 'code')
    .map((cell: { id: string }) => cell.id);
  expect(ids).toEqual([
    'playback-setup', 'playback-choose-call', 'playback-choose-inspect',
    'playback-open-call', 'playback-open-inspect', 'playback-play-call', 'playback-play-inspect',
    'playback-pause-call', 'playback-pause-inspect', 'playback-seek-call', 'playback-seek-inspect',
    'playback-volume-call', 'playback-volume-inspect', 'playback-close-call', 'playback-close-inspect',
    'playback-copy-call', 'playback-copy-inspect', 'playback-paste-call', 'playback-paste-inspect',
    'playback-cleanup'
  ]);
  const name = `playback-example-${Date.now()}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! }, data: { type: 'notebook', format: 'json', content: example }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  const code = notebook.locator('.jp-CodeCell');
  await expect(code).toHaveCount(ids.length);
  await expect.poll(async () => (await (await request.get('/api/sessions')).json() as Array<{ path: string }>).some(
    session => session.path === name)).toBeTruthy();
  async function run(index: number): Promise<void> {
    const prompt = code.nth(index).locator('.jp-InputPrompt');
    const before = await prompt.textContent();
    await code.nth(index).locator('.cm-content').click();
    await page.keyboard.press('Shift+Enter');
    await expect.poll(() => prompt.textContent()).not.toBe(before);
    await expect(prompt).not.toContainText('*');
  }
  async function inspect(index: number, expected: string): Promise<void> {
    let output = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      await run(index);
      output = await code.nth(index).locator('.jp-OutputArea').textContent() ?? '';
      if (output.includes(expected)) return;
      await page.waitForTimeout(250);
    }
    expect(output).toContain(expected);
  }

  await run(0); // Generate exact local PNG and two-second WAV.
  const chooser = page.waitForEvent('filechooser');
  await run(1);
  await page.getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles({ name: 'playback-sample.png', mimeType: 'image/png', buffer: samplePng });
  await expect(page.locator('.nbinlineai-media-status')).toContainText('Media completed');
  await inspect(2, 'completed');
  await expect(code.nth(2).locator('.jp-OutputArea')).not.toContainText('media/'); // No implicit save.

  if (browserName !== 'firefox') {
    await run(3); // Exact saved WAV reference. Pinned headless Firefox stalls before playable data.
    await expect(page.locator('.nbinlineai-playback-panel audio')).toBeVisible();
    await inspect(4, 'preview_id');
    await run(5);
    const playButton = page.getByRole('button', { name: 'Play', exact: true });
    if (await playButton.isVisible().catch(() => false)) await playButton.click();
    await inspect(6, 'completed');
    await run(7); await inspect(8, 'completed');
    await run(9); await inspect(10, '0.5');
    await run(11); await inspect(12, '0.25');
    await run(13); await inspect(14, 'True'); // Closing kept the source WAV.
    await expect(page.locator('.nbinlineai-playback-panel audio')).toHaveCount(0);
  }

  await run(15);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  const manual = page.getByRole('textbox', { name: 'Text to copy' });
  if (await manual.isVisible().catch(() => false)) {
    // The manual fallback can disappear as an asynchronous clipboard write succeeds.
    await manual.click({ timeout: 2000 }).catch(() => {});
    if (await manual.isVisible().catch(() => false)) {
      await manual.press('ControlOrMeta+A'); await manual.press('ControlOrMeta+C');
    }
  }
  await inspect(16, 'completed');
  await run(17);
  const paste = page.getByRole('textbox', { name: 'Paste here' });
  await paste.click(); await paste.press('ControlOrMeta+V');
  await inspect(18, 'nbinlineai disposable playback sample');
  await run(19);
  await expect(code.nth(19).locator('.jp-OutputArea')).toContainText('Disposable playback samples removed');
});

test('the visible file chooser reports cancellation and oversized selection explicitly', async ({ page, request }) => {
  const name = `playback-chooser-${Date.now()}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const sources = [
    'from nbinlineai.tools import choose_file\ncancelled = choose_file()',
    'print(cancelled.status, cancelled.error)',
    'oversized = choose_file(accept="image/png")',
    'print(oversized.status, oversized.error)'
  ];
  const notebook = { cells: sources.map((source, index) => ({
    id: `chooser-${index}`, cell_type: 'code', source,
    metadata: {}, outputs: [], execution_count: null
  })), metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
  nbformat: 4, nbformat_minor: 5 };
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! }, data: { type: 'notebook', format: 'json', content: notebook }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const code = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell');
  await expect(code).toHaveCount(4);
  const selectKernel = page.getByRole('button', { name: 'Select', exact: true });
  if (await selectKernel.isVisible().catch(() => false)) await selectKernel.click();
  const newsNo = page.getByRole('button', { name: 'No', exact: true });
  if (await newsNo.isVisible().catch(() => false)) await newsNo.click();
  await expect.poll(async () => (await (await request.get('/api/sessions')).json() as Array<{
    path: string; kernel?: { id?: string }
  }>).some(session => session.path === name && !!session.kernel?.id)).toBeTruthy();
  async function inspect(index: number, expected: string): Promise<void> {
    let output = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const cell = code.nth(index);
      const prompt = cell.locator('.jp-InputPrompt');
      const before = await prompt.textContent();
      await cell.locator('.cm-content').click(); await page.keyboard.press('Control+Enter');
      await expect.poll(() => prompt.textContent()).not.toBe(before);
      await expect(prompt).not.toContainText('*');
      output = await cell.locator('.jp-OutputArea').textContent() ?? '';
      if (output.includes(expected)) return;
      await page.waitForTimeout(250);
    }
    expect(output).toContain(expected);
  }
  await code.nth(0).locator('.cm-content').click(); await page.keyboard.press('Shift+Enter');
  await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.nbinlineai-media-status')).toContainText('Media cancelled');
  await inspect(1, 'cancelled');
  await code.nth(2).locator('.cm-content').click(); await page.keyboard.press('Shift+Enter');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose file' }).click();
  const folder = await mkdtemp(join(tmpdir(), 'nbinlineai-playback-limit-'));
  try {
    const file = join(folder, 'too-large.png');
    const handle = await open(file, 'w');
    try { await handle.truncate(50 * 1024 * 1024 + 1); }
    finally { await handle.close(); }
    await (await chooser).setFiles(file);
  } finally { await rm(folder, { recursive: true, force: true }); }
  await expect(page.locator('.nbinlineai-media-status')).toContainText('Media failed');
  await inspect(3, 'limit_exceeded');
});

test('an imported PNG opens and closes with an exact owned memory reference', async ({ page, request }) => {
  const name = `playback-image-${Date.now()}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const sources = [
    'from nbinlineai.tools import choose_file\nselected = choose_file(accept="image/png")',
    'print(selected.status, selected.media, selected.error)',
    'from nbinlineai.tools import open_media\nopened = open_media(selected.media)',
    'print(opened.status, opened.result, opened.error)',
    'from nbinlineai.tools import close_media\nclosed = close_media(opened.result["preview_id"])',
    'print(closed.status, closed.result, closed.error)'
  ];
  const example = { cells: sources.map((source, index) => ({
    id: `image-${index}`, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null
  })), metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
  nbformat: 4, nbformat_minor: 5 };
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! }, data: { type: 'notebook', format: 'json', content: example }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const code = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell');
  await expect(code).toHaveCount(sources.length);
  const selectKernel = page.getByRole('button', { name: 'Select', exact: true });
  if (await selectKernel.isVisible().catch(() => false)) await selectKernel.click();
  const newsNo = page.getByRole('button', { name: 'No', exact: true });
  if (await newsNo.isVisible().catch(() => false)) await newsNo.click();
  await expect.poll(async () => (await (await request.get('/api/sessions')).json() as Array<{
    path: string; kernel?: { id?: string }
  }>).some(session => session.path === name && !!session.kernel?.id)).toBeTruthy();
  async function run(index: number, expected?: string): Promise<void> {
    let output = '';
    for (let attempt = 0; attempt < (expected ? 10 : 1); attempt++) {
      const cell = code.nth(index);
      const prompt = cell.locator('.jp-InputPrompt');
      const before = await prompt.textContent();
      await cell.locator('.cm-content').click(); await page.keyboard.press('Control+Enter');
      await expect.poll(() => prompt.textContent()).not.toBe(before);
      await expect(prompt).not.toContainText('*');
      if (!expected) return;
      output = await cell.locator('.jp-OutputArea').textContent() ?? '';
      if (output.includes(expected)) return;
      await page.waitForTimeout(250);
    }
    expect(output).toContain(expected);
  }
  await run(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles({ name: 'safe-sample.png', mimeType: 'image/png', buffer: samplePng });
  await run(1, 'completed');
  await run(2);
  await expect(page.locator('.nbinlineai-playback-panel canvas')).toBeVisible();
  await run(3, 'preview_id');
  await run(4);
  await run(5, 'closed');
  await expect(page.locator('.nbinlineai-playback-panel canvas')).toHaveCount(0);
});

test('play stays bound to its notebook and late activation cannot revive a cancelled request', async ({ page, request }) => {
  const publicNotebook = JSON.parse(await readFile(join(process.cwd(), 'examples/browser-media-playback.ipynb'), 'utf8'));
  const setup = publicNotebook.cells.find((cell: { id: string }) => cell.id === 'playback-setup').source;
  const cell = (id: string, source: string | string[]) => ({
    id, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null
  });
  const first = `playback-owner-${Date.now()}.ipynb`;
  const second = `playback-other-${Date.now()}.ipynb`;
  const notebook = (cells: ReturnType<typeof cell>[]) => ({ cells,
    metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
    nbformat: 4, nbformat_minor: 5 });
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  for (const [name, content] of [
    [first, notebook([cell('setup', setup),
      cell('open', 'from nbinlineai.tools import open_media, play_media, cancel_operation, close_media\nopened = open_media(tone_ref)'),
      cell('open-inspect', 'print(opened.status, opened.result, opened.error)'),
      cell('play', "playing = play_media(opened.result['preview_id'])"),
      cell('cancel', 'cancelled = cancel_operation(playing.operation_id)'),
      cell('cancel-inspect', 'print(playing.status, cancelled.status, playing.error)'),
      cell('again', "again = play_media(opened.result['preview_id'])"),
      cell('again-inspect', 'print(again.status, again.result, again.error)'),
      cell('close', "closed = close_media(opened.result['preview_id'])\ntone_path.unlink(missing_ok=True)\nimage_path.unlink(missing_ok=True)"),
    ])],
    [second, notebook([cell('other', 'OTHER_NOTEBOOK = True')])]
  ] as const) {
    const uploaded = await request.put(`/api/contents/${name}`, {
      headers: { 'X-XSRFToken': xsrf! }, data: { type: 'notebook', format: 'json', content }
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  }
  await page.goto(`/lab/workspaces/${first.slice(0, -6)}/tree/${first}`);
  const active = page.locator('.jp-NotebookPanel:visible');
  const code = active.locator('.jp-CodeCell');
  await expect(code).toHaveCount(9);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await select.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await select.isVisible().catch(() => false)) await select.click();
  const no = page.getByRole('button', { name: 'No', exact: true });
  if (await no.isVisible().catch(() => false)) await no.click();
  await expect.poll(async () => (await (await request.get('/api/sessions')).json() as Array<{
    path: string; kernel?: { id?: string }
  }>).some(session => session.path === first && !!session.kernel?.id)).toBeTruthy();
  async function run(index: number): Promise<string> {
    const prompt = code.nth(index).locator('.jp-InputPrompt');
    const before = await prompt.textContent();
    await code.nth(index).locator('.cm-content').click(); await page.keyboard.press('Control+Enter');
    await expect.poll(() => prompt.textContent()).not.toBe(before);
    await expect(prompt).not.toContainText('*');
    return await code.nth(index).locator('.jp-OutputArea').textContent() ?? '';
  }
  async function inspect(index: number, text: string): Promise<string> {
    let output = '';
    for (let attempt = 0; attempt < 15; attempt++) {
      output = await run(index);
      if (output.includes(text)) return output;
      await page.waitForTimeout(250);
    }
    expect(output).toContain(text); return output;
  }
  await run(0); await run(1); await inspect(2, 'preview_id');
  await expect(active.locator('.nbinlineai-playback-host audio')).toBeVisible();
  expect(await active.locator('.nbinlineai-playback-host').evaluate(host =>
    host.closest('.jp-NotebookPanel')?.classList.contains('jp-NotebookPanel'))).toBeTruthy();
  await page.evaluate(() => {
    const native = HTMLMediaElement.prototype.play;
    (window as any).__restorePlay = () => { HTMLMediaElement.prototype.play = native; };
    HTMLMediaElement.prototype.play = function () {
      return new Promise<void>(resolve => { (window as any).__resolvePlay = resolve; });
    };
  });
  await run(3); await run(4); await inspect(5, 'cancelled');
  await page.evaluate(() => (window as any).__resolvePlay());
  await expect.poll(async () => active.locator('audio').evaluate(audio => (audio as HTMLAudioElement).paused)).toBeTruthy();
  await page.evaluate(() => {
    let calls = 0;
    (window as any).__playCalls = () => calls;
    HTMLMediaElement.prototype.play = function () {
      calls++;
      if (calls === 1) return Promise.reject(new DOMException('Click Play', 'NotAllowedError'));
      return new Promise<void>(resolve => { (window as any).__resolvePlay = resolve; });
    };
  });
  await run(6);
  const play = active.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeVisible();
  await play.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  expect(await page.evaluate(() => (window as any).__playCalls())).toBe(2);
  await page.evaluate(() => (window as any).__resolvePlay());
  await inspect(7, 'completed');
  await page.locator('.jp-FileBrowser .jp-DirListing-itemText').filter({ hasText: second }).dblclick();
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook')).toContainText('OTHER_NOTEBOOK = True');
  await expect(page.locator('.jp-NotebookPanel:visible .nbinlineai-playback-host')).toHaveCount(0);
  await page.getByRole('tab', { name: first, exact: true }).click();
  await expect(page.locator('.jp-NotebookPanel:visible .nbinlineai-playback-host audio')).toBeVisible();
  await run(8);
  await page.evaluate(() => (window as any).__restorePlay());
});

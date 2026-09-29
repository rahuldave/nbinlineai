import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

type Cell = { id: string; cell_type: 'code'; source: string; metadata: Record<string, unknown>;
  outputs: []; execution_count: null };
const code = (id: string, source: string): Cell => ({ id, cell_type: 'code', source,
  metadata: {}, outputs: [], execution_count: null });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==';

async function notebook(page: Page, request: APIRequestContext, cells: Cell[]): Promise<void> {
  const name = `phase-b-${Date.now()}-${Math.floor(Math.random() * 100000)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const uploaded = await request.put(`/api/contents/${name}`, { headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: { cells,
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5 } } });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(cells.length);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await select.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await select.isVisible().catch(() => false)) await select.click();
  const no = page.getByRole('button', { name: 'No', exact: true });
  if (await no.isVisible().catch(() => false)) await no.click();
  await expect.poll(async () => (await (await request.get('/api/sessions')).json() as Array<{
    path: string; kernel?: { id?: string }
  }>).some(session => session.path === name && !!session.kernel?.id)).toBeTruthy();
}

async function run(page: Page, index: number): Promise<string> {
  const cell = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').nth(index);
  const prompt = cell.locator('.jp-InputPrompt');
  const before = await prompt.textContent();
  await cell.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => {
    const current = await prompt.textContent();
    return current !== before && /\[\d+\]/.test(current ?? '');
  }).toBe(true);
  await expect(prompt).not.toContainText('*');
  return await cell.locator('.jp-OutputArea').textContent() ?? '';
}

async function inspect(page: Page, index: number, wanted: string): Promise<string> {
  let text = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    text = await run(page, index);
    if (text.includes(wanted)) return text;
    await page.waitForTimeout(250);
  }
  throw new Error(`Receipt did not reach ${wanted}: ${text}`);
}

test('live output export can be previewed, cropped and saved without retargeting a stale output',
  async ({ page, request }) => {
    test.setTimeout(120_000);
    await notebook(page, request, [
      code('raster', `from IPython.display import display, Image\nimport base64\ndisplay(Image(data=base64.b64decode('${png}')))`),
      code('discover', "from nbinlineai.tools import list_outputs, export_output, open_media, crop_image, save_media, close_media, release_media\nlisting=list_outputs('raster')"),
      code('discover-check', 'print(listing.status, listing.result, listing.error)'),
      code('export', "ref=listing.result['outputs'][0]\nexported=export_output(ref['cell_id'],ref['output_id'],ref['revision'])"),
      code('export-check', 'print(exported.status, exported.media, getattr(exported.result, "size", None), exported.error)'),
      code('preview', 'opened=open_media(exported.media)'),
      code('preview-check', 'print(opened.status, opened.result, opened.error)'),
      code('crop', 'cropped=crop_image(exported.media,0,0,1,1)'),
      code('crop-check', 'print(cropped.status, cropped.media, getattr(cropped.result, "size", None), cropped.error)'),
      code('save', "saved=save_media(cropped.media,'derived.png')"),
      code('save-check', "from pathlib import Path\nprint(saved.status, saved.media, Path('derived.png').is_file(), Path('derived.png.json').is_file(), saved.error)"),
      code('stale-call', "stale=export_output(ref['cell_id'],ref['output_id'],ref['revision'])"),
      code('stale-check', 'print(stale.status, stale.error)'),
      code('release', "closed=close_media(opened.result['preview_id'])\nreleased=release_media(exported.media['media_id'])"),
      code('release-check', 'print(closed.status, released.status, closed.error, released.error)'),
      code('released-crop', 'bad=crop_image(exported.media,0,0,1,1)'),
      code('released-check', 'print(bad.status, bad.error)'),
      code('cleanup', "Path('derived.png').unlink(missing_ok=True)\nPath('derived.png.json').unlink(missing_ok=True)\nprint('Disposable derivative removed')")
    ]);
    await run(page, 0); await run(page, 1);
    expect(await inspect(page, 2, "'outputs'")).toContain('completed');
    await run(page, 3);
    const exported = await inspect(page, 4, "'media_id'");
    expect(exported).toContain('(2, 2)');
    await run(page, 5);
    expect(await inspect(page, 6, 'preview_id')).toContain('completed');
    await run(page, 7);
    expect(await inspect(page, 8, '(1, 1)')).toContain('completed');
    await run(page, 9);
    expect(await inspect(page, 10, 'True True')).toContain('completed');
    await run(page, 0); // Identical encoded bytes, a different live output identity.
    await run(page, 11);
    expect(await inspect(page, 12, 'stale_target')).toContain('stale_target');
    await run(page, 13);
    expect(await inspect(page, 14, 'completed completed')).toContain('completed completed');
    await run(page, 15);
    expect(await inspect(page, 16, 'stale_target')).toContain('stale_target');
    expect(await run(page, 17)).toContain('Disposable derivative removed');
  });

test('a deterministic canvas recording feeds the shared frame decoder and an owner cancellation',
  async ({ page, request }) => {
    test.setTimeout(120_000);
    await notebook(page, request, [
      code('canvas', "from IPython.display import display, HTML\ndisplay(HTML('<canvas width=16 height=16></canvas>'))"),
      code('discover', "from nbinlineai.tools import list_outputs,list_canvases,start_canvas,start_recording,stop_recording,extract_frames,cancel_operation,stop_source,release_media\nlisting=list_outputs('canvas')"),
      code('discover-check', 'print(listing.status, listing.result, listing.error)'),
      code('canvas-ref', "ref=listing.result['outputs'][0]\ncanvases=list_canvases(ref['cell_id'],ref['output_id'],ref['revision'])"),
      code('canvas-ref-check', 'print(canvases.status, canvases.result, canvases.error)'),
      code('source', "canvas_ref=canvases.result['canvases'][0]\nsource=start_canvas(canvas_ref,frame_rate=12)"),
      code('source-check', 'print(source.status, source.result, source.error)'),
      code('cancel-recording', "cancelled_recording=start_recording(source.result['source_id'],save_to=None,duration=10)"),
      code('cancel-start-check', 'print(cancelled_recording.status, cancelled_recording.operation_id, cancelled_recording.error)'),
      code('cancel-call', 'cancel=cancel_operation(cancelled_recording.operation_id)'),
      code('cancel-check', 'print(cancelled_recording.status, cancel.status, cancelled_recording.media, cancel.error)'),
      code('record', "recording=start_recording(source.result['source_id'],save_to=None,duration=3)"),
      code('record-check', 'print(recording.status, recording.operation_id, recording.error)'),
      code('stop', 'stopped=stop_recording(recording.operation_id)'),
      code('stop-check', 'print(stopped.status, recording.status, recording.media, recording.error)'),
      code('frames', 'frames=extract_frames(recording.media,[0.1])'),
      code('frames-check', "pixels=[image.getpixel((0,0))[:3] for image in frames.result] if frames.result else []\nprint(frames.status, frames.media, pixels, all(abs(actual-expected)<=3 for pixel in pixels for actual,expected in zip(pixel,(51,102,153))), frames.error)"),
      code('cleanup', "released=release_media(recording.media['media_id'])\nclosed=stop_source(source.result['source_id'])"),
      code('cleanup-check', 'print(released.status, closed.status, released.error, closed.error)')
    ]);
    await run(page, 0);
    const canvas = page.locator('.jp-NotebookPanel:visible .jp-CodeCell').first().locator('.jp-RenderedHTML canvas');
    await expect(canvas).toHaveCount(1);
    await canvas.evaluate((element: HTMLCanvasElement) => {
      const draw = () => { const context = element.getContext('2d')!;
        context.fillStyle = '#336699'; context.fillRect(0, 0, 16, 16); };
      draw(); window.setInterval(draw, 100);
    });
    await run(page, 1);
    expect(await inspect(page, 2, "'outputs'")).toContain('completed');
    await run(page, 3);
    expect(await inspect(page, 4, "'canvases'")).toContain('completed');
    await run(page, 5);
    expect(await inspect(page, 6, 'source_id')).toContain('completed');
    await run(page, 7);
    expect(await inspect(page, 8, 'running')).toContain('running');
    await run(page, 9);
    expect(await inspect(page, 10, 'cancelled')).toContain('None');
    await run(page, 11);
    expect(await inspect(page, 12, 'running')).toContain('running');
    await page.waitForTimeout(900);
    await run(page, 13);
    expect(await inspect(page, 14, "'media_id'")).toContain('completed');
    await run(page, 15);
    const frames = await inspect(page, 16, 'completed [');
    expect(frames).toContain('completed');
    expect(frames).toContain('actual_seconds');
    expect(frames).toContain('True None');
    await run(page, 17);
    expect(await inspect(page, 18, 'completed completed')).toContain('completed completed');
  });

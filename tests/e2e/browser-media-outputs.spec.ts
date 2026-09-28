import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

type Cell = { id: string; cell_type: 'code'; source: string; metadata: Record<string, unknown>;
  outputs: []; execution_count: null };
const code = (id: string, source: string): Cell => ({ id, cell_type: 'code', source,
  metadata: {}, outputs: [], execution_count: null });
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="18"><rect width="24" height="18" fill="#2542a3"/></svg>';

async function notebook(page: Page, request: APIRequestContext, cells: Cell[]): Promise<void> {
  const name = `outputs-${Date.now()}-${Math.floor(Math.random() * 100000)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const response = await request.put(`/api/contents/${name}`, { headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: { cells,
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5 } } });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(cells.length);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await select.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await select.isVisible().catch(() => false)) await select.click();
  const no = page.getByRole('button', { name: 'No', exact: true });
  if (await no.isVisible().catch(() => false)) await no.click();
}

async function run(page: Page, index: number): Promise<void> {
  const cell = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').nth(index);
  const prompt = cell.locator('.jp-InputPrompt');
  const before = await prompt.textContent();
  await cell.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => {
    const current = await prompt.textContent();
    return current !== before && /\[\d+\]/.test(current ?? '');
  }).toBe(true);
}

async function laterText(page: Page, index: number, expected: string): Promise<string> {
  const cell = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').nth(index);
  for (let attempt = 0; attempt < 8; attempt++) {
    await run(page, index);
    const text = await cell.locator('.jp-OutputArea').textContent() ?? '';
    if (text.includes(expected)) return text;
  }
  return await cell.locator('.jp-OutputArea').textContent() ?? '';
}

test('live model outputs survive offscreen listing and native SVG export; same-byte replacement stales the old ref',
  async ({ page, request }) => {
    await notebook(page, request, [
      code('raster', `from IPython.display import display, Image\nimport base64\ndisplay(Image(data=base64.b64decode('${tinyPng}')))`),
      code('text', "print('UNSAVED EXISTING OUTPUT')"),
      code('vector', `from IPython.display import SVG, display\ndisplay(SVG(data='${svg}'))`),
      code('listed', "from nbinlineai.tools import list_outputs, read_output, export_output\na=list_outputs('raster')\nb=list_outputs('text')\nc=list_outputs('vector')"),
      code('checked', "print(a.status, b.status, c.status, a.result, b.result, c.result)"),
      code('exports', "ar=a.result['outputs'][0]; br=b.result['outputs'][0]; cr=c.result['outputs'][0]\nt=read_output(br['cell_id'],br['output_id'],br['revision'])\np=export_output(ar['cell_id'],ar['output_id'],ar['revision'])\ns=export_output(cr['cell_id'],cr['output_id'],cr['revision'],mime='image/svg+xml')"),
      code('results', `print(t.status, t.result, p.status, getattr(p.result,'size',None), s.status, s.result == '${svg}')`),
      code('stale', "old=export_output(ar['cell_id'],ar['output_id'],ar['revision'])"),
      code('stale-check', "print(old.status, old.error)")
    ]);
    await run(page, 0); await run(page, 1); await run(page, 2);
    await run(page, 3);
    await expect(page.locator('.nbinlineai-media-status')).toContainText('Media completed');
    expect(await laterText(page, 4, "'outputs'" )).toContain('raster');
    await run(page, 5);
    const result = await laterText(page, 6, 'UNSAVED EXISTING OUTPUT');
    expect(result).toContain('(2, 2)');
    expect(result).toContain('True');
    await run(page, 0); // Identical bytes, new IOutputModel identity.
    await run(page, 7);
    expect(await laterText(page, 8, 'stale_target')).toContain('stale_target');
  });

test('stock HTML canvas capture reads drawn pixels and rejects a removed canvas node', async ({ page, request }) => {
  await notebook(page, request, [
    code('canvas-output', "from IPython.display import display, HTML\ndisplay(HTML('<canvas width=8 height=8></canvas>'))"),
    code('discover', "from nbinlineai.tools import list_outputs, list_canvases, capture_canvas, start_canvas\no=list_outputs('canvas-output')"),
    code('discover-check', "print(o.status, o.result, o.error)"),
    code('canvases', "r=o.result['outputs'][0]\nc=list_canvases(r['cell_id'],r['output_id'],r['revision'])"),
    code('canvases-check', "print(c.status, c.result, c.error)"),
    code('capture', "canvas=c.result['canvases'][0]\nstill=capture_canvas(canvas)\nsource=start_canvas(canvas,frame_rate=12)"),
    code('inspect', "print(still.status, getattr(still.result,'size',None), still.result.getpixel((0,0))[:3] if still.result else None, source.status, source.result)"),
    code('stale', "expired=capture_canvas(canvas)"),
    code('stale-check', "print(expired.status, expired.error)")
  ]);
  await run(page, 0);
  const node = page.locator('.jp-NotebookPanel:visible .jp-CodeCell').first().locator('.jp-RenderedHTML canvas');
  await expect(node).toHaveCount(1);
  await node.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d')!;
    context.fillStyle = '#e23a1c'; context.fillRect(0, 0, 8, 8);
  });
  await run(page, 1);
  expect(await laterText(page, 2, "'outputs'")).toContain('completed');
  await run(page, 3);
  expect(await laterText(page, 4, "'canvases'")).toContain('completed');
  await run(page, 5);
  const inspected = await laterText(page, 6, '(226, 58, 28)');
  expect(inspected).toContain('(8, 8)');
  expect(inspected).toContain("'kind': 'canvas'");
  await node.evaluate(element => element.remove());
  await run(page, 7);
  expect(await laterText(page, 8, 'stale_target')).toContain('stale_target');
});

test('region captures only fully visible stock output surfaces and refuses mixed text', async ({ page, request }) => {
  await notebook(page, request, [
    code('region-image', `from IPython.display import display, Image\nimport base64\ndisplay(Image(data=base64.b64decode('${tinyPng}')))`),
    code('region-call', "from nbinlineai.tools import capture_notebook_region\nr=capture_notebook_region(['region-image'])"),
    code('region-check', "print(r.status, getattr(r.result,'size',None), r.error)"),
    code('mixed', "print('MIXED TEXT')\ndisplay(Image(data=base64.b64decode('" + tinyPng + "')))"),
    code('mixed-call', "bad=capture_notebook_region(['mixed'])"),
    code('mixed-check', "print(bad.status, bad.error)")
  ]);
  await run(page, 0); await run(page, 1);
  expect(await laterText(page, 2, 'completed')).toContain('completed');
  await run(page, 3); await run(page, 4);
  expect(await laterText(page, 5, 'unsupported')).toContain('unsupported');
});

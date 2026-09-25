import { expect, test, type APIRequestContext, type Locator, type Page } from '../support/e2e-fixtures';

const panel = (page: Page) => page.locator('.jp-NotebookPanel:visible');
const cells = (page: Page) => panel(page).locator('.jp-Notebook .jp-Cell');

async function openNotebook(page: Page, request: APIRequestContext) {
  const name = `theme-colors-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const cell = (id: string, source: string, metadata: Record<string, unknown> = {}) =>
    ({ id, cell_type: 'markdown', source, metadata });
  const created = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
      cells: [
        cell('notes', '## Ordinary lesson note\nThis cell has the usual notebook background.'),
        { id: 'code', cell_type: 'code', source: 'value = 2', metadata: {}, outputs: [], execution_count: null },
        cell('question', 'How can I check this value?', { nbinlineai: { isPromptCell: true } }),
        cell('answer', '```python\nprint(value)\n```\nThe result is 2.',
          { nbinlineai: { isOutputCell: true, promptCellId: 'question', status: 'done' } })
      ],
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(cells(page)).toHaveCount(4);
  await expect(cells(page).nth(3).locator('.jp-RenderedHTMLCommon pre')).toContainText('print(value)');
}

async function chooseTheme(page: Page, theme: 'JupyterLab Light' | 'JupyterLab Dark') {
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.locator('.lm-Menu-itemLabel', { hasText: /^Theme$/ }).hover();
  await page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${theme}$`) }).click();
  await expect.poll(async () => page.evaluate(() => document.body.dataset.jpThemeName || ''))
    .toBe(theme);
}

async function paint(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color };
  });
}

async function renderedContrast(locator: Locator) {
  return locator.evaluate(element => {
    const rgba = (color: string) => {
      const match = color.match(/^rgba?\(([^)]+)\)$/);
      if (color.startsWith('color(srgb ')) {
        const values = color.slice('color(srgb '.length, -1).split(/[ /]+/).filter(Boolean).map(Number);
        return [values[0], values[1], values[2], values[3] ?? 1];
      }
      if (!match) throw new Error(`Unsupported computed CSS color: ${color}`);
      const values = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [values[0] / 255, values[1] / 255, values[2] / 255, values[3] ?? 1];
    };
    const over = (front: number[], back: number[]) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [...front.slice(0, 3).map((value, index) =>
        (value * front[3] + back[index] * back[3] * (1 - front[3])) / alpha), alpha];
    };
    let backdrop = [1, 1, 1, 1];
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    for (const node of ancestors) backdrop = over(rgba(getComputedStyle(node).backgroundColor), backdrop);
    const foreground = over(rgba(getComputedStyle(element).color), backdrop);
    const luminance = (values: number[]) => {
      const linear = values.slice(0, 3).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const a = luminance(foreground);
    const b = luminance(backdrop);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

async function capture(page: Page, name: string) {
  const first = await cells(page).first().boundingBox();
  const last = await cells(page).last().boundingBox();
  expect(first).not.toBeNull();
  expect(last).not.toBeNull();
  await page.screenshot({ path: `test-results/ai-theme-${name}.png`, clip: {
    x: Math.max(0, first!.x - 16), y: Math.max(0, first!.y - 16),
    width: Math.min(first!.width + 32, page.viewportSize()!.width - first!.x + 16),
    height: Math.min(page.viewportSize()!.height - first!.y + 16, last!.y + last!.height - first!.y + 32)
  } });
}

test('AI question and answer tints remain readable in light and dark Lab themes', async ({ page, request }) => {
  let providerRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/nbinlineai/prompt')) providerRequests += 1;
  });
  await openNotebook(page, request);
  for (const theme of ['JupyterLab Light', 'JupyterLab Dark'] as const) {
    await chooseTheme(page, theme);
    const ordinary = await paint(cells(page).first());
    const question = await paint(cells(page).nth(2));
    const answer = await paint(cells(page).nth(3));
    expect(question.background).not.toBe(ordinary.background);
    expect(answer.background).not.toBe(ordinary.background);
    expect(question.background).not.toBe(answer.background);
    for (const index of [2, 3]) {
      expect(await renderedContrast(cells(page).nth(index).locator('.jp-RenderedHTMLCommon'))).toBeGreaterThanOrEqual(4.5);
    }
    const codeFence = cells(page).nth(3).locator('.jp-RenderedHTMLCommon pre');
    await expect(codeFence).toContainText('print(value)');
    await expect(cells(page).nth(3).locator('[data-nbinlineai-copy-code]')).toBeVisible();
    const codePaint = await paint(codeFence);
    expect(codePaint.background).not.toBe(answer.background);
    for (const index of [2, 3]) {
      const cell = cells(page).nth(index);
      const header = await cell.locator(':scope > [data-nbinlineai-cell-controls]').boundingBox();
      const input = await cell.locator(':scope > .jp-Cell-inputWrapper').boundingBox();
      expect(header).not.toBeNull();
      expect(input).not.toBeNull();
      expect(header!.y + header!.height).toBeLessThanOrEqual(input!.y + 2);
    }
    await capture(page, theme.endsWith('Light') ? 'light' : 'dark');

    const ordinaryMarkdown = cells(page).first();
    await ordinaryMarkdown.locator('.jp-Cell-inputWrapper').click();
    await page.keyboard.press('Enter');
    await expect(ordinaryMarkdown.locator('.jp-RenderedHTMLCommon')).toBeHidden();
    const ordinaryEditor = await paint(ordinaryMarkdown.locator('.jp-InputArea-editor'));
    await page.reload();
    await expect(cells(page)).toHaveCount(4);

    for (const index of [2, 3]) {
      const cell = cells(page).nth(index);
      await cell.locator('.jp-Cell-inputWrapper').click();
      await page.keyboard.press('Enter');
      await expect(cell.locator('.cm-content')).toBeVisible();
      await expect(cell.locator('.jp-RenderedHTMLCommon')).toBeHidden();
      const editor = await paint(cell.locator('.jp-InputArea-editor'));
      expect(editor.background, `AI cell ${index} editor should use the ordinary Markdown editor background`).toBe(ordinaryEditor.background);
      if (index === 2) await page.reload();
    }
    await capture(page, theme.endsWith('Light') ? 'light-editing' : 'dark-editing');
    await page.reload();
    await expect(cells(page)).toHaveCount(4);
  }
  expect(providerRequests).toBe(0);
});

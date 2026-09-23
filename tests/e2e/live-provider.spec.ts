import { expect, test } from '@playwright/test';

for (const provider of ['openai_api', 'anthropic_api'] as const) {
  test(`${provider} answers one short prompt using a real Python kernel`, async ({ page, request }) => {
    const statusResponse = await request.get('/nbinlineai/status');
    expect(statusResponse.ok()).toBeTruthy();
    const status = await statusResponse.json();
    test.skip(!status.providers?.[provider]?.configured, `${provider} is not configured`);

    const name = `live-${provider}-${Date.now()}.ipynb`;
    const notebook = {
      cells: [
        { id: 'live-setup', cell_type: 'code', source: 'smoke_value = 6\ndef increment(value: int):\n    global smoke_value\n    smoke_value += value\n    return smoke_value', metadata: {}, outputs: [], execution_count: null },
        { id: 'live-check', cell_type: 'code', source: 'print(smoke_value)', metadata: {}, outputs: [], execution_count: null }
      ],
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5
    };
    await request.get('/lab');
    const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
    expect(xsrf).toBeTruthy();
    const created = await request.put(`/api/contents/${name}`, {
      headers: { 'X-XSRFToken': xsrf! },
      data: { type: 'notebook', format: 'json', content: notebook }
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
    const code = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').first();
    await expect(code).toBeVisible();
    await expect.poll(async () => {
      const response = await request.get('/api/sessions');
      if (!response.ok()) return false;
      const sessions = await response.json();
      return sessions.some((session: any) => session.path === name && session.kernel?.id);
    }).toBeTruthy();
    await code.click();
    await page.keyboard.press('Shift+Enter');
    await expect(code.locator('.jp-InputPrompt')).toContainText('1');
    await code.click();
    await page.getByRole('button', { name: 'AI Prompt' }).click();
    const prompt = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell').last();
    await prompt.locator('.cm-content').fill('The live value is $`smoke_value`. Call &`increment` exactly once with value=1, then answer with the returned numeral only.');
    await prompt.locator('select[data-nbinlineai-provider]').selectOption(provider);
    await prompt.locator('button[data-nbinlineai-run]').click();
    const answer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell');
    await expect(answer).toContainText('7', { timeout: 90_000 });
    await expect(prompt.locator('.nbinlineai-status')).toContainText(/done|complete|ready/i);
    const inspection = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').nth(1);
    await inspection.click();
    await page.keyboard.press('Shift+Enter');
    await expect(inspection.locator('.jp-OutputArea')).toContainText('7');
  });
}

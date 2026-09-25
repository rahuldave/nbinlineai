import { expect, test } from '../support/e2e-fixtures';

test('inherited fastcore tools document a live function and edit a file in the notebook kernel', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  const key = await request.post('/nbinlineai/settings/keys', {
    headers, data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(key.ok(), await key.text()).toBeTruthy();

  const name = `fastcore-tools-${Date.now()}.ipynb`;
  const setupSource = [
    'from pathlib import Path',
    'from nbinlineai.tools import show_doc, file_str_replace, view_file',
    'def lesson_rate(',
    '    score: int,  # The student\'s current score.',
    '    bonus: int = 2,  # Extra points for the lesson.',
    ') -> int:',
    '    """Add a lesson bonus."""',
    '    return score + bonus',
    'Path("fastcore-fixture.txt").write_text("Original course note\\n")',
    'show_doc("lesson_rate")'
  ].join('\n');
  const notebook = {
    cells: [
      { id: 'fastcore-setup', cell_type: 'code', source: setupSource, metadata: {}, outputs: [], execution_count: null },
      { id: 'fastcore-declarations', cell_type: 'markdown', source: 'Available tools: &`show_doc`, &`file_str_replace`, &`view_file`.', metadata: {} },
      { id: 'fastcore-question', cell_type: 'markdown', source: 'E2E_FASTCORE_TOOLS Document lesson_rate, revise the saved study note, and show its new contents.', metadata: { nbinlineai: { isPromptCell: true } } },
      { id: 'fastcore-inspect', cell_type: 'code', source: 'print(Path("fastcore-fixture.txt").read_text())', metadata: {}, outputs: [], execution_count: null }
    ],
    metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
    nbformat: 4,
    nbformat_minor: 5
  };
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers, data: { type: 'notebook', format: 'json', content: notebook }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();

  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const panel = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  const setup = panel.locator('.jp-CodeCell').first();
  await expect(panel.locator('.jp-CodeCell')).toHaveCount(2);
  await expect(setup.locator('.cm-content')).toContainText('show_doc("lesson_rate")');
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json()).some(
      (session: any) => session.path === name && session.kernel?.id
    );
  }).toBeTruthy();
  await setup.locator('.cm-content').click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-InputPrompt')).toContainText('1');
  await expect(setup.locator('.jp-OutputArea .jp-RenderedHTMLCommon')).toContainText('Extra points for the lesson');
  await expect(setup.locator('.jp-OutputArea pre code')).toContainText('lesson_rate');

  let promptPosts = 0;
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') promptPosts += 1;
  });
  const question = panel.locator('.nbinlineai-prompt-cell').first();
  const response = page.waitForResponse(item => item.url().endsWith('/nbinlineai/prompt') && item.request().method() === 'POST');
  await question.locator('[data-nbinlineai-run]').click();
  await expect(question.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  const events = (await (await response).text()).split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
  expect(events.filter(event => event.type === 'tool_start').map(event => event.name)).toEqual([
    'show_doc', 'file_str_replace', 'view_file'
  ]);
  expect(events.filter(event => event.type === 'context').every(event =>
    ['show_doc', 'file_str_replace', 'view_file'].every(name => event.tools.includes(name))
  )).toBeTruthy();
  const answer = panel.locator('.nbinlineai-response-cell').first();
  await expect(answer.locator('.jp-RenderedHTMLCommon')).toContainText('Extra points for the lesson');
  await expect(answer.locator('.jp-RenderedHTMLCommon pre code')).toContainText('lesson_rate');
  await expect(answer.locator('.jp-RenderedHTMLCommon')).toContainText('Revised course note');

  await expect(question.locator('[data-nbinlineai-run]')).toBeDisabled();
  await question.locator('.jp-RenderedHTMLCommon').click();
  await page.keyboard.press('Shift+Enter');
  await expect(question.locator('.nbinlineai-status')).toContainText('Answer kept');

  const inspect = panel.locator('.jp-CodeCell').nth(1);
  await inspect.locator('.cm-content').click();
  await page.keyboard.press('Shift+Enter');
  await expect(inspect.locator('.jp-OutputArea')).toContainText('Revised course note');
  await expect(inspect.locator('.jp-OutputArea')).not.toContainText('Original course note');
  expect(promptPosts).toBe(1);
});

import { expect, test as base, type APIRequestContext } from '@playwright/test';

export { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

async function sessions(request: APIRequestContext): Promise<Array<{ id: string }>> {
  const response = await request.get('/api/sessions');
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

// Playwright owns this server (reuseExistingServer is false) and runs one worker.
// Set up before the page/context fixtures so their teardown closes browser
// connections before we shut down the sessions created by this test.
export const test = base.extend<{ ownedSessions: void }>({
  ownedSessions: [async ({ request, baseURL }, use, testInfo) => {
    const url = new URL(baseURL!);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).not.toBe('8888');
    expect(testInfo.config.workers).toBe(1);
    await request.get('/lab');
    const initial = new Set((await sessions(request)).map(session => session.id));
    try {
      await use();
    } finally {
      const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
      expect(xsrf).toBeTruthy();
      for (const session of await sessions(request)) {
        if (initial.has(session.id)) continue;
        const response = await request.delete(`/api/sessions/${encodeURIComponent(session.id)}`, {
          headers: { 'X-XSRFToken': xsrf! }
        });
        expect(response.status(), await response.text()).toBe(204);
      }
      await expect.poll(async () => (await sessions(request))
        .filter(session => !initial.has(session.id))).toEqual([]);
    }
  }, { auto: true }]
});

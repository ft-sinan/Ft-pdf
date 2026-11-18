import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
async function openFromFiles(page: Page, fixture = 'field-sheets.pdf') {
  const base64 = (
    fixture === 'outside.txt'
      ? Buffer.from('\ufeffNotes from Files', 'utf16le')
      : fixture === 'outside.htm'
        ? Buffer.from('<h1>Read this locally</h1>')
        : await readFile('tests/fixtures/' + fixture)
  ).toString('base64');
  // Only the OS-to-browser file handle is substituted; render, edit and storage are real.
  await page.addInitScript(
    ({ base64, fixture }) => {
      Object.defineProperty(window, 'launchQueue', {
        configurable: true,
        value: {
          setConsumer: (f: (p: object) => void) =>
            f({
              files: [
                {
                  getFile: async () =>
                    new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], fixture, {
                      type: 'application/pdf',
                    }),
                },
              ],
            }),
        },
      });
    },
    { base64, fixture },
  );
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  const handler = manifest.file_handlers.find((h: { accept: Record<string, string[]> }) =>
    Object.values(h.accept)
      .flat()
      .includes('.' + fixture.split('.').pop()),
  );
  await page.goto(handler.action);
}
test('welcome, ephemeral interactive tour, and optional browser-only birthday', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Ft PDF.' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  const sample = page.getByLabel('Read practice text');
  expect(
    await sample.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
      return e.scrollTop;
    }),
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Star sample' }).click();
  await page.getByRole('button', { name: 'Edit sample' }).click();
  await page.getByLabel('Edit practice text').fill('Tour edits disappear.');
  await page.getByRole('button', { name: 'Continue to profile' }).click();
  await page.getByLabel('Your name').fill('Nila');
  await page.getByLabel('Date of birth').fill('2001-08-14');
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/profile'));
  await page.getByRole('button', { name: 'Open my library' }).click();
  expect(Object.keys((await sent).postDataJSON()).sort()).toEqual(['expectedOwner', 'name']);
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('No recent documents')).toBeVisible();
  const w = await (await page.request.get('/api/workspace')).json();
  expect([w.documents, w.collections, w.activity]).toEqual([[], [], []]);
  expect(w.user).toMatchObject({ name: 'Nila', needsSetup: false });
  expect(w.user.birthDate).toBeUndefined();
  await page.getByLabel('Open navigation').click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByLabel('Date of birth')).toHaveValue('2001-08-14');
  await page.getByRole('button', { name: 'Clear birth date' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith('.birthday'))),
  ).toBe(false);
  await page.getByRole('button', { name: 'Replay the tour' }).click();
  await expect(page.getByLabel('Read practice text')).not.toContainText('Tour edits disappear.');
  await expect(page.getByLabel('Star sample')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('external PDF opens and scrolls before setup without a click, upload or library write', async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) apiRequests.push(r.url());
  });
  await openFromFiles(page);
  await expect(page.locator('.read-text-layer').getByText('Field sheet 1')).toBeVisible();
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-mode', 'read');
  await expect(page.locator('.first-run,.app-shell,[role=dialog],.editor-tools')).toHaveCount(0);
  await expect(page.getByLabel('Delete document')).toHaveCount(0);
  await page.getByRole('region', { name: 'Scrollable PDF' }).evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(page.locator('.read-text-layer').getByText('Field sheet 3')).toBeVisible();
  expect(apiRequests).toEqual([]);
  await page.getByRole('button', { name: 'Close PDF' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Ft PDF.' })).toBeVisible();
  const w = await (await page.request.get('/api/workspace')).json();
  expect(w.user.needsSetup).toBe(true);
  expect(w.documents).toEqual([]);
});
test('external Edit saves a separate copy and does not consume first-run setup', async ({
  page,
}) => {
  await openFromFiles(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'PDF tools', exact: true }).click();
  await page.getByRole('button', { name: 'Add blank page' }).click();
  await page.getByRole('button', { name: 'Save a library copy' }).click();
  await expect(page.getByText('Copy saved to your library')).toBeVisible();
  await expect(page.getByLabel('PDF page 1 of 4')).toBeVisible();
  const w = await (await page.request.get('/api/workspace')).json();
  expect(w.documents).toHaveLength(1);
  expect(w.user.needsSetup).toBe(true);
  expect(
    (
      await PDFDocument.load(
        await (await page.request.get(`/api/documents/${w.documents[0].id}/file`)).body(),
      )
    ).getPageCount(),
  ).toBe(4);
});
test('external password challenge belongs to the file, not the app', async ({ page }) => {
  await openFromFiles(page, 'locked-sheets.pdf');
  await expect(page.getByRole('dialog')).toContainText('password');
  await page.getByRole('dialog').locator('input[type=password]').fill('fixture-only');
  await page.getByRole('button', { name: 'Unlock document' }).click();
  // Protected files deliberately omit the selectable text layer.
  await expect(page.getByLabel('PDF page 1 of 3')).toHaveAttribute('data-rendered', 'true');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});
for (const [fixture, format, expected] of [
  ['brief.docx', 'Word', 'Timeline'],
  ['legacy-word.doc', 'Word', 'second test'],
  ['outside.txt', 'Plain text', 'Notes from Files'],
  ['outside.htm', 'HTML', 'Read this locally'],
] as const) {
  test(`Open with reads ${fixture} before setup and only saves on request`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) requests.push(r.url());
    });
    await openFromFiles(page, fixture);
    await expect(page.locator('.editor-title strong')).toHaveText(fixture, { timeout: 20000 });
    if (format === 'HTML')
      await expect(page.frameLocator('iframe[sandbox=""]').locator('h1')).toHaveText(expected);
    else
      await expect(
        page.getByLabel(format === 'Word' ? 'Word document content' : 'Plain text content'),
      ).toContainText(expected);
    await expect(
      page.locator('.first-run,.app-shell,[role=dialog],.editor-tools,[contenteditable=true]'),
    ).toHaveCount(0);
    expect(requests).toEqual([]);
    await page.getByLabel('Save to my library').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Copy saved to your library' }),
    ).toBeVisible();
    const w = await (await page.request.get('/api/workspace')).json();
    expect(w.documents).toHaveLength(1);
    expect(w.user.needsSetup).toBe(true);
  });
}

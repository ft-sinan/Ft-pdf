import { test, expect, type Page } from '@playwright/test';
async function reader(page: Page) {
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-mode', 'read');
  await expect(page.getByRole('button', { name: 'Delete document' })).toBeVisible();
  await expect(
    page.locator('.editor-tools,.annotation-layer,.save-btn,textarea,[contenteditable=true]'),
  ).toHaveCount(0);
}
async function edit(page: Page) {
  await reader(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.editor-tools')).toBeVisible();
}
async function addFixture(page: Page, type: 'pdf' | 'docx') {
  const filename = type === 'pdf' ? 'field-sheets.pdf' : 'brief.docx';
  const bytes = await (await import('node:fs/promises')).readFile('tests/fixtures/' + filename);
  const res = await page.request.post('/api/documents/import', {
    multipart: {
      file: {
        name: filename,
        mimeType:
          type === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: bytes,
      },
    },
  });
  expect(res.status()).toBe(201);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await page.getByLabel('Your name').fill('Library reader');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
});
test('create, edit and download text, then rename, trash and restore it', async ({ page }) => {
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Text', exact: true }).click();
  await dialog.getByLabel('Document name').fill('Writing log');
  await dialog.getByRole('button', { name: 'Create document' }).click();
  await edit(page);
  await page
    .getByRole('textbox', { name: 'Plain text content' })
    .fill('A new chapter.\n' + 'Saved from Ft PDF.\n'.repeat(180) + 'End of the notebook.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await reader(page);
  await expect(page.getByLabel('Plain text content')).toContainText('A new chapter');
  const scrolled = await page
    .getByRole('region', { name: 'Scrollable document' })
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
  expect(scrolled).toBeGreaterThan(0);
  const dl = page.waitForEvent('download');
  await page.getByLabel('Download document').click();
  expect((await dl).suggestedFilename()).toBe('Writing log.txt');
  await page.getByLabel('Back to workspace').click();
  await page.getByRole('button', { name: 'All documents 1' }).click();
  await page.getByLabel('Actions for Writing log', { exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Document name').fill('Studio journal');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByLabel('Open Studio journal.txt', { exact: true }).click();
  await reader(page);
  await page.getByLabel('Delete document').click();
  await expect(dialog).toContainText('Studio journal.txt');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await reader(page);
  // A rejected write leaves the file open; the same confirmation can retry.
  await page.route(
    '**/api/documents/*',
    (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 503, json: { error: 'Library is busy.' } })
        : route.continue(),
    { times: 1 },
  );
  await page.getByLabel('Delete document').click();
  await dialog.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Library is busy.');
  await expect(page.getByLabel('Plain text content')).toContainText('A new chapter');
  await dialog.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page.locator('.editor-shell')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByLabel('Open Studio journal.txt').click();
  await page.getByLabel('Delete document').click();
  await dialog.getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.getByText('Studio journal.txt', { exact: true })).toBeVisible();
  await page.getByLabel('Restore Studio journal').click();
  await expect(page.getByText('Trash is empty')).toBeVisible();
});
test('PDF text annotations are embedded in a saved PDF and it reopens', async ({ page }) => {
  await addFixture(page, 'pdf');
  await page.getByRole('button', { name: 'Continue reading' }).click();
  await expect(page.getByLabel('PDF page 1 of 3')).toBeVisible();
  await edit(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('.annotation-layer').click({ position: { x: 100, y: 180 } });
  await page.getByLabel('Annotation', { exact: true }).fill('Reviewed for print');
  await page.getByRole('button', { name: 'Place text' }).click();
  await expect(page.getByText('1 pending annotation')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel('PDF page 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByLabel('PDF page 2 of 3')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('PDF page 1 of 3')).toBeVisible();
  await reader(page);
  await expect(page.locator('.read-text-layer').getByText('Reviewed for print')).toBeVisible();
});
test('import HTML, edit its source and view a sandboxed preview', async ({ page }) => {
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'Welcome.html',
    mimeType: 'text/html',
    buffer: Buffer.from(
      '<h1>A new portfolio</h1><div style="height:200vh"></div><h2>Colophon</h2>',
    ),
  });
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click();
  await expect(
    page.frameLocator('.html-preview').getByRole('heading', { name: 'A new portfolio' }),
  ).toBeVisible();
  await page
    .frameLocator('.html-preview')
    .getByRole('heading', { name: 'Colophon' })
    .scrollIntoViewIfNeeded();
  await expect(page.locator('.html-preview')).toHaveAttribute('sandbox', '');
  await edit(page);
  await page.getByLabel('HTML source code').fill('<h1>New studio</h1>');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    page.frameLocator('.html-preview').getByRole('heading', { name: 'New studio' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
});
test('search, edit Word, and keep theme preferences', async ({ page }) => {
  await addFixture(page, 'docx');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Find a document by name or format…').fill('brief.docx');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: 'Word document content' })).toContainText(
    'Timeline',
  );
  await edit(page);
  const body = page.getByRole('textbox', { name: 'Word document content' });
  await expect(body).toContainText('Timeline');
  await body.fill('New project proposal for the studio');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
  await body.fill('Unsaved revision');
  await page.getByLabel('Back to reader').click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(body).toContainText('Unsaved revision');
  await page.getByLabel('Back to reader').click();
  await page.getByRole('button', { name: 'Discard and read' }).click();
  await reader(page);
  await expect(page.getByLabel('Word document content')).toHaveText(
    'New project proposal for the studio',
  );
  await page.getByLabel('Back to workspace').click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Espresso Rich coffee tones/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'espresso');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'espresso');
});
test('phone navigation, collection creation, registration and sign in', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Open navigation').click();
  await page.getByRole('button', { name: 'New collection', exact: true }).click();
  await page.getByLabel('Collection name').fill('Interviews');
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(page.getByRole('heading', { name: 'Interviews', exact: true })).toBeVisible();
  await expect(page.getByText('A fresh start')).toBeVisible();
  const email = `author-${Date.now()}@example.test`;
  await page.getByLabel('Open navigation').click();
  await page.getByRole('button', { name: /Library reader Guest workspace/ }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Your name').fill('Taylor Lane');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('paper-studio-2026');
  await expect(page.getByLabel('Your name')).toHaveValue('Taylor Lane');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('paper-studio-2026');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.getByLabel('Open navigation').click();
  await page.getByRole('button', { name: /Taylor Lane Personal account/ }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Signed out', { exact: true })).toBeVisible();
  await page.getByLabel('Open navigation').click();
  await page.getByRole('button', { name: /Guest Guest workspace/ }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('paper-studio-2026');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Welcome back', { exact: true })).toBeVisible();
});
test('fill a real PDF form and change page layout in the exported bytes', async ({ page }) => {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([400, 500]);
  const field = pdf.getForm().createTextField('Studio name');
  field.addToPage(first, { x: 25, y: 400, width: 240, height: 30 });
  const src = Buffer.from(await pdf.save());
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'Intake.pdf', mimeType: 'application/pdf', buffer: src });
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click();
  await edit(page);
  await page.getByLabel('PDF tools', { exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Add blank page' }).click();
  await dlg.getByLabel('Rotate page 1', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Form fields (1)' }).click();
  await dlg.getByLabel('Studio name').fill('Fieldnotes Studio');
  await dlg.getByRole('button', { name: 'Save PDF changes' }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
  await expect(page.getByLabel('PDF page 1 of 2')).toBeVisible();
  const id = new URL(page.url()).hash.split('/read/')[1];
  const response = await page.request.get(`/api/documents/${id}/file`);
  const stored = await PDFDocument.load(await response.body());
  expect(stored.getPageCount()).toBe(2);
  expect(stored.getPage(0).getRotation().angle).toBe(90);
  expect(stored.getForm().getTextField('Studio name').getText()).toBe('Fieldnotes Studio');
});

test('PDF reader scrolls long mixed-size files without mounting every page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  const { PDFDocument, degrees } = await import('pdf-lib'),
    pdf = await PDFDocument.create();
  for (let n = 1; n <= 48; n++) {
    const p = pdf.addPage(n % 2 ? [360, 540] : [620, 400]);
    if (n % 3 === 0) p.setRotation(degrees(90));
    p.drawText(`Sheet ${n}`, { x: 35, y: 80, size: 20 });
  }
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'Field atlas.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole('button', { name: 'Import 1 file' }).click();
  await reader(page);
  await expect(
    page.locator('.read-text-layer').getByText('Sheet 1', { exact: true }),
  ).toBeVisible();
  const scroll = page.getByRole('region', { name: 'Scrollable PDF' });
  await scroll.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(
    page.locator('.read-pdf-page').last().getByText('Sheet 48', { exact: true }),
  ).toBeVisible();
  // Newly measured pages may change the height slightly: finish the scroll as a user would.
  await scroll.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(page.locator('.reader-page-count')).toHaveText('Page 48 of 48');
  expect(await scroll.locator('canvas').count()).toBeLessThan(9);
  expect(await scroll.getByLabel('PDF page 1 of 48', { exact: true }).count()).toBe(0);
  await edit(page);
  await expect(page.locator('.pdf-sheet canvas')).toHaveAttribute(
    'aria-label',
    'PDF page 48 of 48',
  );
  await page.getByLabel('Back to reader').click();
  await expect(page.locator('.reader-page-count')).toHaveText('Page 48 of 48');
  await page.reload();
  await reader(page);
});
test('Creator Space credits Sinan and keeps the maker credit, studio details and contacts in Settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByLabel('Open navigation').click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Creator Space', exact: true }).click();
  const card = page.getByRole('region', { name: 'Creator Space' });
  await expect(card.getByRole('heading', { name: 'Made by Sinan', exact: true })).toBeVisible();
  const mark = card.getByRole('button', { name: 'About Ft PDF' });
  await mark.click();
  await expect(card.locator('#creator-note')).toBeVisible();
  await expect(mark).toHaveAttribute('aria-expanded', 'true');
  await mark.click();
  await expect(card.locator('#creator-note')).toBeHidden();
  await expect(card.getByRole('heading', { name: 'Made by Sinan', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Web edition', exact: true }).click();
  await expect(card.locator('.badge-detail')).toContainText('workspace server');
  await expect(card.getByRole('link', { name: 'Open GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/ft-sinan',
  );
  await expect(card.getByRole('link')).toHaveCount(5);
  await card.getByRole('button', { name: 'Copy Telegram contact' }).click();
  await expect(
    card.getByRole('status').filter({ hasText: 'Telegram contact copied.' }),
  ).toBeVisible();
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
});
test('create, edit and download text, then rename, trash and restore it', async ({ page }) => {
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Text', exact: true }).click();
  await dialog.getByLabel('Document name').fill('Writing log');
  await dialog.getByRole('button', { name: 'Create document' }).click();
  await page
    .getByRole('textbox', { name: 'Plain text content' })
    .fill('A new chapter.\nSaved from Ft PDF.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Plain text content')).toHaveValue(/A new chapter/);
  const dl = page.waitForEvent('download');
  await page.getByLabel('Download document').click();
  expect((await dl).suggestedFilename()).toBe('Writing log.txt');
  await page.getByLabel('Back to workspace').click();
  await page.getByRole('button', { name: 'All documents 13' }).click();
  await page.getByLabel('Actions for Writing log', { exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Document name').fill('Studio journal');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByLabel('Actions for Studio journal', { exact: true }).click();
  await page.getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.getByText('Studio journal.txt', { exact: true })).toBeVisible();
  await page.getByLabel('Restore Studio journal').click();
  await expect(page.getByText('Trash is empty')).toBeVisible();
});
test('PDF text annotations are embedded in a saved PDF and it reopens', async ({ page }) => {
  await page.getByRole('button', { name: 'Resume editing' }).click();
  await expect(page.getByLabel('PDF page 1 of 3')).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});
test('import HTML, edit its source and view a sandboxed preview', async ({ page }) => {
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'Welcome.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<h1>A new portfolio</h1>'),
    });
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click();
  await page.getByLabel('Open Welcome.html', { exact: true }).click();
  await page.getByLabel('HTML source code').fill('<h1>New studio</h1>');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    page.frameLocator('.html-preview').getByRole('heading', { name: 'New studio' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
});
test('search, edit Word, and keep theme preferences', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Find a document by name or format…').fill('Project proposal');
  await page.keyboard.press('Enter');
  const body = page.getByRole('textbox', { name: 'Word document content' });
  await expect(body).toContainText('Timeline');
  await body.fill('New project proposal for the studio');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: /Alex Morgan Demo workspace/ }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Your name').fill('Taylor Lane');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('paper-studio-2026');
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
  await page.getByRole('button', { name: /Alex Morgan Demo workspace/ }).click();
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
  await page.getByLabel('Open Intake.pdf', { exact: true }).click();
  await page.getByLabel('PDF tools', { exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Add blank page' }).click();
  await dlg.getByLabel('Rotate page 1', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Form fields (1)' }).click();
  await dlg.getByLabel('Studio name').fill('Fieldnotes Studio');
  await dlg.getByRole('button', { name: 'Save PDF changes' }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
  await expect(page.getByLabel('PDF page 1 of 2')).toBeVisible();
  const id = new URL(page.url()).hash.split('/edit/')[1];
  const response = await page.request.get(`/api/documents/${id}/file`);
  const stored = await PDFDocument.load(await response.body());
  expect(stored.getPageCount()).toBe(2);
  expect(stored.getPage(0).getRotation().angle).toBe(90);
  expect(stored.getForm().getTextField('Studio name').getText()).toBe('Fieldnotes Studio');
});

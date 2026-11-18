import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PDFDocument, rgb } from 'pdf-lib';
import mammoth from 'mammoth';
import { createApi } from '../server/api.mjs';
import { wordFile } from '../server/formats.mjs';
async function fixture(t) {
  const { app, db } = createApi(':memory:');
  t.after(() => db.close());
  const agent = request.agent(app);
  const { body: w } = await agent.get('/api/workspace').expect(200);
  return { app, agent, w, db };
}
const readBuffer = (res, cb) => {
  const a = [];
  res.on('data', (b) => a.push(b));
  res.on('end', () => cb(null, Buffer.concat(a)));
};
const file = async (agent, id) =>
  (await agent.get(`/api/documents/${id}/file`).buffer(true).parse(readBuffer).expect(200)).body;
test('first visit provisions an isolated, reusable workspace with real, downloadable files', async (t) => {
  const { agent, w, app } = await fixture(t);
  assert.equal(w.documents.length, 12);
  assert.equal(w.collections.length, 3);
  assert.equal(w.documents.filter((d) => d.starred).length, 3);
  assert.equal(w.user.isDemo, true);
  assert.equal((await agent.get('/api/workspace')).body.user.id, w.user.id);
  const pdf = w.documents.find((d) => d.type === 'pdf');
  assert.equal((await PDFDocument.load(await file(agent, pdf.id))).getPageCount(), 3);
  const doc = w.documents.find((d) => d.type === 'docx');
  assert.match(
    (await mammoth.extractRawText({ buffer: await file(agent, doc.id) })).value,
    /Project overview/,
  );
  const other = request.agent(app);
  await other.get('/api/workspace');
  for (const action of ['file', 'content'])
    await other.get(`/api/documents/${doc.id}/${action}`).expect(404);
  await other.patch(`/api/documents/${doc.id}`).send({ name: 'Not mine' }).expect(404);
  await other
    .post('/api/documents')
    .send({ name: 'Bad', type: 'txt', collectionId: w.collections[0].id })
    .expect(404);
  await request(app).post('/api/documents').send({ type: 'txt', name: 'No session' }).expect(401);
});
test('documents and collections support create, move, rename, star, edit, trash, restore and deletion', async (t) => {
  const { agent } = await fixture(t);
  const { body: c } = await agent
    .post('/api/collections')
    .send({ name: 'Field research', color: 'sage' })
    .expect(201);
  await agent.post('/api/collections').send({ name: 'field research', color: 'gold' }).expect(409);
  await agent
    .patch(`/api/collections/${c.id}`)
    .send({ name: 'Field notes', color: 'gold' })
    .expect(200);
  const { body: d } = await agent
    .post('/api/documents')
    .send({ name: 'Walkthrough.txt', type: 'txt' })
    .expect(201);
  assert.equal(d.name, 'Walkthrough');
  const url = `/api/documents/${d.id}`;
  const { body: m } = await agent
    .patch(url)
    .send({ name: 'Review', starred: true, collectionId: c.id })
    .expect(200);
  assert.equal(m.collectionId, c.id);
  assert.ok(m.starred);
  const { body: saved } = await agent
    .put(`${url}/content`)
    .set('If-Unmodified-Since-Ms', String(m.updated))
    .send({ content: 'A real persistent edit.\nSecond line.' })
    .expect(200);
  assert.ok(saved.size > 10);
  assert.equal((await file(agent, d.id)).toString(), 'A real persistent edit.\nSecond line.');
  await agent
    .put(`${url}/content`)
    .set('If-Unmodified-Since-Ms', String(m.updated - 1))
    .send({ content: 'stale' })
    .expect(409);
  await agent.delete('/api/collections/' + c.id).expect(204);
  assert.equal(
    (await agent.get('/api/workspace')).body.documents.find((x) => x.id === d.id).collectionId,
    null,
  );
  await agent.delete(url).expect(409);
  await agent.patch(url).send({ trashed: true }).expect(200);
  await agent.post(`${url}/open`).expect(409);
  await agent.patch(url).send({ trashed: false }).expect(200);
  await agent.post(`${url}/open`).expect(200);
  await agent.patch(url).send({ trashed: true });
  await agent.delete(url).expect(204);
  await agent.get(`${url}/content`).expect(404);
});
test('imports preserve originals and edits are exported in their real formats', async (t) => {
  const { agent } = await fixture(t);
  const bytes = await wordFile('<h1>Onboarding</h1><p>Scope of work.</p>', 'Onboarding');
  const { body: d } = await agent
    .post('/api/documents/import')
    .field('name', 'Client onboarding.docx')
    .attach('file', bytes, 'file.docx')
    .expect(201);
  assert.deepEqual(await file(agent, d.id), bytes);
  assert.match((await agent.get(`/api/documents/${d.id}/content`)).body.content, /Scope of work/);
  await agent
    .put(`/api/documents/${d.id}/content`)
    .send({ content: '<h1>Revised scope</h1><p><strong>Approved</strong> today.</p>' })
    .expect(200);
  assert.match(
    (await mammoth.extractRawText({ buffer: await file(agent, d.id) })).value,
    /Approved today/,
  );
  const p = await PDFDocument.create();
  p.addPage([300, 400]);
  const { body: pdf } = await agent
    .post('/api/documents/import')
    .attach('file', Buffer.from(await p.save()), 'Note.pdf')
    .expect(201);
  p.getPage(0).drawText('Reviewed', { x: 20, y: 200, size: 16, color: rgb(0.6, 0.2, 0.1) });
  const edited = Buffer.from(await p.save());
  await agent
    .put(`/api/documents/${pdf.id}/content`)
    .set('Content-Type', 'application/pdf')
    .send(edited)
    .expect(200);
  assert.deepEqual(await file(agent, pdf.id), edited);
  for (const [name, text] of [
    ['Notes.txt', 'Notes — മലയാളം'],
    ['Portfolio.html', '<!doctype html><h1>Portfolio</h1>'],
  ]) {
    const r = await agent
      .post('/api/documents/import')
      .field('name', name)
      .attach('file', Buffer.from(text), name)
      .expect(201);
    assert.equal((await file(agent, r.body.id)).toString(), text);
    const dl = await agent.get(`/api/documents/${r.body.id}/file`);
    assert.match(dl.headers['content-disposition'], /^attachment;/);
    assert.equal(dl.headers['x-content-type-options'], 'nosniff');
  }
  await agent
    .post('/api/documents/import')
    .attach('file', Buffer.from('not a PDF'), 'invalid.pdf')
    .expect(400);
  await agent
    .post('/api/documents/import')
    .attach('file', Buffer.from('bad'), 'unknown.bin')
    .expect(415);
});
test('registration claims demo data; login, preferences, and files survive a restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ft-workspace-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'workspace.sqlite');
  let backend = createApi(path);
  let a = request.agent(backend.app);
  const original = (await a.get('/api/workspace')).body;
  await a
    .post('/api/auth/register')
    .send({ name: 'Mira Sen', email: 'mira@example.test', password: 'short' })
    .expect(400);
  let { body: registered } = await a
    .post('/api/auth/register')
    .send({ name: 'Mira Sen', email: 'Mira@Example.test', password: 'paper-moon-2026' })
    .expect(201);
  assert.equal(registered.user.id, original.user.id);
  assert.equal(registered.user.email, 'mira@example.test');
  assert.equal(registered.user.isDemo, false);
  assert.equal(registered.documents[0].id, original.documents[0].id);
  assert.notEqual(
    backend.db.prepare('SELECT password FROM users WHERE id=?').get(original.user.id).password,
    'paper-moon-2026',
  );
  await a.patch('/api/settings').send({ theme: 'espresso', name: 'Mira S.' }).expect(200);
  const { body: d } = await a
    .post('/api/documents')
    .send({ type: 'txt', name: 'Persistent notebook' })
    .expect(201);
  await a
    .put(`/api/documents/${d.id}/content`)
    .send({ content: 'Still here after a restart.' })
    .expect(200);
  const { body: guest } = await a.post('/api/auth/logout').expect(200);
  assert.notEqual(guest.user.id, original.user.id);
  await a.get(`/api/documents/${d.id}/content`).expect(404);
  backend.db.close();
  backend = createApi(path);
  t.after(() => backend.db.close());
  a = request.agent(backend.app);
  await a.get('/api/workspace');
  await a
    .post('/api/auth/login')
    .send({ email: 'mira@example.test', password: 'not-right' })
    .expect(401);
  const { body: again } = await a
    .post('/api/auth/login')
    .send({ email: 'mira@example.test', password: 'paper-moon-2026' })
    .expect(200);
  assert.equal(again.user.id, original.user.id);
  assert.equal(again.user.theme, 'espresso');
  assert.equal(again.user.name, 'Mira S.');
  assert.equal(
    (await a.get(`/api/documents/${d.id}/content`)).body.content,
    'Still here after a restart.',
  );
});
test('legacy binary Word imports become editable DOCX files', async (t) => {
  const { agent } = await fixture(t);
  const { body: d } = await agent
    .post('/api/documents/import')
    .attach('file', 'tests/fixtures/legacy-word.doc')
    .expect(201);
  assert.equal(d.type, 'docx');
  assert.ok(
    (await mammoth.extractRawText({ buffer: await file(agent, d.id) })).value.trim().length > 0,
  );
  await agent
    .put(`/api/documents/${d.id}/content`)
    .send({ content: '<p>Converted and edited.</p>' })
    .expect(200);
  assert.match(
    (await mammoth.extractRawText({ buffer: await file(agent, d.id) })).value,
    /Converted and edited/,
  );
});
test('Word export retains tables, embedded images, and basic formatting', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const file = await wordFile(
    `<h1>Field guide</h1><table><tr><td><strong>Scope</strong></td><td>Identity</td></tr></table><p><img alt="Mark" src="data:image/png;base64,${png}" /></p>`,
    'Field guide',
  );
  const { value } = await mammoth.convertToHtml({ buffer: file });
  assert.match(value, /<table>/);
  assert.match(value, /<strong>Scope<\/strong>/);
  assert.match(value, /data:image\/png;base64,/);
});

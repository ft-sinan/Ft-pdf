import express from 'express';
import multer from 'multer';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  TYPES,
  QUOTA,
  MAX_FILE,
  fail,
  fromContent,
  importFile,
  makePdf,
  pdfInfo,
  titleOf,
} from './formats.mjs';
import { openStore, workspace, findDoc, createDemo, insertDoc, log } from './store.mjs';
const derive = promisify(scrypt),
  digest = (s) => createHash('sha256').update(s).digest('hex');
const themes = ['terracotta', 'espresso', 'forest', 'midnight'],
  colors = ['rose', 'gold', 'sage', 'blue', 'plum', 'stone'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: 1, fields: 2 },
}).single('file');
export function createApi(dbPath = process.env.FT_DB || 'data/ft-pdf.sqlite') {
  const db = openStore(dbPath),
    app = express();
  app.disable('x-powered-by');
  const getCookie = (req) =>
    String(req.headers.cookie || '')
      .split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('ft_session='))
      ?.slice(11);
  function startSession(req, res, user) {
    const old = getCookie(req);
    if (old) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(old));
    const raw = randomBytes(32).toString('hex'),
      age = 30 * 86400000;
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(raw), user, Date.now() + age);
    const secure = !!(
      req.secure ||
      String(req.get('x-forwarded-proto') || '')
        .split(',')[0]
        .trim() === 'https' ||
      /\.e2b\.app$/.test(req.hostname) ||
      process.env.FT_SECURE_COOKIE === '1'
    );
    res.cookie('ft_session', raw, {
      httpOnly: true,
      sameSite: secure ? 'none' : 'lax',
      secure,
      partitioned: secure,
      maxAge: age,
      path: '/',
    });
  }
  const api = express.Router();
  app.use('/api', api);
  api.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
      let host;
      try {
        host = new URL(req.get('origin')).host;
      } catch {}
      if (
        !host ||
        ![
          req.get('host'),
          String(req.get('x-forwarded-host') || '')
            .split(',')[0]
            .trim(),
        ].includes(host)
      )
        throw fail(403, 'This request must come from your workspace.');
    }
    const raw = getCookie(req);
    req.user = raw
      ? db
          .prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?')
          .get(digest(raw), Date.now())?.user_id
      : null;
    next();
  });
  api.use(express.json({ limit: '26mb' }));
  api.get('/health', (_req, res) => res.json({ status: 'ok' }));
  api.get('/workspace', async (req, res) => {
    if (!req.user) {
      req.user = await createDemo(db);
      startSession(req, res, req.user);
    }
    res.json(workspace(db, req.user));
  });
  api.use((req, _res, next) => {
    if (!req.user) throw fail(401, 'Your session expired. Reload the workspace and sign in again.');
    next();
  });
  const attempts = new Map();
  api.use('/auth', (req, _res, next) => {
    const key = req.ip || 'local',
      now = Date.now();
    if (attempts.size > 4000)
      for (const [k, v] of attempts) if (v.time < now - 600000) attempts.delete(k);
    const x = attempts.get(key);
    if (!x || x.time < now - 600000) attempts.set(key, { time: now, n: 1 });
    else if (++x.n > 60) throw fail(429, 'Too many attempts. Please try again later.');
    next();
  });
  function nameOf(v) {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > 64)
      throw fail(400, 'Use a name between 1 and 64 characters.');
    return v.trim();
  }
  api.post('/auth/register', async (req, res) => {
    const name = nameOf(req.body.name),
      email = String(req.body.email || '')
        .trim()
        .toLowerCase(),
      pw = req.body.password;
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200)
      throw fail(400, 'Enter a valid email address.');
    if (typeof pw !== 'string' || pw.length < 8 || pw.length > 256)
      throw fail(400, 'Use a password between 8 and 256 characters.');
    if (db.prepare('SELECT email FROM users WHERE id=?').get(req.user).email)
      throw fail(409, 'Sign out before creating another account.');
    const salt = randomBytes(16).toString('hex'),
      hash = Buffer.from(await derive(pw, salt, 64)).toString('hex');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
      throw fail(409, 'An account with this email already exists. Sign in instead.');
    db.prepare('UPDATE users SET name=?,email=?,password=? WHERE id=?').run(
      name,
      email,
      `${salt}:${hash}`,
      req.user,
    );
    startSession(req, res, req.user);
    res.status(201).json(workspace(db, req.user));
  });
  api.post('/auth/login', async (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(
        String(req.body.email || '')
          .trim()
          .toLowerCase(),
      ),
      pw = req.body.password;
    if (typeof pw !== 'string' || pw.length > 256) throw fail(400, 'Enter your password.');
    const [salt, hash] = (u?.password || 'ft-pdf-missing:').split(':');
    const derived = await derive(pw, salt, 64);
    if (!u || !timingSafeEqual(derived, Buffer.from(hash, 'hex')))
      throw fail(401, 'The email or password is incorrect.');
    startSession(req, res, u.id);
    res.json(workspace(db, u.id));
  });
  api.post('/auth/logout', async (req, res) => {
    const id = await createDemo(db);
    startSession(req, res, id);
    res.json(workspace(db, id));
  });
  api.patch('/settings', (req, res) => {
    if (req.body.theme !== undefined) {
      if (!themes.includes(req.body.theme)) throw fail(400, 'Unknown workspace theme.');
      db.prepare('UPDATE users SET theme=? WHERE id=?').run(req.body.theme, req.user);
    }
    if (req.body.name !== undefined)
      db.prepare('UPDATE users SET name=? WHERE id=?').run(nameOf(req.body.name), req.user);
    res.json(workspace(db, req.user).user);
  });
  function col(user, id) {
    if (id == null || id === '') return null;
    if (
      typeof id !== 'string' ||
      !db.prepare('SELECT id FROM collections WHERE id=? AND user_id=?').get(id, user)
    )
      throw fail(404, 'Collection not found.');
    return id;
  }
  function colFields(req) {
    const name = nameOf(req.body.name),
      color = req.body.color || 'rose';
    if (!colors.includes(color)) throw fail(400, 'Choose a collection color.');
    if (
      db
        .prepare('SELECT id FROM collections WHERE user_id=? AND name=? COLLATE NOCASE AND id!=?')
        .get(req.user, name, req.params.id || '')
    )
      throw fail(409, 'A collection with this name already exists.');
    return { name, color };
  }
  api.post('/collections', (req, res) => {
    const { name, color } = colFields(req),
      id = randomUUID();
    db.prepare('INSERT INTO collections VALUES(?,?,?,?)').run(id, req.user, name, color);
    log(db, req.user, `Created the ${name} collection`);
    res.status(201).json({ id, name, color });
  });
  api.patch('/collections/:id', (req, res) => {
    const id = col(req.user, req.params.id),
      { name, color } = colFields(req);
    db.prepare('UPDATE collections SET name=?,color=? WHERE id=?').run(name, color, id);
    res.json({ id, name, color });
  });
  api.delete('/collections/:id', (req, res) => {
    const id = col(req.user, req.params.id);
    db.prepare('DELETE FROM collections WHERE id=?').run(id);
    res.sendStatus(204);
  });
  function quota(user, n, old = 0) {
    if (n > MAX_FILE) throw fail(413, 'Files must be 25 MB or smaller.');
    if (
      db
        .prepare('SELECT coalesce(sum(length(bytes)),0) AS n FROM documents WHERE user_id=?')
        .get(user).n +
        n -
        old >
      QUOTA
    )
      throw fail(
        413,
        'Workspace storage is full. Permanently delete files from Trash to free up space.',
      );
  }
  const needed = (req) => {
    const d = findDoc(db, req.user, req.params.id);
    if (!d) throw fail(404, 'Document not found.');
    return d;
  };
  const writable = (req) => {
    const d = needed(req);
    if (d.trashed) throw fail(409, 'Restore this document from Trash before editing it.');
    return d;
  };
  api.post('/documents', async (req, res) => {
    const type = req.body.type;
    if (!TYPES.includes(type)) throw fail(400, 'Choose a document format.');
    const name = titleOf(req.body.name, type),
      collectionId = col(req.user, req.body.collectionId);
    const file =
      type === 'pdf'
        ? { bytes: await makePdf(name), pages: 1 }
        : await fromContent(
            type,
            name,
            type === 'docx'
              ? '<p></p>'
              : type === 'html'
                ? '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>New page</title>\n</head>\n<body>\n  <h1>Hello, world!</h1>\n</body>\n</html>'
                : '',
          );
    quota(req.user, file.bytes.length);
    const d = insertDoc(db, req.user, { name, type, collectionId, ...file });
    log(db, req.user, `Created ${name}.${type}`);
    res.status(201).json(d);
  });
  api.post('/documents/import', upload, async (req, res) => {
    if (!req.file) throw fail(400, 'Choose a file to import.');
    const c = col(req.user, req.body.collectionId);
    const f = await importFile(req.body.name || req.file.originalname, req.file.buffer);
    quota(req.user, f.bytes.length);
    const d = insertDoc(db, req.user, { ...f, collectionId: c });
    log(db, req.user, `Imported ${d.name}.${d.type}`);
    res.status(201).json(d);
  });
  api.patch('/documents/:id', (req, res) => {
    const d = needed(req),
      b = req.body;
    const name = b.name === undefined ? d.name : titleOf(b.name, d.type),
      c = b.collectionId === undefined ? d.collectionId : col(req.user, b.collectionId);
    for (const k of ['starred', 'trashed'])
      if (b[k] !== undefined && typeof b[k] !== 'boolean')
        throw fail(400, 'Invalid document change.');
    db.prepare(
      'UPDATE documents SET name=?,collection_id=?,starred=?,trashed=?,updated=? WHERE id=? AND user_id=?',
    ).run(
      name,
      c,
      +(b.starred ?? d.starred),
      +(b.trashed ?? d.trashed),
      b.name !== undefined ? Date.now() : d.updated,
      d.id,
      req.user,
    );
    log(
      db,
      req.user,
      `${b.trashed !== undefined ? (b.trashed ? 'Trashed' : 'Restored') : b.starred !== undefined ? (b.starred ? 'Starred' : 'Unstarred') : b.name !== undefined ? 'Renamed' : 'Moved'} ${name}.${d.type}`,
    );
    res.json(findDoc(db, req.user, d.id));
  });
  api.post('/documents/:id/open', (req, res) => {
    const d = writable(req);
    db.prepare('UPDATE documents SET opened=? WHERE id=?').run(Date.now(), d.id);
    log(db, req.user, `Opened ${d.name}.${d.type}`);
    res.json(findDoc(db, req.user, d.id));
  });
  api.get('/documents/:id/content', (req, res) => {
    const d = needed(req);
    res.json({
      content: db.prepare('SELECT content FROM documents WHERE id=?').get(d.id).content,
      updated: d.updated,
    });
  });
  api.get('/documents/:id/file', (req, res) => {
    const d = needed(req),
      b = db.prepare('SELECT bytes FROM documents WHERE id=?').get(d.id).bytes;
    res
      .set({
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${d.name}.${d.type}`).replace(/'/g, '%27')}`,
      })
      .type('application/octet-stream')
      .send(Buffer.from(b));
  });
  api.put(
    '/documents/:id/content',
    express.raw({ type: 'application/pdf', limit: MAX_FILE }),
    async (req, res) => {
      const d = writable(req);
      let f;
      if (d.type === 'pdf') {
        if (d.locked) throw fail(409, 'Protected PDFs are read-only.');
        if (!Buffer.isBuffer(req.body)) throw fail(400, 'A PDF file is required.');
        f = { bytes: req.body, content: '', ...(await pdfInfo(req.body)) };
      } else f = await fromContent(d.type, d.name, req.body.content);
      const fresh = writable(req);
      if (
        req.get('if-unmodified-since-ms') &&
        Number(req.get('if-unmodified-since-ms')) !== fresh.updated
      )
        throw fail(
          409,
          'This file changed in another tab. Reopen it before saving to avoid overwriting changes.',
        );
      quota(req.user, f.bytes.length, fresh.size);
      db.prepare(
        'UPDATE documents SET bytes=?,content=?,pages=?,updated=? WHERE id=? AND user_id=?',
      ).run(
        f.bytes,
        f.content,
        f.pages ?? null,
        Math.max(Date.now(), fresh.updated + 1),
        d.id,
        req.user,
      );
      log(db, req.user, `Saved ${d.name}.${d.type}`);
      res.json(findDoc(db, req.user, d.id));
    },
  );
  api.delete('/documents/:id', (req, res) => {
    const d = needed(req);
    if (!d.trashed) throw fail(409, 'Move this document to Trash first.');
    db.prepare('DELETE FROM documents WHERE id=? AND user_id=?').run(d.id, req.user);
    log(db, req.user, `Permanently deleted ${d.name}.${d.type}`);
    res.sendStatus(204);
  });
  api.use((_req, _res, next) => next(fail(404, 'This workspace action does not exist.')));
  api.use((err, _req, res, _next) => {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    const status = tooBig ? 413 : err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status >= 500) console.error(err);
    res
      .status(status)
      .json({
        error: tooBig
          ? 'Files must be 25 MB or smaller.'
          : status >= 500
            ? 'The workspace could not complete this request. Please try again.'
            : err.message,
      });
  });
  return { app, db };
}

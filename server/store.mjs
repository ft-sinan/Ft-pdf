import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fromContent, makePdf, QUOTA } from './formats.mjs';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,password TEXT,theme TEXT NOT NULL DEFAULT 'terracotta');
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,color TEXT NOT NULL,UNIQUE(user_id,name COLLATE NOCASE));
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,type TEXT NOT NULL,collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,starred INTEGER NOT NULL DEFAULT 0,trashed INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,opened INTEGER NOT NULL DEFAULT 0,pages INTEGER,locked INTEGER NOT NULL DEFAULT 0,cover TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',bytes BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS docs_by_owner ON documents(user_id,updated);
    CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,message TEXT NOT NULL,created INTEGER NOT NULL);
  `);
  return db;
}
const cols =
  'id,name,type,collection_id AS collectionId,starred,trashed,created,updated,opened,pages,locked,cover,length(bytes) AS size';
export const meta = (r) =>
  r ? { ...r, starred: !!r.starred, trashed: !!r.trashed, locked: !!r.locked } : null;
export const findDoc = (db, user, id) =>
  meta(db.prepare(`SELECT ${cols} FROM documents WHERE user_id=? AND id=?`).get(user, id));
export const log = (db, user, message, time = Date.now()) =>
  db
    .prepare('INSERT INTO activity(user_id,message,created) VALUES(?,?,?)')
    .run(user, message, time);
export function workspace(db, id) {
  const u = db.prepare('SELECT id,name,email,theme FROM users WHERE id=?').get(id);
  return {
    user: { ...u, isDemo: !u.email },
    documents: db
      .prepare(`SELECT ${cols} FROM documents WHERE user_id=? ORDER BY updated DESC`)
      .all(id)
      .map(meta),
    collections: db
      .prepare('SELECT id,name,color FROM collections WHERE user_id=? ORDER BY rowid')
      .all(id),
    activity: db
      .prepare(
        'SELECT id,message,created FROM activity WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 12',
      )
      .all(id),
    quota: QUOTA,
  };
}
export const defaultCover = (type) =>
  ({ pdf: 'report', docx: 'proposal', html: 'code', txt: 'note' })[type];
export function insertDoc(db, user, d) {
  const id = randomUUID(),
    now = Date.now();
  db.prepare(
    `INSERT INTO documents(id,user_id,name,type,collection_id,starred,created,updated,opened,pages,locked,cover,content,bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    user,
    d.name,
    d.type,
    d.collectionId || null,
    d.starred ? 1 : 0,
    d.created ?? now,
    d.updated ?? now,
    d.opened ?? 0,
    d.pages ?? null,
    d.locked ? 1 : 0,
    d.cover || defaultCover(d.type),
    d.content || '',
    d.bytes,
  );
  return findDoc(db, user, id);
}
const proposal =
  '<h1>Project proposal</h1><p><strong>STUDIO NORTH &nbsp; / &nbsp; CLIENT SERVICES</strong></p><h2>Project overview</h2><p>A considered redesign of the studio website, with a clear path from first impression to first conversation. Our goal is to make the work easy to explore and the team easy to reach.</p><h2>Scope of work</h2><ul><li>Discovery workshop and audience research</li><li>Information architecture and content strategy</li><li>Visual design for desktop and mobile</li><li>Accessibility review and launch support</li></ul><h2>Timeline</h2><p>The project runs over six weeks, with weekly reviews and two rounds of design feedback.</p><h2>Next steps</h2><p>Review the proposed scope and share your feedback at our next check-in.</p>';
const portfolio = `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>Studio North — Portfolio</title>\n  <style>\n    body { background: #f6f2e9; color: #34312b; font: 18px/1.6 system-ui; margin: 9%; }\n    small { color: #aa4436; letter-spacing: .18em; }\n    h1 { font: bold 3em Georgia, serif; }\n    article { border-top: 1px solid #c9c2b4; padding: 1rem 0; }\n  </style>\n</head>\n<body>\n  <small>STUDIO NORTH / SELECTED WORK</small>\n  <h1>Good work, thoughtfully made.</h1>\n  <p>An independent practice in identity, print, and digital design.</p>\n  <article>01 &nbsp; Fieldnotes visual identity</article>\n  <article>02 &nbsp; A journal for slow travel</article>\n</body>\n</html>`;
let seedPromise;
async function demoFiles() {
  const records = [
    ['Studio brand guidelines', 'pdf', 0, 0, 24, 'brand'],
    ['Quarterly report', 'pdf', 1, 1, 94, 'report'],
    ['Project proposal', 'docx', 1, 1, 185, 'proposal', proposal],
    ['Portfolio index', 'html', 0, 1, 430, 'code', portfolio],
    [
      'Launch checklist',
      'txt',
      0,
      0,
      1450,
      'note',
      'Website launch checklist\n\n[✓] Review the page titles and descriptions\n[✓] Test the navigation on mobile\n[ ] Confirm the final image credits\n[ ] Check the contact form\n[ ] Schedule the launch announcement\n',
    ],
    [
      'Meeting notes',
      'docx',
      1,
      0,
      1670,
      'proposal',
      '<h1>Client check-in</h1><p><strong>Monthly project review</strong></p><h2>Decisions</h2><p>Keep the first release focused on the portfolio and enquiry flow. The journal will follow in a second phase.</p><h2>Action items</h2><ul><li>Share revised wireframes by Friday.</li><li>Collect image permissions from the photographers.</li></ul>',
    ],
    [
      'Reading list',
      'txt',
      2,
      0,
      2880,
      'note',
      'Reading list\n\nThe Design of Everyday Things — Don Norman\nThinking with Type — Ellen Lupton\nWays of Seeing — John Berger\n\nRevisit the typography chapter before the next studio review.',
    ],
    ['Creative brief', 'pdf', 0, 0, 4320, 'brand'],
    [
      'Welcome page',
      'html',
      2,
      0,
      5600,
      'code',
      '<!doctype html>\n<html lang="en">\n<h1>Welcome to my notebook</h1>\n<p>A place for small ideas, reading notes, and work in progress.</p>\n</html>',
    ],
    [
      'Research notes',
      'txt',
      1,
      0,
      6700,
      'note',
      'Research notes\n\nParticipants want a faster way to compare case studies. Prioritize a simple project index and stronger summaries.',
    ],
    [
      'Freelance agreement',
      'docx',
      1,
      0,
      8640,
      'proposal',
      '<h1>Freelance agreement</h1><h2>Working together</h2><p>This draft outlines the project scope, milestones, and communication schedule for our next engagement.</p><h2>Deliverables</h2><p>Final design files, a short handoff guide, and a recorded walkthrough.</p>',
    ],
    ['Travel itinerary', 'pdf', 2, 0, 10080, 'report'],
  ];
  return Promise.all(
    records.map(async ([name, type, collection, starred, mins, cover, content]) => ({
      name,
      type,
      collection,
      starred,
      mins,
      cover,
      ...(type === 'pdf'
        ? {
            bytes: await makePdf(
              name,
              name === 'Studio brand guidelines'
                ? 'brand'
                : name === 'Quarterly report'
                  ? 'report'
                  : name === 'Travel itinerary'
                    ? 'travel'
                    : 'brief',
            ),
            pages: 3,
          }
        : await fromContent(type, name, content)),
    })),
  );
}
export async function createDemo(db) {
  const files = await (seedPromise ??= demoFiles()),
    id = randomUUID(),
    now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run(id, 'Alex Morgan');
    const cids = [
      ['Design studio', 'rose'],
      ['Client work', 'gold'],
      ['Personal', 'sage'],
    ].map(([name, color]) => {
      const cid = randomUUID();
      db.prepare('INSERT INTO collections(id,user_id,name,color) VALUES(?,?,?,?)').run(
        cid,
        id,
        name,
        color,
      );
      return cid;
    });
    const docs = files.map((f) =>
      insertDoc(db, id, {
        ...f,
        collectionId: cids[f.collection],
        created: now - (f.mins + 20000) * 60000,
        updated: now - f.mins * 60000,
        opened: now - f.mins * 60000,
      }),
    );
    log(db, id, 'Opened Studio brand guidelines.pdf', docs[0].opened);
    log(db, id, 'Starred Quarterly report.pdf', docs[1].updated);
    log(db, id, 'Edited Project proposal.docx', docs[2].updated);
    db.exec('COMMIT');
    return id;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

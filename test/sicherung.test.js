'use strict';
// Sicherung: Herunterladen, Wiederherstellen (IDs nie doppelt, Sitzungen enden, Superadmin aus der Umgebung),
// tägliche Kopien im Datenverzeichnis (14 Tage), Rechte.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const H = require('./helpers');

async function aufbau(extra) {
  const app = H.makeApp(extra);
  const admin = await H.adminClient(app);
  const k = await H.erwarte(await admin.post('/api/lehrkraft/kurse').send({ name: 'LK 13' }), 201);
  const s = await H.schuelerClient(app, k.code, 'Mika R.');
  return { app, admin, k, s };
}

test('Sicherung herunterladen: alle Tabellen, kein Signaturschlüssel', async () => {
  const { admin, k, s } = await aufbau();
  const r = await admin.get('/api/admin/sicherung');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-disposition'], /attachment; filename="infolabs-sicherung_\d{4}-\d{2}-\d{2}\.json"/);
  const d = r.body;
  assert.equal(d.app, 'infolabs-portal');
  assert.equal(d.format, 1);
  assert.equal(d.tabellen.kurse[0].code, k.code);
  assert.equal(d.tabellen.schueler[0].code, s.code);
  assert.ok(d.tabellen.lehrkraefte[0].pw_hash.startsWith('scrypt$'));
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE KEY|MC4CAQAw/);
});

test('Wiederherstellen: Stand zurück, IDs werden nie doppelt vergeben, alle Sitzungen enden', async () => {
  const { app, admin, k, s } = await aufbau();
  const sicherung = (await admin.get('/api/admin/sicherung')).body;
  // nach der Sicherung: neuer Schüler (s:2) und neuer Kurs
  const spaet = await H.schuelerClient(app, k.code, 'Noa B.');
  await admin.post('/api/lehrkraft/kurse').send({ name: 'Neuer Kurs' });
  assert.equal((await admin.post('/api/admin/wiederherstellen').send({ daten: sicherung })).status, 400, 'ohne Bestätigung');
  assert.equal((await admin.post('/api/admin/wiederherstellen').send({ daten: { app: 'x' }, bestaetigung: 'WIEDERHERSTELLEN' })).status, 400);
  const r = await H.erwarte(await admin.post('/api/admin/wiederherstellen').send({ daten: sicherung, bestaetigung: 'WIEDERHERSTELLEN' }), 200);
  assert.equal(r.anzahl.schueler, 1);
  assert.equal((await admin.get('/api/admin/uebersicht')).status, 401, 'Sitzung des Superadmins endet');
  assert.equal((await s.get('/api/schueler/ich')).status, 401, 'Schüler-Sitzung endet');
  assert.equal((await spaet.get('/api/schueler/ich')).status, 401);
  // Anmeldung mit den alten Daten klappt wieder, der spätere Schüler fehlt
  await H.erwarte(await H.client(app).post('/api/schueler/anmelden').send({ name: 'Mika R.', code: s.code }), 200);
  assert.equal((await H.client(app).post('/api/schueler/anmelden').send({ name: 'Noa B.', code: spaet.code })).status, 401);
  // neues Konto erbt nicht die ID des verworfenen „Noa B.“ (sonst gleiche sub auf den Plattformen)
  const db = app.locals.ctx.db;
  const neu = await H.schuelerClient(app, k.code, 'Ida K.');
  const ids = db.prepare('SELECT id, name FROM schueler ORDER BY id').all();
  assert.deepEqual(ids.map((x) => x.name), ['Mika R.', 'Ida K.']);
  assert.ok(ids[1].id >= 3, `neue ID ${ids[1].id} darf 2 nicht wiederverwenden`);
  assert.ok(neu.code);
  assert.ok(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'kurse'").get().seq >= 2);
});

test('Wiederherstellen setzt den Superadmin aus der Umgebung (Passwort aus ADMIN_PASSWORD)', async () => {
  const andere = H.makeApp({ adminPassword: 'ganz-anderes-pw-1' });
  const a2 = H.client(andere);
  await H.erwarte(await a2.post('/api/lehrkraft/anmelden').send({ email: 'admin', passwort: 'ganz-anderes-pw-1' }), 200);
  const fremd = (await a2.get('/api/admin/sicherung')).body;
  const { app, admin } = await aufbau();
  await H.erwarte(await admin.post('/api/admin/wiederherstellen').send({ daten: fremd, bestaetigung: 'WIEDERHERSTELLEN' }), 200);
  await H.adminClient(app); // Passwort H.ADMIN_PW gilt weiter
});

test('Unvollständige Sicherung (fehlende Verweise) wird abgelehnt, nichts geändert', async () => {
  const { app, admin } = await aufbau();
  const d = (await admin.get('/api/admin/sicherung')).body;
  d.tabellen.lehrkraefte = [];
  const r = await admin.post('/api/admin/wiederherstellen').send({ daten: d, bestaetigung: 'WIEDERHERSTELLEN' });
  assert.equal(r.status, 400);
  assert.equal(app.locals.ctx.db.prepare('SELECT COUNT(*) AS n FROM kurse').get().n, 1);
  await H.erwarte(await admin.get('/api/admin/uebersicht'), 200);
});

test('Tägliche Kopien: eine je Tag, lesbare Datenbank, höchstens 14, Download nur gültiger Namen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sicherung-'));
  const u = H.uhr(Date.parse('2026-10-01T08:00:00Z'));
  const { app, admin } = await aufbau({ sicherungsDir: dir, now: u });
  for (let t = 0; t < 16; t++) {
    await app.locals.wartung.lauf();
    await app.locals.wartung.lauf(); // zweiter Lauf am selben Tag legt nichts an
    u.vor(24 * 3600 * 1000);
  }
  const liste = (await H.erwarte(await admin.get('/api/admin/sicherungen'), 200)).sicherungen;
  assert.equal(liste.length, 14);
  assert.equal(liste[0].name, 'portal-2026-10-16.db');
  const p = path.join(dir, liste[0].name);
  assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  const kopie = new Database(p, { readonly: true });
  assert.equal(kopie.prepare('SELECT COUNT(*) AS n FROM kurse').get().n, 1);
  kopie.close();
  const dl = await admin.get('/api/admin/sicherungen/' + liste[0].name);
  assert.equal(dl.status, 200);
  assert.equal((await admin.get('/api/admin/sicherungen/..%2Fportal.db')).status, 404);
  assert.equal((await admin.get('/api/admin/sicherungen/portal-2020-01-01.db')).status, 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Sicherung nur für den Superadmin', async () => {
  const { app, admin, s } = await aufbau();
  const lk = await H.lehrkraftClient(app, admin);
  for (const c of [lk, s, H.client(app)]) {
    assert.ok([401, 403].includes((await c.get('/api/admin/sicherung')).status));
    assert.ok([401, 403].includes((await c.get('/api/admin/sicherungen')).status));
    assert.ok([401, 403].includes((await c.post('/api/admin/wiederherstellen').send({ bestaetigung: 'WIEDERHERSTELLEN' })).status));
  }
});

test('Jede Tabelle der Datenbank ist in der Sicherung enthalten (außer meta)', () => {
  const app = H.makeApp();
  const { TABELLEN } = require('../src/services/sicherung');
  const alle = app.locals.ctx.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'meta'")
    .all()
    .map((r) => r.name)
    .sort();
  assert.deepEqual([...TABELLEN].sort(), alle);
});

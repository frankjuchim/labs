'use strict';
// Datenübernahme aus Algo Quest (H.11): Hashes bleiben gültig, Kurscodes und persönliche Codes unverändert,
// Zuordnung alt → neu, idempotent, Probelauf. Beispieldaten ohne Klarnamen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers');

function aqHash(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 1024, r: 8, p: 1 });
  return `scrypt$1024$8$1$${salt.toString('base64')}$${h.toString('base64')}`;
}

/** Algo-Quest-Backup (Format 2) mit Lernstand-Tabellen, die das Portal ignorieren muss. */
function aqBackup() {
  return {
    app: 'algoquest-lab',
    format: 2,
    schemaVersion: 3,
    exportedAt: '2026-10-10T10:00:00.000Z',
    tables: {
      meta: [{ key: 'schema_version', value: '3' }],
      lehrkraefte: [
        { id: 1, email: 'admin', name: 'Superadmin', schule: '', pw_hash: aqHash('egal-egal-egal'), rolle: 'superadmin', status: 'aktiv', created_at: '2026-01-01T00:00:00Z' },
        { id: 2, email: 'lk.eins@schule.example', name: 'Lehrkraft Eins', schule: 'Testschule', pw_hash: aqHash('aq-passwort-123'), rolle: 'lehrkraft', status: 'aktiv', created_at: '2026-02-01T00:00:00Z' },
        { id: 3, email: 'lk.zwei@schule.example', name: 'Lehrkraft Zwei', schule: 'Testschule', pw_hash: aqHash('aq-passwort-456'), rolle: 'lehrkraft', status: 'wartet', created_at: '2026-03-01T00:00:00Z' }
      ],
      kurse: [
        { id: 10, lehrkraft_id: 2, name: 'LK 13', code: 'ABCDEF', einstellungen: '{"anmeldung":true}', created_at: '2026-02-02T00:00:00Z' },
        { id: 11, lehrkraft_id: 2, name: 'GK 12', code: 'GHJKLM', einstellungen: '{"anmeldung":false}', created_at: '2026-02-03T00:00:00Z' },
        { id: 12, lehrkraft_id: 1, name: 'Admin-Kurs', code: 'NPQRST', einstellungen: '{}', created_at: '2026-02-04T00:00:00Z' }
      ],
      schueler: [
        { id: 100, kurs_id: 10, name: 'Ada L.', name_key: 'ada l.', code: 'ABC-234', created_at: '2026-02-05T00:00:00Z', last_active_at: '2026-10-01T00:00:00Z' },
        { id: 101, kurs_id: 10, name: 'Kim T.', name_key: 'kim t.', code: 'XYZ-789', created_at: '2026-02-06T00:00:00Z' },
        // Altbestand vor 2.3: gleicher Code in einem anderen Kurs
        { id: 102, kurs_id: 11, name: 'Rio P.', name_key: 'rio p.', code: 'ABC-234', created_at: '2026-02-07T00:00:00Z' },
        { id: 103, kurs_id: 12, name: 'Ada L.', name_key: 'ada l.', code: 'DEF-345', created_at: '2026-02-08T00:00:00Z' }
      ],
      fortschritt: [{ schueler_id: 100, aufgabe_id: 'w0-1', status: 'geloest', punkte: 10, updated_at: '2026-10-01T00:00:00Z' }]
    }
  };
}

test('Import aus Algo-Quest-Backup: Probelauf, Übernahme, Anmeldung mit alten Zugangsdaten, Zuordnung', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  H.plattformEintragen(app, { id: 'algoquest' });
  const db = app.locals.ctx.db;

  const probe = await H.erwarte(await admin.post('/api/admin/import').send({ daten: aqBackup(), probelauf: true }), 200);
  assert.equal(probe.bericht.probelauf, true);
  assert.equal(probe.bericht.schueler.neu, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schueler').get().n, 0, 'Probelauf schreibt nichts');
  assert.equal((await admin.get('/api/admin/importe')).body.importe.length, 0);

  const { bericht, zuordnung } = await H.erwarte(await admin.post('/api/admin/import').send({ daten: aqBackup() }), 200);
  assert.deepEqual(bericht.lehrkraefte, { neu: 2, vorhanden: 0, zusammengefuehrt: 0, uebersprungen: 0 });
  assert.deepEqual(bericht.kurse, { neu: 3, vorhanden: 0, neuerKurscode: 0, uebersprungen: 0 });
  assert.deepEqual(bericht.schueler, { neu: 4, vorhanden: 0, neuerCode: 1, uebersprungen: 0 });
  assert.equal(zuordnung.format, 'verbund-zuordnung');
  assert.equal(zuordnung.quelle, 'algoquest');
  // Lernstände wurden nicht übernommen (keine solche Tabelle) – und nirgends gespeichert
  const imp = db.prepare('SELECT bericht, zuordnung FROM importe').get();
  assert.doesNotMatch(imp.bericht + imp.zuordnung, /w0-1|geloest/);

  // Lehrkraft meldet sich mit dem Algo-Quest-Passwort an; Kurs-Plattform algoquest freigeschaltet
  const lk = H.client(app);
  await H.erwarte(await lk.post('/api/lehrkraft/anmelden').send({ email: 'lk.eins@schule.example', passwort: 'aq-passwort-123' }), 200);
  const kurse = (await lk.get('/api/lehrkraft/kurse')).body.kurse;
  assert.deepEqual(kurse.map((k) => [k.name, k.code, k.beitrittOffen]).sort(), [['GK 12', 'GHJKLM', false], ['LK 13', 'ABCDEF', true]]);
  assert.deepEqual(kurse[0].plattformen.map((p) => p.id), ['algoquest']);
  assert.deepEqual((await lk.get('/api/lehrkraft/ich')).body.plattformen, ['algoquest']);
  // wartende Lehrkraft bleibt wartend
  assert.equal((await H.client(app).post('/api/lehrkraft/anmelden').send({ email: 'lk.zwei@schule.example', passwort: 'aq-passwort-456' })).status, 403);

  // Schüler: Name + unveränderter Code; der jüngere Doppel-Code bekam einen neuen Code
  const s = H.client(app);
  await H.erwarte(await s.post('/api/schueler/anmelden').send({ name: 'Ada L.', code: 'ABC-234' }), 200);
  const rio = zuordnung.schueler.find((x) => x.altId === 102);
  assert.equal(rio.art, 'neuerCode');
  assert.match(rio.neuerCode, /^[A-HJ-NP-Z]{3}-[2-9]{3}$/);
  await H.erwarte(await H.client(app).post('/api/schueler/anmelden').send({ name: 'Rio P.', code: rio.neuerCode }), 200);
  const gk = kurse.find((k) => k.name === 'GK 12');
  const liste = (await lk.get(`/api/lehrkraft/kurse/${gk.id}/schueler`)).body.schueler;
  assert.equal(liste[0].codeNeu, true, 'Lehrkraft sieht, wer einen neuen Code bekommen hat');
  // Kurs des Algo-Quest-Superadmins gehört dem Portal-Superadmin
  const adminKurse = (await admin.get('/api/lehrkraft/kurse')).body.kurse;
  assert.equal(adminKurse.find((k) => k.name === 'Admin-Kurs').rolle, 'inhaber');

  // Zuordnung alt → neu
  assert.deepEqual(zuordnung.kurse.map((k) => [k.altId, k.kurscode]).sort(), [[10, 'ABCDEF'], [11, 'GHJKLM'], [12, 'NPQRST']]);
  for (const k of zuordnung.kurse) assert.match(k.kursId, /^k:\d+$/);
  for (const x of zuordnung.schueler) assert.match(x.sub, /^s:\d+$/);
  assert.ok(zuordnung.lehrkraefte.find((l) => l.altId === 1).sub.startsWith('a:'));
  const id = (await admin.get('/api/admin/importe')).body.importe[0].id;
  const dl = await admin.get(`/api/admin/importe/${id}/zuordnung.json`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers['content-disposition'], /attachment/);
  assert.deepEqual(dl.body.schueler, zuordnung.schueler);

  // idempotent
  const zweit = await H.erwarte(await admin.post('/api/admin/import').send({ daten: aqBackup() }), 200);
  assert.deepEqual(zweit.bericht.schueler, { neu: 0, vorhanden: 4, neuerCode: 0, uebersprungen: 0 });
  assert.deepEqual(zweit.bericht.kurse, { neu: 0, vorhanden: 3, neuerKurscode: 0, uebersprungen: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schueler').get().n, 4);
});

test('Import: bestehendes Portal-Konto wird zusammengeführt, belegter Kurscode bekommt neuen Code', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  H.plattformEintragen(app, { id: 'algoquest' });
  const lk = await H.lehrkraftClient(app, admin, { email: 'lk.eins@schule.example', pw: 'portal-passwort-1' });
  const vorhanden = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'Portal-Kurs' }), 201);
  const d = aqBackup();
  d.tables.kurse[0].code = vorhanden.code;
  const { bericht, zuordnung } = await H.erwarte(await admin.post('/api/admin/import').send({ daten: d }), 200);
  assert.equal(bericht.lehrkraefte.zusammengefuehrt, 1);
  assert.equal(bericht.kurse.neuerKurscode, 1);
  assert.notEqual(zuordnung.kurse.find((k) => k.altId === 10).kurscode, vorhanden.code);
  // Portal-Passwort bleibt
  await H.erwarte(await H.client(app).post('/api/lehrkraft/anmelden').send({ email: 'lk.eins@schule.example', passwort: 'portal-passwort-1' }), 200);
  assert.equal((await lk.get('/api/lehrkraft/kurse')).body.kurse.length, 3);
});

test('Import: unbekanntes Format und Nicht-Superadmin werden abgelehnt', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  assert.equal((await admin.post('/api/admin/import').send({ daten: { app: 'anderes' } })).status, 400);
  const lk = await H.lehrkraftClient(app, admin);
  assert.equal((await lk.post('/api/admin/import').send({ daten: aqBackup() })).status, 403);
});

test('Import im Verbund-Exportformat (Vorschlag v1.1)', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const daten = {
    format: 'verbund-export',
    version: 1,
    quelle: 'algoquest',
    lehrkraefte: [{ altId: 5, email: 'lk@schule.example', name: 'Lehrkraft', schule: 'Testschule', pwHash: aqHash('pw-pw-pw-pw-1'), rolle: 'lehrkraft', status: 'aktiv' }],
    kurse: [{ altId: 7, lehrkraftAltId: 5, name: 'Kurs', code: 'KMNPQR', beitrittOffen: true }],
    schueler: [{ altId: 9, kursAltId: 7, name: 'Tom', code: 'TUV-234' }]
  };
  const { bericht } = await H.erwarte(await admin.post('/api/admin/import').send({ daten }), 200);
  assert.equal(bericht.schueler.neu, 1);
  assert.equal(bericht.plattformFreigeschaltet, false);
  assert.ok(bericht.hinweise.some((h) => /nicht \(nutzbar\) eingetragen/.test(h)));
  await H.erwarte(await H.client(app).post('/api/schueler/anmelden').send({ name: 'tom', code: 'tuv234' }), 200);
});

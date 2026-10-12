'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/security');
const H = require('./helpers');

test('Lehrkraft: Registrierung wartet auf Freigabe, danach Anmeldung', async () => {
  const app = H.makeApp();
  const c = H.client(app);
  await H.erwarte(await c.post('/api/lehrkraft/registrieren').send({ name: 'Lehrkraft A', email: 'a@schule.example', schule: 'Testschule', passwort: 'geheim-12345' }), 201);
  let r = await c.post('/api/lehrkraft/anmelden').send({ email: 'a@schule.example', passwort: 'geheim-12345' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Freigabe/);
  r = await c.post('/api/lehrkraft/registrieren').send({ name: 'Lehrkraft A', email: 'A@schule.example', schule: 'Testschule', passwort: 'geheim-12345' });
  assert.equal(r.status, 409, 'E-Mail ohne Groß-/Kleinschreibung eindeutig');
  const admin = await H.adminClient(app);
  const lk = (await admin.get('/api/admin/lehrkraefte')).body.lehrkraefte.find((l) => l.email === 'a@schule.example');
  assert.equal(lk.status, 'wartet');
  assert.match(lk.sub, /^l:\d+$/);
  await H.erwarte(await admin.post(`/api/admin/lehrkraefte/${lk.id}/status`).send({ status: 'aktiv' }), 200);
  r = await c.post('/api/lehrkraft/anmelden').send({ email: 'a@schule.example', passwort: 'falsch-falsch' });
  assert.equal(r.status, 401);
  r = await c.post('/api/lehrkraft/anmelden').send({ email: 'a@schule.example', passwort: 'geheim-12345' });
  assert.equal(r.status, 200);
  const ich = await H.erwarte(await c.get('/api/lehrkraft/ich'), 200);
  assert.equal(ich.rolle, 'lehrkraft');
  assert.deepEqual(ich.plattformen, []);
});

test('Superadmin: sub a:<n>, Passwort nur über die Umgebung, ohne Passwort gesperrt', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const ich = await H.erwarte(await admin.get('/api/lehrkraft/ich'), 200);
  assert.match(ich.sub, /^a:\d+$/);
  const r = await admin.post('/api/lehrkraft/passwort').send({ alt: H.ADMIN_PW, neu: 'neues-passwort-123' });
  assert.equal(r.status, 403);
  const gesperrt = H.makeApp({ adminPassword: '' });
  const r2 = await H.client(gesperrt).post('/api/lehrkraft/anmelden').send({ email: 'admin', passwort: H.ADMIN_PW });
  assert.equal(r2.status, 401, 'ohne ADMIN_PASSWORD gibt es kein Superadmin-Konto');
});

test('Einmal-Passwort: alte Sitzung ungültig, danach nur Passwortwechsel', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const lk = await H.lehrkraftClient(app, admin);
  const e = await H.erwarte(await admin.post(`/api/admin/lehrkraefte/${lk.id}/einmalpasswort`).send({}), 200);
  assert.match(e.passwort, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  assert.equal((await lk.get('/api/lehrkraft/ich')).status, 401, 'Sitzung wurde beendet');
  const c = H.client(app);
  const a = await H.erwarte(await c.post('/api/lehrkraft/anmelden').send({ email: lk.email, passwort: e.passwort }), 200);
  assert.equal(a.mussPasswortAendern, true);
  const r = await c.get('/api/lehrkraft/kurse');
  assert.equal(r.status, 403);
  assert.equal(r.body.passwortAendern, true);
  await H.erwarte(await c.post('/api/lehrkraft/passwort').send({ alt: e.passwort, neu: 'mein-neues-pw-1' }), 200);
  await H.erwarte(await c.get('/api/lehrkraft/kurse'), 200);
});

test('Passwort-Hash im Format von Algo Quest (scrypt$N$r$p$salt$hash) und mit N = 32768 prüfbar', async () => {
  const hash = S.hashPasswortSync('irgendein-passwort');
  assert.match(hash, /^scrypt\$\d+\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  // ein „echter“ Hash mit den Produktionsparametern (wie aus Algo Quest importiert)
  const crypto = require('node:crypto');
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync('passwort-aus-aq', salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const aq = `scrypt$32768$8$1$${salt.toString('base64')}$${h.toString('base64')}`;
  assert.equal(await S.pruefePasswort('passwort-aus-aq', aq), true);
  assert.equal(await S.pruefePasswort('falsch', aq), false);
});

test('Schüler: Beitritt mit Kurscode + Name → Code ABC-234, Weiterlernen mit Name + Code', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const kurs = await H.erwarte(await admin.post('/api/lehrkraft/kurse').send({ name: 'Informatik 12' }), 201);
  assert.match(kurs.code, /^[A-HJ-NP-Z2-9]{6}$/);
  const info = await H.erwarte(await H.client(app).get(`/api/kurs/${kurs.code.toLowerCase()}`), 200);
  assert.deepEqual(info, { name: 'Informatik 12', offen: true });

  const s = await H.schuelerClient(app, kurs.code, '  Mika   R. ');
  assert.equal(s.name, 'Mika R.');
  assert.match(s.code, /^[A-HJ-NP-Z]{3}-[2-9]{3}$/);
  assert.equal((await H.client(app).post('/api/schueler/beitreten').send({ kurscode: kurs.code, name: 'mika r.' })).status, 409, 'Name im Kurs eindeutig');
  assert.equal((await H.client(app).post('/api/schueler/beitreten').send({ kurscode: 'XXXXXX', name: 'Noa' })).status, 404);
  assert.equal((await H.client(app).post('/api/schueler/beitreten').send({ kurscode: kurs.code, name: '<b>' })).status, 400);

  const c = H.client(app);
  assert.equal((await c.post('/api/schueler/anmelden').send({ name: 'Mika R.', code: 'AAA-222' })).status, 401);
  const roh = s.code.replace('-', '').toLowerCase();
  await H.erwarte(await c.post('/api/schueler/anmelden').send({ name: 'mika  r.', code: roh }), 200);
  const ich = await H.erwarte(await c.get('/api/schueler/ich'), 200);
  assert.equal(ich.code, s.code);
  assert.equal(ich.kurse.length, 1);
  assert.equal((await c.get('/api/lehrkraft/kurse')).status, 401, 'Schüler hat keinen Lehrkraft-Zugang');
});

test('Schüler: ein Konto für mehrere Kurse', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const k1 = await H.erwarte(await admin.post('/api/lehrkraft/kurse').send({ name: 'LK 13' }), 201);
  const k2 = await H.erwarte(await admin.post('/api/lehrkraft/kurse').send({ name: 'Informatik-AG' }), 201);
  const s = await H.schuelerClient(app, k1.code, 'Noa B.');
  await H.erwarte(await s.post('/api/schueler/kurse').send({ kurscode: k2.code }), 201);
  assert.equal((await s.post('/api/schueler/kurse').send({ kurscode: k2.code })).status, 409);
  const ich = await H.erwarte(await s.get('/api/schueler/ich'), 200);
  assert.deepEqual(ich.kurse.map((k) => k.name).sort(), ['Informatik-AG', 'LK 13']);
  // Namenskonflikt im zweiten Kurs
  const k3 = await H.erwarte(await admin.post('/api/lehrkraft/kurse').send({ name: 'Kurs 3' }), 201);
  await H.schuelerClient(app, k3.code, 'Noa B.');
  assert.equal((await s.post('/api/schueler/kurse').send({ kurscode: k3.code })).status, 409);
});

test('Persönliche Codes sind kursübergreifend eindeutig', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const codes = new Set();
  for (let k = 0; k < 3; k++) {
    const kurs = await H.erwarte(await admin.post('/api/lehrkraft/kurse').send({ name: 'Kurs ' + k }), 201);
    for (let i = 0; i < 15; i++) codes.add((await H.schuelerClient(app, kurs.code, `Held ${i}`)).code);
  }
  assert.equal(codes.size, 45);
  const db = app.locals.ctx.db;
  assert.equal(db.prepare('SELECT COUNT(DISTINCT code) AS n FROM schueler').get().n, 45);
});

test('Rate-Limit: Schüler-Anmeldung nach 8 Fehlversuchen je Name gesperrt', async () => {
  const app = H.makeApp();
  const c = H.client(app);
  for (let i = 0; i < 8; i++) assert.equal((await c.post('/api/schueler/anmelden').send({ name: 'Rio', code: 'AAA-222' })).status, 401);
  const r = await c.post('/api/schueler/anmelden').send({ name: 'Rio', code: 'AAA-222' });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers['retry-after']) > 0);
});

test('Freischaltung je Plattform: nur eingetragene, nicht vorläufige Plattformen', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  H.plattformEintragen(app, { id: 'algoquest' });
  await H.erwarte(await admin.post('/api/admin/plattformen/vorlaeufig').send({ id: 'automatenlab', basis: 'https://automatenlab.example', name: 'AutomatenLab', themenfeld: 'Automaten und formale Sprachen', farbe: '#548235' }), 201);
  const lk = await H.lehrkraftClient(app, admin);
  let r = await admin.put(`/api/admin/lehrkraefte/${lk.id}/plattformen`).send({ plattformen: ['automatenlab'] });
  assert.equal(r.status, 400);
  r = await admin.put(`/api/admin/lehrkraefte/${lk.id}/plattformen`).send({ plattformen: ['gibtsnicht'] });
  assert.equal(r.status, 400);
  r = await H.erwarte(await admin.put(`/api/admin/lehrkraefte/${lk.id}/plattformen`).send({ plattformen: ['algoquest'] }), 200);
  assert.deepEqual(r.plattformen, ['algoquest']);
  const wahl = await H.erwarte(await lk.get('/api/lehrkraft/plattformen'), 200);
  assert.deepEqual(wahl.plattformen.map((p) => p.id), ['algoquest']);
});

test('Admin-Konto heißt „Admin“ (Rolle bleibt superadmin); früherer Name „Superadmin“ wird beim Start umbenannt', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const ich = await H.erwarte(await admin.get('/api/lehrkraft/ich'), 200);
  assert.equal(ich.name, 'Admin');
  assert.equal(ich.rolle, 'superadmin');
  const db = app.locals.ctx.db;
  db.prepare("UPDATE lehrkraefte SET name = 'Superadmin' WHERE rolle = 'superadmin'").run();
  app.locals.dienste.konten.sichereSuperadmin(H.ADMIN_EMAIL, H.ADMIN_PW);
  assert.equal(db.prepare("SELECT name FROM lehrkraefte WHERE rolle = 'superadmin'").get().name, 'Admin');
  // ein selbst gewählter Name bleibt
  db.prepare("UPDATE lehrkraefte SET name = 'Schuladmin' WHERE rolle = 'superadmin'").run();
  app.locals.dienste.konten.sichereSuperadmin(H.ADMIN_EMAIL, H.ADMIN_PW);
  assert.equal(db.prepare("SELECT name FROM lehrkraefte WHERE rolle = 'superadmin'").get().name, 'Schuladmin');
});

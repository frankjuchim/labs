'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

async function aufbau(extra) {
  const app = H.makeApp(extra);
  const admin = await H.adminClient(app);
  H.plattformEintragen(app, { id: 'algoquest' });
  H.plattformEintragen(app, { id: 'zweitlab' });
  const lk = await H.lehrkraftClient(app, admin, { plattformen: ['algoquest'] });
  return { app, admin, lk };
}

test('Kurs anlegen: nur freigeschaltete Plattformen, Standard-Ablauf 31.07.', async () => {
  const { lk } = await aufbau({ now: H.uhr(Date.parse('2026-10-08T08:00:00Z')) });
  let r = await lk.post('/api/lehrkraft/kurse').send({ name: 'LK 13', plattformen: ['zweitlab'] });
  assert.equal(r.status, 403, 'nicht freigeschaltete Plattform');
  r = await lk.post('/api/lehrkraft/kurse').send({ name: 'LK 13', plattformen: ['gibtsnicht'] });
  assert.equal(r.status, 400);
  const k = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'LK 13', plattformen: ['algoquest'] }), 201);
  assert.equal(k.ablauf, '2027-07-31');
  assert.equal(k.kursId, 'k:' + k.id);
  assert.equal(k.rolle, 'inhaber');
  assert.deepEqual(k.plattformen.map((p) => [p.id, p.aktiv]), [['algoquest', true]]);
  assert.equal(k.link, `${H.ORIGIN}/?kurs=${k.code}`);
  r = await lk.post('/api/lehrkraft/kurse').send({ name: 'X', ablauf: '2029-01-01' });
  assert.equal(r.status, 400, 'höchstens 24 Monate');
  r = await lk.post('/api/lehrkraft/kurse').send({ name: 'Kurs Frühjahr', ablauf: '2027-02-28' });
  assert.equal(r.status, 201);
});

test('Kurs: umbenennen, neuer Kurscode, Beitritt schließen, QR-Code, löschen mit Bestätigung', async () => {
  const { app, lk } = await aufbau();
  const k = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'LK 13' }), 201);
  const k2 = await H.erwarte(await lk.patch(`/api/lehrkraft/kurse/${k.id}`).send({ name: 'LK 13 (2026/27)', beitrittOffen: false }), 200);
  assert.equal(k2.name, 'LK 13 (2026/27)');
  assert.equal((await H.client(app).post('/api/schueler/beitreten').send({ kurscode: k.code, name: 'Kim' })).status, 403);
  const k3 = await H.erwarte(await lk.post(`/api/lehrkraft/kurse/${k.id}/neuer-kurscode`).send({}), 200);
  assert.notEqual(k3.code, k.code);
  const qr = await lk.get(`/api/lehrkraft/kurse/${k.id}/qr.svg`);
  assert.equal(qr.status, 200);
  assert.match(qr.headers['content-type'], /image\/svg\+xml/);
  assert.match(qr.text || qr.body.toString(), /<svg/);
  assert.equal((await lk.delete(`/api/lehrkraft/kurse/${k.id}`).send({ bestaetigung: 'falsch' })).status, 400);
  await H.erwarte(await lk.delete(`/api/lehrkraft/kurse/${k.id}`).send({ bestaetigung: 'LK 13 (2026/27)' }), 200);
  assert.equal((await lk.get(`/api/lehrkraft/kurse/${k.id}`)).status, 404);
});

test('Fremde Kurse sind unsichtbar (404), Superadmin sieht alle', async () => {
  const { app, admin, lk } = await aufbau();
  const andere = await H.lehrkraftClient(app, admin);
  const k = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'Mein Kurs' }), 201);
  assert.equal((await andere.get(`/api/lehrkraft/kurse/${k.id}`)).status, 404);
  assert.equal((await andere.get(`/api/lehrkraft/kurse/${k.id}/schueler`)).status, 404);
  assert.equal((await andere.patch(`/api/lehrkraft/kurse/${k.id}`).send({ name: 'Gekapert' })).status, 404);
  assert.deepEqual((await andere.get('/api/lehrkraft/kurse')).body.kurse, []);
  const alle = await H.erwarte(await admin.get('/api/lehrkraft/kurse'), 200);
  assert.ok(alle.kurse.some((x) => x.id === k.id && x.rolle === 'superadmin'));
});

test('Schülerliste mit Code; umbenennen, neuer Code (alte Sitzung endet), entfernen', async () => {
  const { app, lk } = await aufbau();
  const k = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'LK 13' }), 201);
  const s1 = await H.schuelerClient(app, k.code, 'Ada L.');
  await H.schuelerClient(app, k.code, 'Kim T.');
  let liste = (await H.erwarte(await lk.get(`/api/lehrkraft/kurse/${k.id}/schueler`), 200)).schueler;
  assert.deepEqual(liste.map((s) => s.name), ['Ada L.', 'Kim T.']);
  const ada = liste[0];
  assert.equal(ada.code, s1.code);
  assert.match(ada.sub, /^s:\d+$/);
  assert.equal((await lk.patch(`/api/lehrkraft/kurse/${k.id}/schueler/${ada.id}`).send({ name: 'kim t.' })).status, 409);
  await H.erwarte(await lk.patch(`/api/lehrkraft/kurse/${k.id}/schueler/${ada.id}`).send({ name: 'Ada M.' }), 200);
  const neu = await H.erwarte(await lk.post(`/api/lehrkraft/kurse/${k.id}/schueler/${ada.id}/neuer-code`).send({}), 200);
  assert.notEqual(neu.code, s1.code);
  assert.equal((await s1.get('/api/schueler/ich')).status, 401, 'alte Sitzung beendet');
  const r = await H.erwarte(await lk.delete(`/api/lehrkraft/kurse/${k.id}/schueler/${ada.id}`), 200);
  assert.deepEqual(r, { entfernt: 1, kontoGeloescht: true });
  liste = (await lk.get(`/api/lehrkraft/kurse/${k.id}/schueler`)).body.schueler;
  assert.deepEqual(liste.map((s) => s.name), ['Kim T.']);
});

test('Schüler in zwei Kursen: Entfernen aus einem Kurs löscht das Konto nicht; Kurslöschung löscht Schüler ohne Kurs', async () => {
  const { app, lk } = await aufbau();
  const k1 = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'Kurs 1' }), 201);
  const k2 = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'Kurs 2' }), 201);
  const beide = await H.schuelerClient(app, k1.code, 'Beide');
  await beide.post('/api/schueler/kurse').send({ kurscode: k2.code });
  await H.schuelerClient(app, k1.code, 'Nur Eins');
  const id = (await lk.get(`/api/lehrkraft/kurse/${k1.id}/schueler`)).body.schueler.find((s) => s.name === 'Beide').id;
  assert.deepEqual((await lk.delete(`/api/lehrkraft/kurse/${k1.id}/schueler/${id}`)).body, { entfernt: 1, kontoGeloescht: false });
  await H.erwarte(await beide.get('/api/schueler/ich'), 200);
  await beide.post('/api/schueler/kurse').send({ kurscode: k1.code });
  const r = await H.erwarte(await lk.delete(`/api/lehrkraft/kurse/${k1.id}`).send({ bestaetigung: 'Kurs 1' }), 200);
  assert.deepEqual(r, { kurs: 1, schueler: 1 }, '„Nur Eins“ wird mitgelöscht, „Beide“ bleibt');
  await H.erwarte(await beide.get('/api/schueler/ich'), 200);
  assert.equal(app.locals.ctx.db.prepare('SELECT COUNT(*) AS n FROM schueler').get().n, 1);
});

test('Mitlehrkräfte: Einladung per E-Mail, annehmen, Rechte eingeschränkt, austreten', async () => {
  const { app, admin, lk } = await aufbau();
  const mit = await H.lehrkraftClient(app, admin);
  const k = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'LK 13', plattformen: ['algoquest'] }), 201);
  assert.equal((await lk.post(`/api/lehrkraft/kurse/${k.id}/einladungen`).send({ email: lk.email })).status, 409);
  await H.erwarte(await lk.post(`/api/lehrkraft/kurse/${k.id}/einladungen`).send({ email: mit.email }), 201);
  const ein = (await H.erwarte(await mit.get('/api/lehrkraft/einladungen'), 200)).einladungen;
  assert.equal(ein.length, 1);
  assert.equal(ein[0].kurs, 'LK 13');
  await H.erwarte(await mit.post(`/api/lehrkraft/einladungen/${ein[0].id}`).send({ annehmen: true }), 200);
  const sicht = await H.erwarte(await mit.get(`/api/lehrkraft/kurse/${k.id}`), 200);
  assert.equal(sicht.rolle, 'mitlehrkraft');
  // Mitlehrkraft: Schüler verwalten ja, Kurs löschen/Plattformen/Einladen nein
  assert.equal((await mit.delete(`/api/lehrkraft/kurse/${k.id}`).send({ bestaetigung: 'LK 13' })).status, 403);
  assert.equal((await mit.patch(`/api/lehrkraft/kurse/${k.id}`).send({ plattformen: [] })).status, 403);
  assert.equal((await mit.post(`/api/lehrkraft/kurse/${k.id}/einladungen`).send({ email: 'x@schule.example' })).status, 403);
  await H.erwarte(await mit.patch(`/api/lehrkraft/kurse/${k.id}`).send({ beitrittOffen: false }), 200);
  const inhaberSicht = await H.erwarte(await lk.get(`/api/lehrkraft/kurse/${k.id}`), 200);
  assert.deepEqual(inhaberSicht.lehrkraefte.map((l) => l.email), [mit.email]);
  await H.erwarte(await mit.delete(`/api/lehrkraft/kurse/${k.id}/lehrkraefte/${mit.id}`), 200);
  assert.equal((await mit.get(`/api/lehrkraft/kurse/${k.id}`)).status, 404);
});

test('Plattformen eines Kurses: abschalten bleibt bekannt (aktiv = false), wieder einschalten', async () => {
  const { app, lk } = await aufbau();
  const k = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'LK 13', plattformen: ['algoquest'] }), 201);
  let r = await H.erwarte(await lk.patch(`/api/lehrkraft/kurse/${k.id}`).send({ plattformen: [] }), 200);
  assert.deepEqual(r.plattformen.map((p) => [p.id, p.aktiv]), [['algoquest', false]]);
  const s = await H.schuelerClient(app, k.code, 'Lio');
  assert.deepEqual((await s.get('/api/schueler/ich')).body.kurse[0].plattformen, []);
  r = await H.erwarte(await lk.patch(`/api/lehrkraft/kurse/${k.id}`).send({ plattformen: ['algoquest'] }), 200);
  assert.deepEqual(r.plattformen.map((p) => [p.id, p.aktiv]), [['algoquest', true]]);
  const ich = (await s.get('/api/schueler/ich')).body;
  assert.equal(ich.kurse[0].plattformen[0].id, 'algoquest');
  assert.equal(ich.kurse[0].plattformen[0].link, 'https://algoquest.example/sso/start', 'Einstieg über den SSO-Start der Plattform');
});

test('Ablauf: Kurse nach dem Ablaufdatum werden gelöscht (inkl. Schüler ohne weiteren Kurs)', async () => {
  const u = H.uhr(Date.parse('2026-10-08T08:00:00Z'));
  const { app, lk } = await aufbau({ now: u });
  const k = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'Kurzkurs', ablauf: '2026-12-31' }), 201);
  await H.schuelerClient(app, k.code, 'Pia');
  u.vor(80 * 24 * 3600 * 1000); // 27.12.
  const bald = await H.erwarte(await lk.get(`/api/lehrkraft/kurse/${k.id}`), 200);
  assert.equal(bald.ablaufBald, true);
  assert.deepEqual((await app.locals.wartung.lauf()).abgelaufen, { kurse: 0, schueler: 0 });
  u.vor(5 * 24 * 3600 * 1000); // 01.01.
  assert.deepEqual((await app.locals.wartung.lauf()).abgelaufen, { kurse: 1, schueler: 1 });
  assert.equal(app.locals.ctx.db.prepare('SELECT COUNT(*) AS n FROM schueler').get().n, 0);
});

test('Lehrkraft löschen (Superadmin): eigene Kurse und deren Schüler werden gelöscht', async () => {
  const { app, admin, lk } = await aufbau();
  const k = await H.erwarte(await lk.post('/api/lehrkraft/kurse').send({ name: 'LK 13' }), 201);
  await H.schuelerClient(app, k.code, 'Ben');
  const r = await H.erwarte(await admin.delete(`/api/admin/lehrkraefte/${lk.id}`), 200);
  assert.deepEqual(r, { kurse: 1, schueler: 1 });
  assert.equal((await lk.get('/api/lehrkraft/ich')).status, 401);
});

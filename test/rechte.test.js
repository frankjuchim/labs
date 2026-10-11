'use strict';
// Rechte je Rolle und Schutzmechanismen (CSRF über Origin, JSON-Pflicht, Cookies, Kopfzeilen).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const H = require('./helpers');

const LEHRKRAFT = [
  ['get', '/api/lehrkraft/ich'],
  ['get', '/api/lehrkraft/kurse'],
  ['post', '/api/lehrkraft/kurse'],
  ['get', '/api/lehrkraft/kurse/1'],
  ['patch', '/api/lehrkraft/kurse/1'],
  ['delete', '/api/lehrkraft/kurse/1'],
  ['get', '/api/lehrkraft/kurse/1/schueler'],
  ['get', '/api/lehrkraft/kurse/1/qr.svg'],
  ['get', '/api/lehrkraft/einladungen'],
  ['get', '/api/lehrkraft/plattformen']
];
const ADMIN = [
  ['get', '/api/admin/uebersicht'],
  ['get', '/api/admin/lehrkraefte'],
  ['post', '/api/admin/lehrkraefte/1/status'],
  ['put', '/api/admin/lehrkraefte/1/plattformen'],
  ['delete', '/api/admin/lehrkraefte/1'],
  ['get', '/api/admin/plattformen'],
  ['post', '/api/admin/plattformen'],
  ['post', '/api/admin/plattformen/vorlaeufig'],
  ['patch', '/api/admin/plattformen/algoquest'],
  ['get', '/api/admin/schluessel'],
  ['get', '/api/admin/auftraege'],
  ['post', '/api/admin/import'],
  ['get', '/api/admin/importe'],
  ['get', '/api/admin/sicherung'],
  ['get', '/api/admin/sicherungen'],
  ['post', '/api/admin/wiederherstellen']
];
const SCHUELER = [
  ['get', '/api/schueler/ich'],
  ['post', '/api/schueler/kurse']
];

async function alle(c, liste) {
  const out = [];
  for (const [m, p] of liste) out.push((await c[m](p).send(m === 'get' ? undefined : {})).status);
  return out;
}

test('ohne Anmeldung: 401 für Schüler-, Lehrkraft- und Admin-API', async () => {
  const app = H.makeApp();
  const c = H.client(app);
  for (const s of await alle(c, [...SCHUELER, ...LEHRKRAFT, ...ADMIN])) assert.equal(s, 401);
});

test('Schüler: kein Zugang zu Lehrkraft- und Admin-API', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const k = (await admin.post('/api/lehrkraft/kurse').send({ name: 'Kurs K' })).body;
  const s = await H.schuelerClient(app, k.code, 'Ida');
  for (const st of await alle(s, [...LEHRKRAFT, ...ADMIN])) assert.equal(st, 401);
});

test('Lehrkraft: kein Zugang zur Admin-API (403), keine Schüler-API (401)', async () => {
  const app = H.makeApp();
  const admin = await H.adminClient(app);
  const lk = await H.lehrkraftClient(app, admin);
  for (const st of await alle(lk, ADMIN)) assert.equal(st, 403);
  for (const st of await alle(lk, SCHUELER)) assert.equal(st, 401);
});

test('CSRF: schreibende Anfragen nur mit gleicher Herkunft und als JSON', async () => {
  const app = H.makeApp();
  let r = await request(app).post('/api/lehrkraft/anmelden').set('Host', H.HOST).send({ email: 'admin', passwort: H.ADMIN_PW });
  assert.equal(r.status, 403, 'ohne Origin');
  r = await request(app).post('/api/lehrkraft/anmelden').set('Host', H.HOST).set('Origin', 'https://boese.example').send({ email: 'admin', passwort: H.ADMIN_PW });
  assert.equal(r.status, 403, 'fremde Origin');
  r = await request(app).post('/api/lehrkraft/anmelden').set('Host', H.HOST).set('Origin', H.ORIGIN).type('form').send('email=admin');
  assert.equal(r.status, 415, 'kein JSON');
});

test('Sitzungs-Cookie: httpOnly, SameSite=Lax, signiert; Manipulation wird abgewiesen', async () => {
  const app = H.makeApp();
  const r = await H.client(app).post('/api/lehrkraft/anmelden').send({ email: 'admin', passwort: H.ADMIN_PW });
  const cookie = r.headers['set-cookie'][0];
  assert.match(cookie, /^ilp_s=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const wert = decodeURIComponent(cookie.split(';')[0].slice('ilp_s='.length));
  const [body, mac] = wert.split('.');
  const daten = JSON.parse(Buffer.from(body, 'base64url').toString());
  daten.id = daten.id + 1;
  const gefaelscht = Buffer.from(JSON.stringify(daten)).toString('base64url') + '.' + mac;
  const r2 = await request(app).get('/api/lehrkraft/ich').set('Cookie', 'ilp_s=' + encodeURIComponent(gefaelscht));
  assert.equal(r2.status, 401);
});

test('Sicherheits-Kopfzeilen: strikte CSP ohne Inline-Skripte, noindex, kein X-Powered-By', async () => {
  const app = H.makeApp();
  const r = await request(app).get('/healthz');
  assert.deepEqual(r.body, { status: 'ok', version: require('../package.json').version });
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(r.headers['x-powered-by'], undefined);
  const api = await request(app).get('/api/sitzung');
  assert.equal(api.headers['cache-control'], 'no-store');
});

test('Öffentliche Plattform-Übersicht verrät keine internen Angaben', async () => {
  const app = H.makeApp();
  H.plattformEintragen(app, { id: 'algoquest' });
  const r = await request(app).get('/api/plattformen');
  const p = r.body.plattformen[0];
  for (const k of ['ruecksprung', 'pruefung', 'manifest', 'aktiv']) assert.equal(p[k], undefined, k);
  assert.equal(p.links.gast, 'https://algoquest.example/gast');
});

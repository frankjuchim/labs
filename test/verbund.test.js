'use strict';
// Verbund-API (Portal → Plattform, §6) und Plattform-Verwaltung (§7, §12) gegen die Test-Plattform.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers');
const { signiere } = require('../src/jwt');
const { pruefeManifest } = require('../scripts/vertrag_pruefen');

let v;
let admin;

async function api(b, method, pfad, body) {
  const r = await b.anfrage(v.portalUrl + pfad, { method, body: body === undefined && method !== 'GET' ? {} : body });
  return { status: r.status, body: await r.json().catch(() => null) };
}

before(async () => {
  v = await H.verbundAufbau();
  admin = new H.Browser();
  await api(admin, 'POST', '/api/lehrkraft/anmelden', { email: H.ADMIN_EMAIL, passwort: H.ADMIN_PW });
  await api(admin, 'POST', '/api/admin/plattformen', { basis: v.tpUrl });
  await api(admin, 'PATCH', '/api/admin/plattformen/testlabor', { ruecksprung: v.tpUrl + '/sso/ende' });
});
after(() => v.schliessen());

const verarbeite = () => v.portal.locals.dienste.verbund.verarbeite();

/** Schüler beitreten lassen und einmal per SSO auf die Test-Plattform schicken. */
async function schuelerMitSso(kurscode, name) {
  const b = new H.Browser();
  const r = await api(b, 'POST', '/api/schueler/beitreten', { kurscode, name });
  assert.equal(r.status, 201);
  const ende = await b.besuche(`${v.tpUrl}/sso/start`);
  assert.equal(ende.antwort.status, 200, ende.kette.join(' → '));
  return b;
}

test('Manifest der Test-Plattform ist vertragsgemäß (pruefeManifest aus Algo Quest)', async () => {
  const m = await (await fetch(v.tpUrl + '/api/plattform')).json();
  assert.deepEqual(pruefeManifest(m), []);
  const p = await api(admin, 'GET', '/api/admin/plattformen');
  const tl = p.body.plattformen.find((x) => x.id === 'testlabor');
  assert.equal(tl.status, 'ok', JSON.stringify(tl.pruefung));
  assert.equal(tl.version, '1.0.0');
});

test('Kurs löschen → POST /api/verbund/loeschen {kurs}; Schüler ohne Kurs → {sub}', async () => {
  const k = (await api(admin, 'POST', '/api/lehrkraft/kurse', { name: 'Löschkurs', plattformen: ['testlabor'] })).body;
  const b = await schuelerMitSso(k.code, 'Kurzzeit');
  const sub = (await (await b.anfrage(v.tpUrl + '/api/ich')).json()).sub;
  assert.ok(v.tp.locals.daten.kurse.has(k.kursId));
  assert.equal((await api(admin, 'DELETE', `/api/lehrkraft/kurse/${k.id}`, { bestaetigung: 'Löschkurs' })).status, 200);
  await verarbeite();
  const prot = v.tp.locals.daten.protokoll;
  assert.ok(prot.some((p) => p.zweck === 'loeschen' && p.kurs === k.kursId));
  assert.ok(prot.some((p) => p.zweck === 'loeschen' && p.sub === sub));
  assert.equal(v.tp.locals.daten.kurse.has(k.kursId), false);
  assert.equal(v.tp.locals.daten.konten.has(sub), false);
  const auftraege = (await api(admin, 'GET', '/api/admin/auftraege')).body.auftraege;
  assert.ok(auftraege.filter((a) => a.plattform === 'testlabor').every((a) => a.status === 'erledigt'));
});

test('Kurs umbenennen und Plattform abschalten → POST /api/verbund/kurse/:kursId', async () => {
  const k = (await api(admin, 'POST', '/api/lehrkraft/kurse', { name: 'Alter Name', plattformen: ['testlabor'] })).body;
  await api(admin, 'PATCH', `/api/lehrkraft/kurse/${k.id}`, { name: 'Neuer Name' });
  await api(admin, 'PATCH', `/api/lehrkraft/kurse/${k.id}`, { plattformen: [] });
  await verarbeite();
  const prot = v.tp.locals.daten.protokoll.filter((p) => p.kurs === k.kursId && p.zweck === 'kurs-aendern');
  assert.deepEqual(prot.map((p) => [p.name, p.aktiv]), [['Neuer Name', undefined], ['Neuer Name', false]]);
});

test('Kursübersicht: Kennzahlen der Plattform mit Namen aus dem Portal', async () => {
  const k = (await api(admin, 'POST', '/api/lehrkraft/kurse', { name: 'Übersichtskurs', plattformen: ['testlabor'] })).body;
  const b = await schuelerMitSso(k.code, 'Fleißig');
  await b.anfrage(v.tpUrl + '/api/punkte', { method: 'POST', body: { punkte: 42 } });
  const u = await api(admin, 'GET', `/api/lehrkraft/kurse/${k.id}/uebersicht/testlabor`);
  assert.equal(u.status, 200);
  assert.equal(u.body.verfuegbar, true);
  assert.deepEqual(u.body.schueler.map((s) => [s.name, s.punkte]), [['Fleißig', 42]]);
  assert.equal(u.body.welten[0].titel, 'Prüfwelt');
  assert.equal((await api(admin, 'GET', `/api/lehrkraft/kurse/${k.id}/uebersicht/algoquest`)).status, 404);
});

test('Aufträge werden wiederholt, wenn die Plattform nicht erreichbar ist', async () => {
  const k = (await api(admin, 'POST', '/api/lehrkraft/kurse', { name: 'Ausfallkurs', plattformen: ['testlabor'] })).body;
  const db = v.portal.locals.ctx.db;
  db.prepare("UPDATE plattformen SET basis = 'http://127.0.0.1:1' WHERE id = 'testlabor'").run();
  await api(admin, 'DELETE', `/api/lehrkraft/kurse/${k.id}`, { bestaetigung: 'Ausfallkurs' });
  await verarbeite();
  let a = (await api(admin, 'GET', '/api/admin/auftraege')).body.auftraege.find((x) => x.nutzlast && x.nutzlast.kurs === k.kursId);
  assert.equal(a.status, 'offen');
  assert.equal(a.versuche, 1);
  assert.match(a.fehler, /Nicht erreichbar/);
  db.prepare('UPDATE plattformen SET basis = ? WHERE id = ?').run(v.tpUrl, 'testlabor');
  await api(admin, 'POST', `/api/admin/auftraege/${a.id}/wiederholen`);
  await verarbeite();
  a = (await api(admin, 'GET', '/api/admin/auftraege')).body.auftraege.find((x) => x.id === a.id);
  assert.equal(a.status, 'erledigt');
});

test('Plattform-Seite der Verbund-API: falsches aud, falscher zweck, wiederverwendet → 401', async () => {
  const jetzt = Math.floor(Date.now() / 1000);
  const t = (extra) => signiere({ iss: v.portalUrl, aud: 'testlabor', sub: 'portal', zweck: 'loeschen', iat: jetzt, exp: jetzt + 30, jti: crypto.randomUUID(), v: 1, ...extra }, H.SCHLUESSEL);
  const post = (token) =>
    fetch(v.tpUrl + '/api/verbund/loeschen', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: 's:0' }) });
  assert.equal((await post(t({ aud: 'algoquest' }))).status, 401);
  assert.equal((await post(t({ zweck: 'kurs-aendern' }))).status, 401);
  assert.equal((await post(t({ exp: jetzt + 600 }))).status, 401, 'exp − iat > 60 s');
  const einmal = t();
  assert.equal((await post(einmal)).status, 200);
  assert.equal((await post(einmal)).status, 401);
  assert.equal((await fetch(v.tpUrl + '/api/verbund/loeschen', { method: 'POST' })).status, 401);
});

test('Plattform-Verwaltung: ungültige Basis, kein Manifest → vorläufig, Rücksprung nur auf der Plattform', async () => {
  assert.equal((await api(admin, 'POST', '/api/admin/plattformen', { basis: 'ftp://x.example' })).status, 400);
  assert.equal((await api(admin, 'POST', '/api/admin/plattformen', { basis: v.tpUrl + '/pfad' })).status, 400);
  assert.equal((await api(admin, 'POST', '/api/admin/plattformen', { basis: v.tpUrl })).status, 409);
  const ohne = await api(admin, 'POST', '/api/admin/plattformen', { basis: v.portalUrl.replace(/:\d+$/, ':1') });
  assert.equal(ohne.status, 400);
  assert.equal(ohne.body.details.vorlaeufigMoeglich, true);
  assert.equal((await api(admin, 'PATCH', '/api/admin/plattformen/testlabor', { ruecksprung: 'https://boese.example/sso/ende' })).status, 400);
  const vl = await api(admin, 'POST', '/api/admin/plattformen/vorlaeufig', {
    id: 'automatenlab', basis: 'https://automatenlab.example', name: 'AutomatenLab', themenfeld: 'Automaten und formale Sprachen', farbe: '#548235', beschreibung: 'Maschinen, die Sprache verstehen'
  });
  assert.equal(vl.status, 201);
  assert.equal(vl.body.status, 'vorlaeufig');
  const oeff = (await api(new H.Browser(), 'GET', '/api/plattformen')).body.plattformen;
  const al = oeff.find((p) => p.id === 'automatenlab');
  assert.equal(al.vorlaeufig, true);
  assert.equal(al.sso, false);
  assert.equal(al.links.start, 'https://automatenlab.example/');
  assert.equal(oeff.find((p) => p.id === 'testlabor').sso, true);
  // Niveaus (Vertrag §7/§9): aus dem Manifest bzw. Standard eA und gA, Link zur Niveau-Übersicht
  assert.deepEqual(oeff.find((p) => p.id === 'testlabor').niveaus, ['eA', 'gA']);
  assert.equal(oeff.find((p) => p.id === 'testlabor').links.niveaus, v.tpUrl + '/niveaus');
  assert.deepEqual(al.niveaus, ['eA', 'gA'], 'ohne Angabe: eA und gA');
  assert.equal(al.links.niveaus, null);
  // vorläufige Plattform nicht für Kurse wählbar und kein SSO
  assert.equal((await api(admin, 'POST', '/api/lehrkraft/kurse', { name: 'X', plattformen: ['automatenlab'] })).status, 400);
  const state = crypto.randomBytes(16).toString('base64url');
  const r = await admin.anfrage(`${v.portalUrl}/sso/autorisieren?plattform=automatenlab&ruecksprung=${encodeURIComponent('https://automatenlab.example/sso/ende')}&state=${state}`);
  assert.equal(r.status, 400);
});

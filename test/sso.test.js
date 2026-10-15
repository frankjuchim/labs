'use strict';
// Single Sign-on Ende-zu-Ende: Portal und Test-Plattform auf echten Ports, „Browser“ mit Cookies und Weiterleitungen.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers');
const { signiere } = require('../src/jwt');
const { neuesPaar } = require('../src/schluessel');

let v; // Verbund-Aufbau
let admin;
let kurs;

/** Admin-Aufrufe gegen das echte Portal (Browser mit Cookie). */
async function api(b, method, pfad, body) {
  const r = await b.anfrage(v.portalUrl + pfad, { method, body: body === undefined && method !== 'GET' ? {} : body });
  const daten = await r.json().catch(() => null);
  return { status: r.status, body: daten };
}

before(async () => {
  v = await H.verbundAufbau();
  admin = new H.Browser();
  assert.equal((await api(admin, 'POST', '/api/lehrkraft/anmelden', { email: H.ADMIN_EMAIL, passwort: H.ADMIN_PW })).status, 200);
  const p = await api(admin, 'POST', '/api/admin/plattformen', { basis: v.tpUrl });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.id, 'testlabor');
  assert.equal(p.body.ruecksprungVorschlag, v.tpUrl + '/sso/ende');
  assert.equal((await api(admin, 'PATCH', '/api/admin/plattformen/testlabor', { ruecksprung: v.tpUrl + '/sso/ende' })).status, 200);
  kurs = (await api(admin, 'POST', '/api/lehrkraft/kurse', { name: 'LK Informatik 13', plattformen: ['testlabor'] })).body;
});

after(() => v.schliessen());

/** Schüler im Portal anlegen (Beitritt) – liefert Browser mit Portal-Sitzung. */
async function schueler(name, kurscode = kurs.code) {
  const b = new H.Browser();
  const r = await api(b, 'POST', '/api/schueler/beitreten', { kurscode, name });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  b.code = r.body.code;
  return b;
}

/** SSO bis zur Token-Übergabe laufen lassen und die Rücksprung-URL (mit Token) liefern, ohne sie aufzurufen. */
async function holeRuecksprung(b, ziel = '/') {
  const start = await b.anfrage(`${v.tpUrl}/sso/start?ziel=${encodeURIComponent(ziel)}`);
  assert.equal(start.status, 302);
  const auth = await b.anfrage(start.headers.get('location'));
  assert.equal(auth.status, 302);
  assert.equal(auth.headers.get('referrer-policy'), 'no-referrer');
  return new URL(auth.headers.get('location'));
}

const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));

test('Schüler: Plattform → Portal (Anmeldung) → Plattform, Token exakt nach §5', async () => {
  const b = new H.Browser();
  const vorher = await schueler('Lena S.');
  // neuer Browser ohne Portal-Sitzung: Weiterleitung zur Anmeldeseite
  const start = await b.besuche(`${v.tpUrl}/sso/start?ziel=/aufgaben`);
  assert.match(start.url, /\/anmelden\?weiter=%2Fsso%2Fautorisieren/);
  assert.equal(start.antwort.status, 200);
  // Anmeldung mit Name + Code, danach ruft die Seite „weiter“ auf
  assert.equal((await api(b, 'POST', '/api/schueler/anmelden', { name: 'Lena S.', code: vorher.code })).status, 200);
  const weiter = decodeURIComponent(new URL(start.url).searchParams.get('weiter'));
  const auth = await b.anfrage(v.portalUrl + weiter);
  assert.equal(auth.status, 302);
  const ruecksprung = new URL(auth.headers.get('location'));
  assert.equal(ruecksprung.origin + ruecksprung.pathname, v.tpUrl + '/sso/ende');
  assert.equal(ruecksprung.searchParams.get('ziel'), '/aufgaben');
  const t = decode(ruecksprung.searchParams.get('token'));
  assert.deepEqual(Object.keys(t).sort(), ['aud', 'exp', 'iat', 'iss', 'jti', 'kurse', 'name', 'rolle', 'sub', 'v'].sort());
  assert.equal(t.iss, v.portalUrl);
  assert.equal(t.aud, 'testlabor');
  assert.match(t.sub, /^s:\d+$/);
  assert.equal(t.rolle, 'schueler');
  assert.equal(t.name, 'Lena S.');
  assert.deepEqual(t.kurse, [{ id: kurs.kursId, name: 'LK Informatik 13', rolle: 'mitglied' }]);
  assert.ok(t.exp - t.iat <= 120 && t.exp > t.iat);
  assert.equal(t.v, 1);
  assert.ok(t.jti.length >= 16);
  const kopf = JSON.parse(Buffer.from(ruecksprung.searchParams.get('token').split('.')[0], 'base64url').toString());
  assert.equal(kopf.alg, 'EdDSA');
  // Plattform nimmt das Token an und leitet auf ziel
  const ende = await b.anfrage(ruecksprung.href);
  assert.equal(ende.status, 302);
  assert.equal(ende.headers.get('location'), '/aufgaben');
  const ich = await (await b.anfrage(v.tpUrl + '/api/ich')).json();
  assert.equal(ich.sub, t.sub);
  assert.deepEqual(ich.kurse, [{ id: kurs.kursId, rolle: 'mitglied' }]);
  // zweiter Besuch: Portal-Sitzung besteht → ohne Anmeldeseite direkt zurück
  const zweit = await b.besuche(`${v.tpUrl}/sso/start`);
  assert.equal(zweit.kette.length, 4, zweit.kette.join(' → '));
  assert.equal(zweit.antwort.status, 200);
});

test('Plattform lehnt ab: wiederverwendetes Token', async () => {
  const b = await schueler('Wiederholer');
  const ruecksprung = await holeRuecksprung(b);
  assert.equal((await b.anfrage(ruecksprung.href)).status, 302);
  // Angreifer kennt die URL (z. B. aus einem Verlauf) – gleicher state-Cookie simuliert
  const c = await holeRuecksprung(b); // neuer state-Cookie im Browser
  const replay = new URL(ruecksprung.href);
  replay.searchParams.set('state', c.searchParams.get('state'));
  const r = await b.anfrage(replay.href);
  assert.equal(r.status, 401);
  assert.match(await r.text(), /wiederverwendet/);
});

test('Plattform lehnt ab: falsche Signatur, falsches aud, abgelaufen, falscher state', async () => {
  const b = await schueler('Prüferin');
  const fremd = neuesPaar();
  const jetzt = Math.floor(Date.now() / 1000);
  const basis = { iss: v.portalUrl, aud: 'testlabor', sub: 's:999', rolle: 'schueler', name: 'X', kurse: [], iat: jetzt, exp: jetzt + 90, v: 1 };
  const portalKey = H.SCHLUESSEL;
  const faelle = [
    ['signatur', signiere({ ...basis, jti: crypto.randomUUID() }, fremd)],
    ['aud', signiere({ ...basis, aud: 'algoquest', jti: crypto.randomUUID() }, portalKey)],
    ['abgelaufen', signiere({ ...basis, iat: jetzt - 200, exp: jetzt - 100, jti: crypto.randomUUID() }, portalKey)],
    ['dauer', signiere({ ...basis, exp: jetzt + 600, jti: crypto.randomUUID() }, portalKey)],
    ['iss', signiere({ ...basis, iss: 'https://falsches-portal.example', jti: crypto.randomUUID() }, portalKey)]
  ];
  for (const [grund, token] of faelle) {
    const ruecksprung = await holeRuecksprung(b); // setzt einen frischen state-Cookie
    ruecksprung.searchParams.set('token', token);
    const r = await b.anfrage(ruecksprung.href);
    assert.equal(r.status, 401, grund);
    assert.match(await r.text(), new RegExp(grund), grund);
  }
  // echtes Token, aber falscher state
  const ruecksprung = await holeRuecksprung(b);
  ruecksprung.searchParams.set('state', 'A'.repeat(22));
  const r = await b.anfrage(ruecksprung.href);
  assert.equal(r.status, 401);
  assert.match(await r.text(), /state/);
});

test('Portal: Rücksprung nicht freigegeben, unbekannte Plattform, state zu kurz → Fehlerseite ohne Weiterleitung', async () => {
  const b = await schueler('Neugier');
  const state = crypto.randomBytes(16).toString('base64url');
  const faelle = [
    `plattform=testlabor&ruecksprung=${encodeURIComponent('https://boese.example/sso/ende')}&state=${state}`,
    `plattform=testlabor&ruecksprung=${encodeURIComponent(v.tpUrl + '/sso/ende/')}&state=${state}`,
    `plattform=unbekannt&ruecksprung=${encodeURIComponent(v.tpUrl + '/sso/ende')}&state=${state}`,
    `plattform=testlabor&ruecksprung=${encodeURIComponent(v.tpUrl + '/sso/ende')}&state=kurz`
  ];
  for (const q of faelle) {
    const r = await b.anfrage(`${v.portalUrl}/sso/autorisieren?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.headers.get('location'), null);
    assert.match(r.headers.get('content-type'), /text\/html/);
  }
  // ungültiges ziel wird auf „/“ gesetzt (keine fremden Ziele)
  const r = await b.anfrage(`${v.portalUrl}/sso/autorisieren?plattform=testlabor&ruecksprung=${encodeURIComponent(v.tpUrl + '/sso/ende')}&state=${state}&ziel=${encodeURIComponent('//boese.example')}`);
  assert.equal(new URL(r.headers.get('location')).searchParams.get('ziel'), '/');
});

test('Portal: Schüler ohne Kurs auf der Plattform → keine_berechtigung; Abbrechen → abgebrochen', async () => {
  const k2 = (await api(admin, 'POST', '/api/lehrkraft/kurse', { name: 'Ohne Plattform' })).body;
  const b = await schueler('Ohnekurs', k2.code);
  const r = await holeRuecksprung(b);
  assert.equal(r.searchParams.get('fehler'), 'keine_berechtigung');
  assert.equal(r.searchParams.get('token'), null);
  const ende = await b.anfrage(r.href);
  assert.equal(ende.status, 403);
  assert.equal(ende.headers.get('set-cookie').includes('tp_sitzung'), false, 'keine Sitzung');
  const text = await ende.text();
  assert.match(text, /Kein Zugang\./);
  assert.match(text, /Schülerinnen und Schüler: Die Lehrkraft muss die Plattform im Portal für den Kurs freischalten\./);
  assert.match(text, /Lehrkräfte: Die Freischaltung der Plattform erteilt die Administration im Portal/);
  assert.ok(text.includes(`href="${v.portalUrl}/"`), 'Link zurück zum Portal');
  assert.ok(v.tp.locals.daten.abgelehnt.includes('portal:keine_berechtigung'));

  // Abbrechen auf der Anmeldeseite (ohne Sitzung)
  const neu = new H.Browser();
  const start = await neu.anfrage(`${v.tpUrl}/sso/start`);
  const auth = new URL(start.headers.get('location'));
  const ab = await neu.anfrage(`${v.portalUrl}/sso/abbrechen${auth.search}`);
  assert.equal(new URL(ab.headers.get('location')).searchParams.get('fehler'), 'abgebrochen');
});

test('Lehrkraft: nur mit Freischaltung; Token enthält eigene Kurse als lehrkraft, Superadmin rolle superadmin', async () => {
  // Lehrkraft registrieren und freigeben, zunächst ohne Freischaltung
  const lk = new H.Browser();
  await api(lk, 'POST', '/api/lehrkraft/registrieren', { name: 'Lehrkraft SSO', email: 'sso@schule.example', schule: 'Testschule', passwort: 'lehrkraft-pw-123' });
  const id = (await api(admin, 'GET', '/api/admin/lehrkraefte')).body.lehrkraefte.find((l) => l.email === 'sso@schule.example').id;
  await api(admin, 'POST', `/api/admin/lehrkraefte/${id}/status`, { status: 'aktiv' });
  assert.equal((await api(lk, 'POST', '/api/lehrkraft/anmelden', { email: 'sso@schule.example', passwort: 'lehrkraft-pw-123' })).status, 200);
  let r = await holeRuecksprung(lk);
  assert.equal(r.searchParams.get('fehler'), 'keine_berechtigung');
  await api(admin, 'PUT', `/api/admin/lehrkraefte/${id}/plattformen`, { plattformen: ['testlabor'] });
  const k = (await api(lk, 'POST', '/api/lehrkraft/kurse', { name: 'GK 12', plattformen: ['testlabor'] })).body;
  r = await holeRuecksprung(lk);
  const t = decode(r.searchParams.get('token'));
  assert.equal(t.rolle, 'lehrkraft');
  assert.equal(t.sub, 'l:' + id);
  assert.deepEqual(t.kurse, [{ id: k.kursId, name: 'GK 12', rolle: 'lehrkraft' }]);
  // Superadmin: alle Kurse der Plattform
  const ra = await holeRuecksprung(admin);
  const ta = decode(ra.searchParams.get('token'));
  assert.equal(ta.rolle, 'superadmin');
  assert.equal(ta.name, 'Admin', 'Plattformen zeigen den Namen „Admin“');
  assert.match(ta.sub, /^a:\d+$/);
  assert.ok(ta.kurse.some((x) => x.id === k.kursId) && ta.kurse.some((x) => x.id === kurs.kursId));
});

test('Abmelden: Portal-Sitzung endet, Rücksprung nur zu eingetragenen Plattformen', async () => {
  const b = await schueler('Tschüss');
  await b.besuche(`${v.tpUrl}/sso/start`);
  const r = await b.anfrage(`${v.tpUrl}/abmelden`);
  const ab = await b.anfrage(r.headers.get('location'));
  assert.equal(ab.status, 302);
  assert.equal(ab.headers.get('location'), v.tpUrl + '/');
  assert.equal((await api(b, 'GET', '/api/sitzung')).body.typ, null);
  const boese = await b.anfrage(`${v.portalUrl}/sso/abmelden?ruecksprung=${encodeURIComponent('https://boese.example/')}`);
  assert.equal(boese.headers.get('location'), '/');
});

test('Öffentlicher Schlüssel unter fester URL (PEM und JSON)', async () => {
  const pem = await (await fetch(v.portalUrl + '/sso/schluessel.pem')).text();
  assert.match(pem, /^-----BEGIN PUBLIC KEY-----/);
  const j = await (await fetch(v.portalUrl + '/api/portal/schluessel')).json();
  assert.equal(j.pem, pem);
  assert.equal(j.alg, 'EdDSA');
  assert.equal(crypto.createPublicKey(pem).asymmetricKeyType, 'ed25519');
});

test('/sso/start startet mit bestehender Sitzung neu: zweiter Kurs ist danach bekannt (§5, ab v1.3)', async () => {
  const b = await schueler('Zweikurs');
  assert.equal((await b.besuche(`${v.tpUrl}/sso/start`)).antwort.status, 200);
  let ich = await (await b.anfrage(v.tpUrl + '/api/ich')).json();
  assert.deepEqual(ich.kurse.map((k) => k.id), [kurs.kursId]);
  // im Portal einem zweiten Kurs beitreten (gleiches Konto)
  const k2 = (await api(admin, 'POST', '/api/lehrkraft/kurse', { name: 'GK 11', plattformen: ['testlabor'] })).body;
  const beitritt = await api(b, 'POST', '/api/schueler/kurse', { kurscode: k2.code });
  assert.equal(beitritt.status, 201, JSON.stringify(beitritt.body));
  // trotz Sitzung: /sso/start leitet zum Portal (nicht direkt auf ziel)
  const start = await b.anfrage(`${v.tpUrl}/sso/start`);
  assert.equal(start.status, 302);
  assert.ok(start.headers.get('location').startsWith(v.portalUrl + '/sso/autorisieren?'));
  assert.equal((await b.besuche(`${v.tpUrl}/sso/start`)).antwort.status, 200);
  ich = await (await b.anfrage(v.tpUrl + '/api/ich')).json();
  assert.deepEqual(ich.kurse.map((k) => k.id).sort(), [kurs.kursId, k2.kursId].sort());
  assert.ok(v.tp.locals.daten.kurse.get(k2.kursId).mitglieder.has(ich.sub));
});

test('Fehlgeschlagener Rücksprung lässt die bestehende Sitzung unverändert (§5, ab v1.3)', async () => {
  const b = await schueler('Bleibtdrin');
  assert.equal((await b.besuche(`${v.tpUrl}/sso/start`)).antwort.status, 200);
  const vorher = await (await b.anfrage(v.tpUrl + '/api/ich')).json();
  // ungültiges Token
  const r = await holeRuecksprung(b);
  r.searchParams.set('token', signiere({ iss: v.portalUrl, aud: 'testlabor', sub: 's:999', rolle: 'schueler', name: 'X', kurse: [], iat: 0, exp: 90, jti: crypto.randomUUID(), v: 1 }, neuesPaar()));
  const ende = await b.anfrage(r.href);
  assert.equal(ende.status, 401);
  assert.equal((ende.headers.get('set-cookie') || '').includes('tp_sitzung'), false);
  // abgebrochen
  const r2 = await holeRuecksprung(b);
  const ab = new URL(r2.href);
  for (const k of ['token', 'ziel']) ab.searchParams.delete(k);
  ab.searchParams.set('fehler', 'abgebrochen');
  assert.equal((await b.anfrage(ab.href)).status, 401);
  const nachher = await b.anfrage(v.tpUrl + '/api/ich');
  assert.equal(nachher.status, 200);
  assert.deepEqual(await nachher.json(), vorher);
});

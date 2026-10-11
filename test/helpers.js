'use strict';
// Gemeinsame Test-Helfer (node:test + supertest). Keine Klarnamen: nur Fantasienamen und example-Adressen.
process.env.PORTAL_SCRYPT_N = process.env.PORTAL_SCRYPT_N || '1024'; // schnelleres Hashing nur in Tests

const http = require('node:http');
const request = require('supertest');
const { createApp } = require('../src/app');
const { neuesPaar, ladeSchluessel } = require('../src/schluessel');
const { createTestplattform } = require('./testplattform/app');

const ADMIN_EMAIL = 'admin';
const ADMIN_PW = 'admin-passwort-123';
const HOST = 'portal.test';
const ORIGIN = 'http://' + HOST;
const SCHLUESSEL = neuesPaar();

/** Steuerbare Uhr. */
function uhr(start = Date.parse('2026-10-08T08:00:00Z')) {
  let t = start;
  const f = () => t;
  f.vor = (ms) => (t += ms);
  f.setze = (x) => (t = x);
  return f;
}

function makeApp(extra = {}) {
  return createApp({
    dbFile: ':memory:',
    sessionSecret: 'test-secret-0123456789abcdef',
    portalUrl: ORIGIN,
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PW,
    privateKeyPem: SCHLUESSEL,
    verbundAutomatisch: false,
    trustProxy: false,
    ...extra
  });
}

/** supertest-Agent mit Cookie-Speicher und gleicher Herkunft. */
function client(app) {
  const agent = request.agent(app);
  agent.set('Host', HOST).set('Origin', ORIGIN);
  return agent;
}

async function erwarte(r, status) {
  if (r.status !== status) throw new Error(`Erwartet ${status}, erhalten ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}

async function adminClient(app) {
  const c = client(app);
  await erwarte(await c.post('/api/lehrkraft/anmelden').send({ email: ADMIN_EMAIL, passwort: ADMIN_PW }), 200);
  return c;
}

let lkNr = 0;
/** Lehrkraft registrieren, freigeben, (optional) für Plattformen freischalten und anmelden. */
async function lehrkraftClient(app, admin, { email, pw = 'lehrkraft-pw-123', plattformen = [] } = {}) {
  email = email || `lehrkraft${++lkNr}@schule.example`;
  const c = client(app);
  await erwarte(await c.post('/api/lehrkraft/registrieren').send({ name: `Lehrkraft ${lkNr}`, email, schule: 'Testschule', passwort: pw }), 201);
  const liste = await erwarte(await admin.get('/api/admin/lehrkraefte'), 200);
  const lk = liste.lehrkraefte.find((l) => l.email === email);
  await erwarte(await admin.post(`/api/admin/lehrkraefte/${lk.id}/status`).send({ status: 'aktiv' }), 200);
  if (plattformen.length) await erwarte(await admin.put(`/api/admin/lehrkraefte/${lk.id}/plattformen`).send({ plattformen }), 200);
  await erwarte(await c.post('/api/lehrkraft/anmelden').send({ email, passwort: pw }), 200);
  c.id = lk.id;
  c.email = email;
  return c;
}

/** Schüler tritt mit Kurscode bei; liefert Client mit .code und .name. */
async function schuelerClient(app, kurscode, name) {
  const c = client(app);
  const b = await erwarte(await c.post('/api/schueler/beitreten').send({ kurscode, name }), 201);
  c.code = b.code;
  c.name = b.name;
  return c;
}

/** Plattform direkt in die Datenbank eintragen (ohne Netz), mit Manifest-Angaben. */
function plattformEintragen(app, { id = 'algoquest', basis, modus = 'beides', sso = true, ruecksprung } = {}) {
  basis = basis || `https://${id}.example`;
  const angaben = {
    name: id === 'algoquest' ? 'Algo Quest' : id,
    titel: id,
    themenfeld: 'Testthema',
    kurs: '',
    beschreibung: '',
    farbe: '#1F4E79',
    version: '1.0.0',
    vertrag: '1.0',
    urls: { start: '/', gast: '/gast', themen: '/themen', lehrkraft: '/lehrer', datenschutz: '/datenschutz', healthz: '/healthz', ssoStart: '/sso/start' },
    auth: { modus, sso },
    faehigkeiten: ['gast']
  };
  const manifest = { vertrag: '1.0', id, basis, auth: { modus, sso } };
  app.locals.ctx.db
    .prepare("INSERT INTO plattformen (id, basis, vorlaeufig, ruecksprung, angaben, manifest, pruefung, created_at) VALUES (?, ?, 0, ?, ?, ?, ?, '2026-10-01T00:00:00Z')")
    .run(id, basis, ruecksprung === undefined ? basis + '/sso/ende' : ruecksprung, JSON.stringify(angaben), JSON.stringify(manifest), JSON.stringify({ ok: true, fehler: [], warnungen: [] }));
  return { id, basis };
}

/* ---------- echte Server (für SSO- und Verbund-Tests) ---------- */

function lausche(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

/** Portal + Test-Plattform auf echten Ports. */
async function verbundAufbau({ portalExtra = {}, plattformExtra = {} } = {}) {
  const portalServer = http.createServer();
  const portalUrl = await lausche(portalServer);
  const portal = makeApp({ portalUrl, verbundAutomatisch: false, ...portalExtra });
  portalServer.on('request', portal);
  const tpServer = http.createServer();
  const tpUrl = await lausche(tpServer);
  const tp = createTestplattform({ basis: tpUrl, portalUrl, portalPublicKey: ladeSchluessel(SCHLUESSEL).pem, ...plattformExtra });
  tpServer.on('request', tp);
  const schliessen = () =>
    Promise.all(
      [portalServer, tpServer].map(
        (s) =>
          new Promise((r) => {
            s.close(r);
            s.closeAllConnections();
          })
      )
    );
  return { portal, portalUrl, tp, tpUrl, schliessen, portalServer, tpServer };
}

/** Sehr kleiner „Browser“: Cookie-Speicher je Host, Weiterleitungen manuell verfolgen. */
class Browser {
  constructor() {
    this.cookies = new Map(); // host → Map(name → wert)
  }
  _jar(url) {
    const h = new URL(url).host;
    if (!this.cookies.has(h)) this.cookies.set(h, new Map());
    return this.cookies.get(h);
  }
  async anfrage(url, { method = 'GET', body, headers = {} } = {}) {
    const jar = this._jar(url);
    const h = { ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      h.Origin = new URL(url).origin;
    }
    const r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) {
      const [paar, ...attr] = c.split(';').map((s) => s.trim());
      const i = paar.indexOf('=');
      const name = paar.slice(0, i);
      const wert = paar.slice(i + 1);
      if (attr.some((a) => /^max-age=0$/i.test(a)) || attr.some((a) => /^expires=Thu, 01 Jan 1970/i.test(a)) || wert === '') jar.delete(name);
      else jar.set(name, wert);
    }
    return r;
  }
  /** GET mit Weiterleitungen; liefert { antwort, kette: [urls] }. */
  async besuche(url, max = 10) {
    const kette = [url];
    let r = await this.anfrage(url);
    while (r.status >= 300 && r.status < 400 && max-- > 0) {
      const next = new URL(r.headers.get('location'), url).href;
      kette.push(next);
      url = next;
      r = await this.anfrage(url);
    }
    return { antwort: r, kette, url };
  }
}

module.exports = {
  ADMIN_EMAIL,
  ADMIN_PW,
  HOST,
  ORIGIN,
  SCHLUESSEL,
  uhr,
  makeApp,
  client,
  erwarte,
  adminClient,
  lehrkraftClient,
  schuelerClient,
  plattformEintragen,
  verbundAufbau,
  Browser
};

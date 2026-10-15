'use strict';
// Test-Plattform „Testlabor“: kleinste vertragsgemäße Plattform (VERTRAG.md v1.4, §5–§7) zum Ende-zu-Ende-Prüfen des
// Portals. Zugleich Referenz für docs/INTEGRATION.md – jede Prüfung hier MUSS auch eine echte Plattform machen.
// Daten liegen nur im Arbeitsspeicher. Nicht für den Betrieb gedacht.

const crypto = require('node:crypto');
const express = require('express');
const { pruefe, JtiSpeicher } = require('../../src/jwt');

const STATE_COOKIE = 'tp_state';
// Rollenneutraler Text bei fehler=keine_berechtigung (docs/INTEGRATION.md §3.2, ab v1.3) – die Plattform weiß hier nicht,
// wer anfragt.
const KEIN_ZUGANG = [
  'Kein Zugang.',
  'Diese Plattform ist für dieses Konto noch nicht freigeschaltet.',
  'Schülerinnen und Schüler: Die Lehrkraft muss die Plattform im Portal für den Kurs freischalten.',
  'Lehrkräfte: Die Freischaltung der Plattform erteilt die Administration im Portal; danach die Plattform beim Kurs ankreuzen.'
];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SITZUNG_COOKIE = 'tp_sitzung';

/**
 * @param {object} o
 * @param {string} o.basis            eigene Basis-URL (z. B. http://127.0.0.1:4100)
 * @param {string} o.portalUrl        PORTAL_URL (= erwartetes iss)
 * @param {string} o.portalPublicKey  PORTAL_PUBLIC_KEY (PEM)
 * @param {string} [o.id]             PLATTFORM_ID (Standard „testlabor“)
 * @param {string} [o.modus]          AUTH_MODUS (Standard „beides“)
 * @param {Function} [o.now]          Uhr in ms (Tests)
 */
function createTestplattform(o) {
  const id = o.id || 'testlabor';
  const now = o.now || (() => Date.now());
  const jetztSek = () => Math.floor(now() / 1000);
  const ssoJti = new JtiSpeicher();
  const verbundJti = new JtiSpeicher();
  const geheim = crypto.randomBytes(32);

  // „Datenbank“: Konten (Upsert nach sub), Kurse (nach Kurs-ID), Punkte, Protokoll der Verbund-Aufrufe
  const daten = { konten: new Map(), kurse: new Map(), punkte: new Map(), protokoll: [], abgelehnt: [] };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  /* ---------- Cookies (signiert, httpOnly) ---------- */
  const mac = (v) => crypto.createHmac('sha256', geheim).update(v).digest('base64url');
  const setze = (res, name, wert, maxAgeSek) =>
    res.append('Set-Cookie', `${name}=${wert}.${mac(wert)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSek}`);
  const lies = (req, name) => {
    const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
    if (!m) return null;
    const v = m.slice(name.length + 1);
    const i = v.lastIndexOf('.');
    if (i < 1) return null;
    const wert = v.slice(0, i);
    const a = Buffer.from(v.slice(i + 1));
    const b = Buffer.from(mac(wert));
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? wert : null;
  };
  const sitzung = (req) => {
    const w = lies(req, SITZUNG_COOKIE);
    if (!w) return null;
    try {
      const s = JSON.parse(Buffer.from(w, 'base64url').toString('utf8'));
      return s.bis > now() ? daten.konten.get(s.sub) || null : null;
    } catch {
      return null;
    }
  };

  /* ---------- Manifest und Healthcheck (§7, §6) ---------- */
  const manifest = () => ({
    vertrag: '1.4',
    id,
    name: 'Testlabor',
    titel: 'Testlabor – Prüfstand für den Verbund',
    themenfeld: 'Prüfung des Portals',
    kurs: 'nur für automatische Tests',
    niveaus: ['eA', 'gA'],
    beschreibung: 'Kleinste vertragsgemäße Plattform: SSO-Empfänger und Verbund-API.',
    farbe: '#548235',
    version: '1.0.0',
    basis: o.basis,
    urls: { start: '/', gast: '/gast', themen: '/themen', lehrkraft: '/lehrer', datenschutz: '/datenschutz', healthz: '/healthz', ssoStart: '/sso/start', ssoEnde: '/sso/ende', niveaus: '/niveaus' },
    auth: { modus: o.modus || 'beides', portal: o.portalUrl, sso: true },
    umfang: { welten: 1, level: 1, aufgaben: 3, bosse: 0 },
    faehigkeiten: ['gast']
  });
  app.get('/api/plattform', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(manifest());
  });
  app.get('/healthz', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));
  for (const p of ['/gast', '/themen', '/lehrer', '/datenschutz', '/niveaus']) app.get(p, (req, res) => res.type('text').send(`Testlabor ${p}\n`));

  app.get('/', (req, res) => {
    const k = sitzung(req);
    res.type('text').send(k ? `Angemeldet als ${k.name} (${k.rolle})\n` : 'Nicht angemeldet\n');
  });

  /* ---------- SSO (§5) ---------- */

  // Schritt 1: Weiterleitung zum Portal mit state (≥ 128 bit) im kurzlebigen Cookie. Startet IMMER neu, auch mit
  // bestehender Sitzung (§5, ab v1.3) – die Sitzung bleibt bis zu einem gültigen Token unverändert.
  app.get('/sso/start', (req, res) => {
    const state = crypto.randomBytes(16).toString('base64url');
    const ziel = typeof req.query.ziel === 'string' && /^\/(?![/\\])/.test(req.query.ziel) ? req.query.ziel : '/';
    setze(res, STATE_COOKIE, state, 600);
    const u = new URL(o.portalUrl + '/sso/autorisieren');
    u.searchParams.set('plattform', id);
    u.searchParams.set('ruecksprung', o.basis + '/sso/ende');
    u.searchParams.set('state', state);
    u.searchParams.set('ziel', ziel);
    res.redirect(302, u.href);
  });

  // Schritt 4: Token prüfen, Konto upserten, Kurse abgleichen, eigene Sitzung setzen, auf ziel weiterleiten.
  // Jeder Fehler lässt eine bestehende Sitzung unverändert (kein Set-Cookie für die Sitzung).
  app.get('/sso/ende', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'no-store');
    const ablehnen = (grund) => {
      daten.abgelehnt.push(grund);
      res.status(401).type('text').send(`SSO abgelehnt: ${grund}\n`);
    };
    const state = lies(req, STATE_COOKIE);
    res.append('Set-Cookie', `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    if (!state || req.query.state !== state) return ablehnen('state');
    if (req.query.fehler === 'keine_berechtigung') {
      daten.abgelehnt.push('portal:keine_berechtigung');
      return res
        .status(403)
        .type('html')
        .send(`<!doctype html><meta charset="utf-8"><title>Kein Zugang</title>\n<h1>${esc(KEIN_ZUGANG[0])}</h1>\n` +
          KEIN_ZUGANG.slice(1).map((z) => `<p>${esc(z)}</p>\n`).join('') + `<p><a href="${esc(o.portalUrl)}/">Zurück zum Portal</a></p>\n`);
    }
    if (req.query.fehler) return ablehnen('portal:' + String(req.query.fehler));
    const p = pruefe(req.query.token, o.portalPublicKey, { iss: o.portalUrl, aud: id, maxDauerSek: 120, jetztSek: jetztSek() });
    if (!p.ok) return ablehnen(p.grund);
    const t = p.nutzlast;
    if (!ssoJti.merke(t.jti, t.exp, jetztSek())) return ablehnen('wiederverwendet');
    if (!/^[asl]:\d+$/.test(t.sub) || !['schueler', 'lehrkraft', 'superadmin'].includes(t.rolle) || !Array.isArray(t.kurse)) return ablehnen('inhalt');
    // Upsert nach sub; Kurse aus dem Token übernehmen (fehlende Kurse: Zugang entfällt, Daten bleiben)
    daten.konten.set(t.sub, { sub: t.sub, rolle: t.rolle, name: t.name, kurse: t.kurse.map((k) => ({ id: k.id, rolle: k.rolle })) });
    const imToken = new Set(t.kurse.map((k) => k.id));
    for (const k of daten.kurse.values()) if (!imToken.has(k.id)) k.mitglieder.delete(t.sub);
    for (const k of t.kurse) {
      const kurs = daten.kurse.get(k.id) || { id: k.id, name: k.name, aktiv: true, mitglieder: new Set() };
      kurs.name = k.name;
      if (k.rolle === 'mitglied') kurs.mitglieder.add(t.sub);
      daten.kurse.set(k.id, kurs);
    }
    const bis = now() + (t.rolle === 'schueler' ? 30 * 24 : 8) * 3600 * 1000;
    setze(res, SITZUNG_COOKIE, Buffer.from(JSON.stringify({ sub: t.sub, bis })).toString('base64url'), Math.floor((bis - now()) / 1000));
    const ziel = typeof req.query.ziel === 'string' && /^\/(?![/\\])/.test(req.query.ziel) ? req.query.ziel : '/';
    res.redirect(302, ziel);
  });

  app.get('/abmelden', (req, res) => {
    res.append('Set-Cookie', `${SITZUNG_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.redirect(302, `${o.portalUrl}/sso/abmelden?ruecksprung=${encodeURIComponent(o.basis + '/')}`);
  });

  app.get('/api/ich', (req, res) => {
    const k = sitzung(req);
    if (!k) return res.status(401).json({ error: 'nicht angemeldet' });
    res.json(k);
  });

  // Nur Testlabor: Punkte setzen, damit die Kursübersicht etwas zeigt
  app.post('/api/punkte', (req, res) => {
    const k = sitzung(req);
    if (!k) return res.status(401).json({ error: 'nicht angemeldet' });
    daten.punkte.set(k.sub, Number(req.body && req.body.punkte) || 0);
    res.json({ ok: true });
  });

  /* ---------- Verbund-API (§6): Bearer-Token vom Portal ---------- */
  function verbund(zweck) {
    return (req, res, next) => {
      const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
      const p = m ? pruefe(m[1], o.portalPublicKey, { iss: o.portalUrl, aud: id, maxDauerSek: 60, jetztSek: jetztSek() }) : { ok: false, grund: 'fehlt' };
      if (p.ok && p.nutzlast.sub !== 'portal') p.ok = false;
      if (p.ok && p.nutzlast.zweck !== zweck) Object.assign(p, { ok: false, grund: 'zweck' });
      if (p.ok && !verbundJti.merke(p.nutzlast.jti, p.nutzlast.exp, jetztSek())) Object.assign(p, { ok: false, grund: 'wiederverwendet' });
      if (!p.ok) {
        daten.abgelehnt.push('verbund:' + (p.grund || 'sub'));
        return res.status(401).json({ error: 'Token ungültig.' });
      }
      next();
    };
  }

  app.post('/api/verbund/loeschen', verbund('loeschen'), (req, res) => {
    const b = req.body || {};
    let n = 0;
    if (typeof b.sub === 'string') {
      n += daten.konten.delete(b.sub) ? 1 : 0;
      n += daten.punkte.delete(b.sub) ? 1 : 0;
      for (const k of daten.kurse.values()) k.mitglieder.delete(b.sub);
    } else if (typeof b.kurs === 'string') {
      n += daten.kurse.delete(b.kurs) ? 1 : 0;
    } else return res.status(400).json({ error: 'sub oder kurs fehlt.' });
    daten.protokoll.push({ zweck: 'loeschen', ...b });
    res.json({ geloescht: n });
  });

  app.get('/api/verbund/kurse/:kursId/uebersicht', verbund('kurs-uebersicht'), (req, res) => {
    const k = daten.kurse.get(req.params.kursId);
    if (!k) return res.status(404).json({ error: 'Kurs unbekannt.' });
    daten.protokoll.push({ zweck: 'kurs-uebersicht', kurs: k.id });
    res.json({
      kurs: k.id,
      stand: new Date(now()).toISOString(),
      schueler: [...k.mitglieder].map((sub) => ({ sub, punkte: daten.punkte.get(sub) || 0, geloest: 1, anteil: 0.25, zuletzt: new Date(now()).toISOString() })),
      welten: [{ nr: 0, titel: 'Prüfwelt', anteil: 0.25 }]
    });
  });

  // Unbekannter Kurs → mit Standard-Einstellungen anlegen und 200 (§6, ab v1.3), damit der Auftrag nicht wiederholt wird
  app.post('/api/verbund/kurse/:kursId', verbund('kurs-aendern'), (req, res) => {
    const b = req.body || {};
    const k = daten.kurse.get(req.params.kursId) || { id: req.params.kursId, name: '', aktiv: true, mitglieder: new Set() };
    if (typeof b.name === 'string') k.name = b.name;
    if (typeof b.aktiv === 'boolean') k.aktiv = b.aktiv;
    daten.kurse.set(k.id, k);
    daten.protokoll.push({ zweck: 'kurs-aendern', kurs: k.id, ...b });
    res.json({ ok: true });
  });

  app.locals.daten = daten;
  return app;
}

module.exports = { createTestplattform };

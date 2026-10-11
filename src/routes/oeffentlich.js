'use strict';
// Öffentliche API: Sitzung, Plattform-Übersicht, Kurs-Info, Anmeldung/Beitritt, Registrierung, öffentlicher Schlüssel.

const express = require('express');
const S = require('../security');

function oeffentlicheRoutes({ svc, ctx, superadminAktiv }) {
  const r = express.Router();
  const ip = (req) => req.ip || 'unbekannt';

  const limitBeitritt = new S.Limiter({ max: 60, windowMs: 10 * 60 * 1000 });
  const limitSchuelerName = new S.Limiter({ max: 8, windowMs: 15 * 60 * 1000 });
  const limitSchuelerIp = new S.Limiter({ max: 100, windowMs: 15 * 60 * 1000 });
  const limitLkKonto = new S.Limiter({ max: 8, windowMs: 15 * 60 * 1000 });
  const limitLkIp = new S.Limiter({ max: 20, windowMs: 15 * 60 * 1000 });
  const limitRegistrierung = new S.Limiter({ max: 5, windowMs: 60 * 60 * 1000 });
  const gesperrt = (res, lim, key) => {
    res.set('Retry-After', String(lim.retryAfterSec(key)));
    return res.status(429).json({ error: 'Zu viele Versuche. Bitte warte einige Minuten.' });
  };

  r.get('/sitzung', (req, res) => {
    const s = req.sitzung();
    if (!s) return res.json({ typ: null });
    if (s.typ === 'schueler') return res.json({ typ: 'schueler', name: s.s.name });
    const a = svc.konten.lkAnsicht(s.r);
    res.json({ typ: 'lehrkraft', name: a.name, rolle: a.rolle, mussPasswortAendern: a.mussPasswortAendern });
  });

  r.get('/plattformen', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ plattformen: svc.plattformen.oeffentlich() });
  });

  r.get('/kurs/:code', (req, res) => res.json(svc.kurse.info(req.params.code)));

  r.post('/schueler/beitreten', (req, res) => {
    if (!limitBeitritt.take(ip(req))) return gesperrt(res, limitBeitritt, ip(req));
    const b = req.body || {};
    const s = svc.konten.beitreten(b.kurscode, b.name);
    req.anmelden({ typ: 'schueler', s });
    const kurs = svc.kurse.info(b.kurscode);
    res.status(201).json({ name: s.name, code: s.code, kurs: kurs.name });
  });

  r.post('/schueler/anmelden', (req, res) => {
    const b = req.body || {};
    const key = 'n:' + String(b.name || '').trim().toLowerCase().slice(0, 40);
    if (limitSchuelerName.isBlocked(key)) return gesperrt(res, limitSchuelerName, key);
    if (limitSchuelerIp.isBlocked(ip(req))) return gesperrt(res, limitSchuelerIp, ip(req));
    let s;
    try {
      s = svc.konten.anmeldenSchueler(b.name, b.code);
    } catch (e) {
      if (e.status === 401) {
        limitSchuelerName.hit(key);
        limitSchuelerIp.hit(ip(req));
      }
      throw e;
    }
    limitSchuelerName.reset(key);
    req.anmelden({ typ: 'schueler', s });
    res.json({ name: s.name });
  });

  r.post('/abmelden', (req, res) => {
    req.abmelden();
    res.json({ ok: true });
  });

  r.post('/lehrkraft/registrieren', async (req, res) => {
    if (!limitRegistrierung.take(ip(req))) return gesperrt(res, limitRegistrierung, ip(req));
    await svc.konten.registrieren(req.body);
    res.status(201).json({ ok: true, meldung: 'Danke! Ihre Anfrage wird geprüft. Nach der Freigabe können Sie sich anmelden.' });
  });

  r.post('/lehrkraft/anmelden', async (req, res) => {
    const b = req.body || {};
    const key = 'l:' + String(b.email || '').trim().toLowerCase().slice(0, 200);
    if (limitLkKonto.isBlocked(key)) return gesperrt(res, limitLkKonto, key);
    if (limitLkIp.isBlocked(ip(req))) return gesperrt(res, limitLkIp, ip(req));
    let konto;
    try {
      konto = await svc.konten.anmeldenLehrkraft(b.email, b.passwort, { superadminAktiv });
    } catch (e) {
      if (e.status === 401) {
        limitLkKonto.hit(key);
        limitLkIp.hit(ip(req));
      }
      throw e;
    }
    limitLkKonto.reset(key);
    req.anmelden({ typ: 'lehrkraft', r: konto });
    const a = svc.konten.lkAnsicht(konto);
    res.json({ name: a.name, rolle: a.rolle, mussPasswortAendern: a.mussPasswortAendern });
  });

  /** Öffentlicher Schlüssel für die Plattformen (PORTAL_PUBLIC_KEY), auch als PEM unter /sso/schluessel.pem. */
  r.get('/portal/schluessel', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    if (!ctx.schluessel) return res.status(503).json({ error: 'Kein Schlüssel konfiguriert.' });
    res.json({ alg: 'EdDSA', crv: 'Ed25519', kid: ctx.schluessel.kid, iss: ctx.portalUrl, pem: ctx.schluessel.pem });
  });

  return r;
}

module.exports = { oeffentlicheRoutes };

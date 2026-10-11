'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { openDatabase } = require('./db');
const { createServices } = require('./services');
const { ladeSchluessel } = require('./schluessel');
const S = require('./security');
const { oeffentlicheRoutes } = require('./routes/oeffentlich');
const { schuelerRoutes } = require('./routes/schueler');
const { lehrkraftRoutes } = require('./routes/lehrkraft');
const { adminRoutes } = require('./routes/admin');
const { ssoRoutes } = require('./routes/sso');
const { createWartung } = require('./wartung');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const LEHRKRAFT_SITZUNG_MS = 8 * 3600 * 1000; // 8 Stunden (wie Algo Quest, Vertrag H.5)
const SCHUELER_SITZUNG_MS = 30 * 24 * 3600 * 1000; // 30 Tage

/**
 * Express-App des Portals erzeugen.
 * @param {object} opts
 * @param {string} opts.dbFile              SQLite-Datei oder ':memory:'
 * @param {string} opts.sessionSecret       Geheimnis zum Signieren der Cookies (≥ 16 Zeichen)
 * @param {string} opts.portalUrl           öffentliche Basis-URL des Portals (= iss der Tokens)
 * @param {string} [opts.adminEmail]        Superadmin-Login (Standard „admin“)
 * @param {string} [opts.adminPassword]     Superadmin-Passwort (leer = Superadmin-Login gesperrt)
 * @param {string} [opts.privateKeyPem]     Ed25519-Schlüssel (PEM); ohne → kein SSO, keine Verbund-API
 * @param {Function} [opts.fetch]           fetch für Aufrufe an Plattformen (Tests)
 * @param {boolean} [opts.erlaubeHttp]      Plattformen auch über http:// (nur Entwicklung/Tests)
 * @param {boolean} [opts.verbundAutomatisch] Aufträge sofort abarbeiten (Standard true)
 * @param {string|number|boolean} [opts.trustProxy]
 * @param {Function} [opts.log]
 * @param {Function} [opts.now]             Uhr (ms) – für Tests
 */
function createApp(opts) {
  const log = opts.log || (() => {});
  if (!opts.sessionSecret || opts.sessionSecret.length < 16) throw new Error('SESSION_SECRET fehlt oder ist zu kurz (mind. 16 Zeichen).');
  const portalUrl = String(opts.portalUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(portalUrl)) throw new Error('PORTAL_URL fehlt oder ist ungültig (z. B. https://labs.frankjuchim.de).');
  const db = openDatabase(opts.dbFile, { log });
  let schluessel = null;
  if (opts.privateKeyPem) schluessel = ladeSchluessel(opts.privateKeyPem);
  else log('Hinweis: PORTAL_PRIVATE_KEY fehlt – Single Sign-on und Verbund-API sind abgeschaltet.');

  const ctx = {
    db,
    log,
    now: opts.now || (() => Date.now()),
    portalUrl,
    schluessel,
    fetch: opts.fetch || globalThis.fetch,
    erlaubeHttp: !!opts.erlaubeHttp,
    verbundAutomatisch: opts.verbundAutomatisch !== false
  };
  const svc = createServices(ctx);
  const secret = opts.sessionSecret;
  const superadminAktiv = !!opts.adminPassword;
  svc.konten.sichereSuperadmin(opts.adminEmail || 'admin', opts.adminPassword || '');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', opts.trustProxy ?? 1);
  app.locals.dienste = svc;
  app.locals.ctx = ctx;
  app.locals.wartung = createWartung(ctx, svc);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'font-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': null
        }
      },
      referrerPolicy: { policy: 'same-origin' },
      crossOriginEmbedderPolicy: false
    })
  );
  app.use((req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  /* ---------- Sitzung (ein signiertes Cookie: Schüler oder Lehrkraft) ---------- */

  app.use((req, res, next) => {
    let cache;
    req.sitzung = () => {
      if (cache !== undefined) return cache;
      cache = null;
      const p = S.verify(S.parseCookies(req.headers.cookie)[S.COOKIE_SITZUNG], secret);
      if (p && p.t === 's') {
        const s = svc.konten.schuelerAusSitzung(p.id, p.g);
        if (s) cache = { typ: 'schueler', s };
      } else if (p && p.t === 'l') {
        const r = svc.konten.lehrkraftAusSitzung(p.id, p.g, { superadminAktiv });
        if (r) cache = { typ: 'lehrkraft', r };
      }
      return cache;
    };
    req.anmelden = (konto) => {
      cache = undefined;
      if (konto.typ === 'schueler') S.setCookie(req, res, S.COOKIE_SITZUNG, { t: 's', id: konto.s.id, g: konto.s.session_gen }, secret, SCHUELER_SITZUNG_MS);
      else S.setCookie(req, res, S.COOKIE_SITZUNG, { t: 'l', id: konto.r.id, g: konto.r.session_gen }, secret, LEHRKRAFT_SITZUNG_MS);
    };
    req.abmelden = () => {
      cache = null;
      S.clearCookie(req, res, S.COOKIE_SITZUNG);
    };
    next();
  });

  /* ---------- öffentlich ohne JSON-Body ---------- */

  app.get('/healthz', (req, res) => res.json({ status: 'ok', version: VERSION }));
  app.use(ssoRoutes({ svc, ctx }));

  /* ---------- API ---------- */

  // Datenübernahme: große JSON-Datei (Algo-Quest-Backup) – eigener Parser vor dem allgemeinen
  app.use('/api/admin/import', S.sameOriginCheck, express.json({ limit: '80mb' }));
  app.use('/api', S.sameOriginCheck, express.json({ limit: '200kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', oeffentlicheRoutes({ svc, ctx, superadminAktiv, version: VERSION }));
  app.use('/api/schueler', schuelerRoutes({ svc }));
  app.use('/api/lehrkraft', lehrkraftRoutes({ svc }));
  app.use('/api/admin', adminRoutes({ svc, ctx }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannte Anfrage.' }));

  /* ---------- Seiten ---------- */

  const seite = (datei) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, datei));
  app.get(['/', '/anmelden'], seite('index.html'));
  app.get('/schueler', seite('schueler.html'));
  app.get('/lehrkraft', seite('lehrkraft.html'));
  app.get('/datenschutz', seite('datenschutz.html'));
  app.use('/static', express.static(path.join(PUBLIC_DIR, 'static'), { maxAge: '1h', index: false }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/favicon.svg'));
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

  /* ---------- Fehler ---------- */

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Die Anfrage ist zu groß.' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültiges JSON.' });
    const status = err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) log(`Fehler bei ${req.method} ${req.path}: ${err && err.stack ? err.stack : err}`);
    const body = { error: status >= 500 && status !== 503 ? 'Interner Fehler. Bitte später erneut versuchen.' : err.message };
    if (status < 500 && err.details) body.details = err.details;
    if (status < 500 && err.extra) Object.assign(body, err.extra);
    res.status(status).json(body);
  });

  return app;
}

module.exports = { createApp, VERSION };

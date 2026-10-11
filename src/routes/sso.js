'use strict';
// SSO-Endpunkte nach Vertrag H.5: /sso/autorisieren, /sso/abbrechen, /sso/abmelden, /sso/schluessel.pem.

const express = require('express');
const S = require('../security');

/** Kleine Fehlerseite (serverseitig, Texte HTML-maskiert, kein Skript). */
function fehlerSeite(titel, text) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(titel)} – InfoLabs</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/css/portal.css"></head>
<body class="seite-schmal"><main class="karte fehlerkarte" id="haupt"><h1>${esc(titel)}</h1><p>${esc(text)}</p>
<p><a class="knopf" href="/">Zur Startseite von InfoLabs</a></p></main></body></html>`;
}

function ssoRoutes({ svc, ctx }) {
  const r = express.Router();
  const limit = new S.Limiter({ max: 120, windowMs: 60 * 1000 });

  const ohneSpuren = (res) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'no-store');
  };

  /**
   * Plattform → Portal. Mit Sitzung: sofort zurück (Token oder Ablehnung). Ohne Sitzung: Anmeldeseite, die nach
   * erfolgreicher Anmeldung genau diese Adresse erneut aufruft.
   */
  r.get('/sso/autorisieren', (req, res) => {
    ohneSpuren(res);
    if (!limit.take(req.ip || '-')) return res.status(429).type('html').send(fehlerSeite('Zu viele Anfragen', 'Bitte warte einen Moment und versuche es erneut.'));
    const a = svc.sso.pruefeAnfrage(req.query);
    if (!a.ok) return res.status(400).type('html').send(fehlerSeite('Anmeldung nicht möglich', a.meldung));
    if (!ctx.schluessel) return res.status(503).type('html').send(fehlerSeite('Anmeldung vorübergehend nicht möglich', 'Das Portal ist noch nicht vollständig eingerichtet.'));
    const s = req.sitzung();
    if (!s || (s.typ === 'lehrkraft' && s.r.muss_pw_aendern)) {
      return res.redirect(302, '/anmelden?weiter=' + encodeURIComponent(req.originalUrl));
    }
    res.redirect(302, svc.sso.entscheide(a, s).url);
  });

  /** Abbrechen auf der Anmeldeseite → Plattform erhält fehler=abgebrochen (nur an die freigegebene Adresse). */
  r.get('/sso/abbrechen', (req, res) => {
    ohneSpuren(res);
    const a = svc.sso.pruefeAnfrage(req.query);
    if (!a.ok) return res.redirect(302, '/');
    res.redirect(302, svc.sso.fehlerUrl(a, 'abgebrochen'));
  });

  /** „Überall abmelden“: Portal-Sitzung beenden, zurück zur Plattform (nur eingetragene Plattformen). */
  r.get('/sso/abmelden', (req, res) => {
    ohneSpuren(res);
    req.abmelden();
    res.redirect(302, svc.sso.abmeldeZiel(req.query.ruecksprung));
  });

  r.get('/sso/schluessel.pem', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    if (!ctx.schluessel) return res.status(503).type('text/plain').send('Kein Schlüssel konfiguriert.\n');
    res.type('application/x-pem-file').send(ctx.schluessel.pem);
  });

  return r;
}

module.exports = { ssoRoutes, fehlerSeite };

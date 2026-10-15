'use strict';
// Schüler-API: eigene Kurse und Plattformen („Weiter zu …“), weiterem Kurs beitreten.

const express = require('express');
const S = require('../security');

function schuelerRoutes({ svc }) {
  const r = express.Router();
  const limitBeitritt = new S.Limiter({ max: 30, windowMs: 10 * 60 * 1000 });

  r.use((req, res, next) => {
    const s = req.sitzung();
    if (!s || s.typ !== 'schueler') return res.status(401).json({ error: 'Bitte melde dich an.' });
    req.schueler = s.s;
    next();
  });

  r.get('/ich', (req, res) => {
    const s = req.schueler;
    const plattformen = Object.fromEntries(svc.plattformen.oeffentlich().map((p) => [p.id, p]));
    const kurse = svc.kurse.fuerSchueler(s.id).map((k) => ({
      ...k,
      plattformen: k.plattformen.filter((pid) => plattformen[pid]).map((pid) => {
        const p = plattformen[pid];
        // Einstieg: über den SSO-Start der Plattform (holt immer ein frisches Token, §5 ab v1.3), sonst ihre Startseite
        return { id: pid, name: p.name, titel: p.titel, themenfeld: p.themenfeld, farbe: p.farbe, link: p.links.einstieg, sso: p.sso };
      })
    }));
    res.json({ name: s.name, code: s.code, kurse });
  });

  r.post('/kurse', (req, res) => {
    if (!limitBeitritt.take('s:' + req.schueler.id)) return res.status(429).json({ error: 'Zu viele Versuche. Bitte warte einige Minuten.' });
    const k = svc.konten.weitererKurs(req.schueler.id, (req.body || {}).kurscode);
    res.status(201).json({ kurs: k.name });
  });

  return r;
}

module.exports = { schuelerRoutes };

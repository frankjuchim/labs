'use strict';
// Superadmin-API: Lehrkräfte (Freigabe, Freischaltung je Plattform), Plattformen, Schlüssel, Verbund-Aufträge, Import.

const express = require('express');
const V = require('../validate');

function adminRoutes({ svc, ctx }) {
  const r = express.Router();
  const id = (req) => V.int(req.params.id, 'ID');

  r.use((req, res, next) => {
    const s = req.sitzung();
    if (!s || s.typ !== 'lehrkraft') return res.status(401).json({ error: 'Bitte melden Sie sich an.' });
    if (s.r.rolle !== 'superadmin') return res.status(403).json({ error: 'Nur für den Superadmin.' });
    req.lk = s.r;
    next();
  });

  r.get('/uebersicht', (req, res) => {
    const n = (sql) => ctx.db.prepare(sql).get().n;
    res.json({
      lehrkraefteWartend: n("SELECT COUNT(*) AS n FROM lehrkraefte WHERE status = 'wartet'"),
      lehrkraefte: n("SELECT COUNT(*) AS n FROM lehrkraefte WHERE rolle = 'lehrkraft' AND status = 'aktiv'"),
      kurse: n('SELECT COUNT(*) AS n FROM kurse'),
      schueler: n('SELECT COUNT(*) AS n FROM schueler'),
      plattformen: n('SELECT COUNT(*) AS n FROM plattformen'),
      auftraegeFehlgeschlagen: n("SELECT COUNT(*) AS n FROM verbund_auftraege WHERE status = 'fehlgeschlagen'"),
      auftraegeOffen: n("SELECT COUNT(*) AS n FROM verbund_auftraege WHERE status = 'offen'"),
      schluessel: !!ctx.schluessel,
      schluesselFehler: ctx.schluesselFehler
    });
  });

  /* Lehrkräfte */
  r.get('/lehrkraefte', (req, res) => res.json({ lehrkraefte: svc.konten.listeLehrkraefte() }));
  r.post('/lehrkraefte/:id/status', (req, res) => res.json(svc.konten.setzeStatus(id(req), (req.body || {}).status)));
  r.post('/lehrkraefte/:id/einmalpasswort', async (req, res) => res.json(await svc.konten.einmalPasswort(id(req))));
  r.put('/lehrkraefte/:id/plattformen', (req, res) => res.json(svc.konten.setzeFreischaltungen(id(req), (req.body || {}).plattformen)));
  r.delete('/lehrkraefte/:id', (req, res) => res.json(svc.konten.loescheLehrkraft(id(req))));

  /* Plattformen */
  r.get('/plattformen', (req, res) => res.json({ plattformen: svc.plattformen.liste() }));
  r.post('/plattformen', async (req, res) => res.status(201).json(await svc.plattformen.eintragen((req.body || {}).basis)));
  r.post('/plattformen/vorlaeufig', (req, res) => res.status(201).json(svc.plattformen.vorlaeufigEintragen(req.body)));
  r.post('/plattformen/:pid/pruefen', async (req, res) => res.json(await svc.plattformen.pruefen(V.plattformId(req.params.pid))));
  r.patch('/plattformen/:pid', (req, res) => res.json(svc.plattformen.aendern(V.plattformId(req.params.pid), req.body)));
  r.delete('/plattformen/:pid', (req, res) => res.json({ ok: svc.plattformen.entfernen(V.plattformId(req.params.pid)) }));

  /* Schlüssel (öffentlicher Teil zum Verteilen) */
  r.get('/schluessel', (req, res) => {
    if (!ctx.schluessel) return res.json({ aktiv: false, fehler: ctx.schluesselFehler });
    res.json({ aktiv: true, kid: ctx.schluessel.kid, pem: ctx.schluessel.pem, iss: ctx.portalUrl, url: ctx.portalUrl + '/sso/schluessel.pem' });
  });

  /* Verbund-Aufträge */
  r.get('/auftraege', (req, res) => res.json({ auftraege: svc.verbund.auftraege() }));
  r.post('/auftraege/verarbeiten', async (req, res) => res.json({ bearbeitet: await svc.verbund.verarbeite() }));
  r.post('/auftraege/:id/wiederholen', (req, res) => res.json({ ok: svc.verbund.wiederholen(id(req)) }));

  /* Datenübernahme (§11) */
  r.post('/import', (req, res) => {
    const b = req.body || {};
    res.json(svc.importe.ausfuehren(b.daten, { probelauf: b.probelauf === true }));
  });
  r.get('/importe', (req, res) => res.json({ importe: svc.importe.liste() }));
  r.get('/importe/:id/zuordnung.json', (req, res) => {
    const z = svc.importe.zuordnung(id(req));
    res.set('Content-Disposition', `attachment; filename="zuordnung_${z.quelle}_${id(req)}.json"`);
    res.json(z);
  });

  return r;
}

module.exports = { adminRoutes };

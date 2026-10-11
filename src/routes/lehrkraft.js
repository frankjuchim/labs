'use strict';
// Lehrkraft-API (auch Superadmin): Konto, Kurse, Schüler, Mitlehrkräfte, Kennzahlen der Plattformen.

const express = require('express');
const V = require('../validate');
const { subSchueler } = require('../services/konten');

function lehrkraftRoutes({ svc }) {
  const r = express.Router();
  const kid = (req) => V.int(req.params.id, 'Kurs');
  const sid = (req) => V.int(req.params.sid, 'Schüler');

  r.use((req, res, next) => {
    const s = req.sitzung();
    if (!s || s.typ !== 'lehrkraft') return res.status(401).json({ error: 'Bitte melden Sie sich an.' });
    req.lk = s.r;
    next();
  });

  r.get('/ich', (req, res) => res.json(svc.konten.lkAnsicht(req.lk)));

  r.post('/passwort', async (req, res) => {
    const b = req.body || {};
    const neu = await svc.konten.passwortAendern(req.lk.id, b.alt, b.neu);
    req.anmelden({ typ: 'lehrkraft', r: neu }); // Sitzung mit neuer Generation fortsetzen
    res.json({ ok: true });
  });

  // Nach einem Einmal-Passwort ist nur der Passwortwechsel erlaubt.
  r.use((req, res, next) => {
    if (req.lk.muss_pw_aendern) return res.status(403).json({ error: 'Bitte zuerst ein eigenes Passwort festlegen.', passwortAendern: true });
    next();
  });

  /** Plattformen, die diese Lehrkraft für Kurse wählen kann. */
  r.get('/plattformen', (req, res) => {
    const frei = svc.konten.lkAnsicht(req.lk).plattformen;
    res.json({ plattformen: svc.plattformen.oeffentlich().filter((p) => !p.vorlaeufig && frei.includes(p.id)) });
  });

  r.get('/kurse', (req, res) => res.json({ kurse: svc.kurse.listeFuer(req.lk), standardAblauf: svc.kurse.standardAblauf() }));
  r.post('/kurse', (req, res) => res.status(201).json(svc.kurse.anlegen(req.lk, req.body)));
  r.get('/kurse/:id', (req, res) => res.json(svc.kurse.get(req.lk, kid(req))));
  r.patch('/kurse/:id', (req, res) => res.json(svc.kurse.aendern(req.lk, kid(req), req.body)));
  r.delete('/kurse/:id', (req, res) => res.json(svc.kurse.loeschen(req.lk, kid(req), (req.body || {}).bestaetigung ?? req.query.bestaetigung)));
  r.post('/kurse/:id/neuer-kurscode', (req, res) => res.json(svc.kurse.neuerKurscodeFuer(req.lk, kid(req))));
  r.get('/kurse/:id/qr.svg', async (req, res) => {
    res.type('image/svg+xml').send(await svc.kurse.qrSvg(req.lk, kid(req)));
  });

  r.get('/kurse/:id/schueler', (req, res) => res.json({ schueler: svc.kurse.schuelerListe(req.lk, kid(req)) }));
  r.patch('/kurse/:id/schueler/:sid', (req, res) => res.json(svc.kurse.schuelerUmbenennen(req.lk, kid(req), sid(req), (req.body || {}).name)));
  r.delete('/kurse/:id/schueler/:sid', (req, res) => res.json(svc.kurse.schuelerEntfernen(req.lk, kid(req), sid(req))));
  r.post('/kurse/:id/schueler/:sid/neuer-code', (req, res) => res.json(svc.kurse.schuelerNeuerCode(req.lk, kid(req), sid(req))));

  r.post('/kurse/:id/einladungen', (req, res) => res.status(201).json(svc.kurse.einladen(req.lk, kid(req), (req.body || {}).email)));
  r.delete('/kurse/:id/einladungen/:eid', (req, res) => res.json(svc.kurse.einladungZurueckziehen(req.lk, kid(req), V.int(req.params.eid, 'Einladung'))));
  r.delete('/kurse/:id/lehrkraefte/:lid', (req, res) => res.json(svc.kurse.mitlehrkraftEntfernen(req.lk, kid(req), V.int(req.params.lid, 'Lehrkraft'))));

  r.get('/einladungen', (req, res) => res.json({ einladungen: svc.kurse.meineEinladungen(req.lk) }));
  r.post('/einladungen/:eid', (req, res) => res.json(svc.kurse.einladungBeantworten(req.lk, V.int(req.params.eid, 'Einladung'), V.bool((req.body || {}).annehmen, 'annehmen'))));

  /**
   * Kennzahlen einer Plattform für einen Kurs (Verbund-API, SOLL-Endpunkt). Die Plattform liefert Werte je sub;
   * das Portal ergänzt die Namen – nur für Mitglieder dieses Kurses.
   */
  r.get('/kurse/:id/uebersicht/:plattform', async (req, res) => {
    const kurs = svc.kurse.get(req.lk, kid(req));
    const pid = V.plattformId(req.params.plattform);
    if (!kurs.plattformen.some((p) => p.id === pid)) throw new V.NotFoundError('Diese Plattform gehört nicht zum Kurs.');
    const u = await svc.verbund.kursUebersicht(pid, kurs.kursId);
    if (!u.verfuegbar) return res.json(u);
    const namen = new Map(svc.kurse.schuelerListe(req.lk, kurs.id).map((s) => [s.sub, s.name]));
    const d = u.daten || {};
    const schueler = (Array.isArray(d.schueler) ? d.schueler : [])
      .filter((x) => x && namen.has(x.sub))
      .map((x) => ({
        name: namen.get(x.sub),
        punkte: Number.isFinite(x.punkte) ? x.punkte : null,
        geloest: Number.isFinite(x.geloest) ? x.geloest : null,
        anteil: Number.isFinite(x.anteil) ? x.anteil : null,
        zuletzt: typeof x.zuletzt === 'string' ? x.zuletzt : null
      }));
    const welten = (Array.isArray(d.welten) ? d.welten : []).slice(0, 50).map((w) => ({
      nr: Number.isFinite(w.nr) ? w.nr : null,
      titel: typeof w.titel === 'string' ? w.titel.slice(0, 80) : '',
      anteil: Number.isFinite(w.anteil) ? w.anteil : null
    }));
    res.json({ verfuegbar: true, schueler, welten, stand: typeof d.stand === 'string' ? d.stand : null, unbekannt: (d.schueler || []).filter((x) => x && !namen.has(x.sub)).length });
  });

  return r;
}

module.exports = { lehrkraftRoutes, subSchueler };

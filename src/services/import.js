'use strict';
// Datenübernahme aus Algo Quest (Vertrag §11, Phase 2): Lehrkräfte mit scrypt-Hash, Kurse mit Kurscode,
// Schüler mit Name + persönlichem Code. Codes bleiben unverändert; das Portal vergibt sub/Kurs-IDs und liefert
// eine Zuordnung alt → neu, mit der die Plattform ihre Lernstände umschreibt.
//
// Angenommen werden zwei Formate:
//  1. das Backup von Algo Quest (Superadmin → Backup, {"app":"algoquest-lab","format":2,"tables":{…}}) – genutzt werden
//     NUR die Tabellen lehrkraefte, kurse, schueler; Lernstände werden weder gelesen noch gespeichert;
//  2. das Verbund-Exportformat (Vorschlag in VERTRAG.md): {"format":"verbund-export","version":1,…}.
// Der Import ist idempotent (alt_quelle + alt_id): ein zweiter Lauf legt nichts doppelt an.

const V = require('../validate');
const S = require('../security');
const { subLehrkraft, subSchueler } = require('./konten');
const { kursId } = require('./loeschung');

const { ValidationError } = V;
const STATUS = ['wartet', 'aktiv', 'abgelehnt', 'deaktiviert'];

function createImport(ctx, { konten, kurse, plattformen }) {
  const { db } = ctx;
  const iso = () => new Date(ctx.now()).toISOString();

  /** Eingabe in ein einheitliches Format bringen: { quelle, lehrkraefte[], kurse[], schueler[] }. */
  function normalisiere(d) {
    if (!d || typeof d !== 'object') throw new ValidationError('Import: JSON-Objekt erwartet.');
    if (d.app === 'algoquest-lab' && d.format === 2 && d.tables && typeof d.tables === 'object') {
      const t = d.tables;
      const liste = (n) => (Array.isArray(t[n]) ? t[n] : []);
      return {
        quelle: 'algoquest',
        lehrkraefte: liste('lehrkraefte').map((r) => ({
          altId: r.id, email: r.email, name: r.name, schule: r.schule, pwHash: r.pw_hash, rolle: r.rolle, status: r.status, erstellt: r.created_at
        })),
        kurse: liste('kurse').map((r) => {
          let offen = true;
          try {
            offen = JSON.parse(r.einstellungen || '{}').anmeldung !== false;
          } catch {
            offen = true;
          }
          return { altId: r.id, lehrkraftAltId: r.lehrkraft_id, name: r.name, code: r.code, beitrittOffen: offen, erstellt: r.created_at };
        }),
        schueler: liste('schueler').map((r) => ({
          altId: r.id, kursAltId: r.kurs_id, name: r.name, code: r.code, erstellt: r.created_at, zuletztAktiv: r.last_active_at
        }))
      };
    }
    if (d.format === 'verbund-export' && d.version === 1) {
      const quelle = V.plattformId(d.quelle);
      const arr = (v) => (Array.isArray(v) ? v : []);
      return { quelle, lehrkraefte: arr(d.lehrkraefte), kurse: arr(d.kurse), schueler: arr(d.schueler) };
    }
    throw new ValidationError('Unbekanntes Format: erwartet wird ein Algo-Quest-Backup (Format 2) oder ein Verbund-Export (Version 1).');
  }

  const altId = (v, feld) => {
    if (!Number.isInteger(v) || v < 0) throw new ValidationError(`Import: ${feld} muss eine Ganzzahl sein.`);
    return v;
  };

  /**
   * Import ausführen (oder mit probelauf = true nur berechnen, ohne zu schreiben).
   * Liefert { bericht, zuordnung }.
   */
  function ausfuehren(daten, { probelauf = false } = {}) {
    const d = normalisiere(daten);
    const quelle = d.quelle;
    const plattformBekannt = !!plattformen.zeile(quelle) && plattformen.nutzbar(quelle);
    const superadmin = db.prepare("SELECT * FROM lehrkraefte WHERE rolle = 'superadmin' ORDER BY id LIMIT 1").get();
    const bericht = {
      quelle,
      probelauf,
      plattformFreigeschaltet: plattformBekannt,
      lehrkraefte: { neu: 0, vorhanden: 0, zusammengefuehrt: 0, uebersprungen: 0 },
      kurse: { neu: 0, vorhanden: 0, neuerKurscode: 0, uebersprungen: 0 },
      schueler: { neu: 0, vorhanden: 0, neuerCode: 0, uebersprungen: 0 },
      hinweise: []
    };
    const zuordnung = { format: 'verbund-zuordnung', version: 1, quelle, portal: ctx.portalUrl, erstellt: iso(), lehrkraefte: [], kurse: [], schueler: [] };
    const hinweis = (t) => bericht.hinweise.length < 500 && bericht.hinweise.push(t);

    const lauf = db.transaction(() => {
      /* Lehrkräfte */
      const lkMap = new Map(); // altId → Portal-Zeile
      for (const l of d.lehrkraefte) {
        const a = altId(l.altId, 'lehrkraefte.altId');
        if (l.rolle === 'superadmin') {
          // Kurse des Algo-Quest-Superadmins gehören künftig dem Portal-Superadmin.
          if (superadmin) {
            lkMap.set(a, superadmin);
            zuordnung.lehrkraefte.push({ altId: a, sub: subLehrkraft(superadmin), art: 'superadmin' });
          }
          continue;
        }
        const schon = db.prepare('SELECT * FROM lehrkraefte WHERE alt_quelle = ? AND alt_id = ?').get(quelle, a);
        if (schon) {
          bericht.lehrkraefte.vorhanden++;
          lkMap.set(a, schon);
          zuordnung.lehrkraefte.push({ altId: a, sub: subLehrkraft(schon), art: 'vorhanden' });
          continue;
        }
        let email;
        let name;
        try {
          email = V.email(l.email);
          name = V.str(l.name, 'Name', { min: 1, max: 80 });
        } catch (e) {
          bericht.lehrkraefte.uebersprungen++;
          hinweis(`Lehrkraft ${a}: ${e.message}`);
          continue;
        }
        if (typeof l.pwHash !== 'string' || !/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(l.pwHash)) {
          bericht.lehrkraefte.uebersprungen++;
          hinweis(`Lehrkraft ${email}: Passwort-Hash fehlt oder hat ein unbekanntes Format.`);
          continue;
        }
        const gleicheMail = db.prepare('SELECT * FROM lehrkraefte WHERE email = ?').get(email);
        if (gleicheMail) {
          // Konto existiert schon im Portal (z. B. neu registriert): zusammenführen, Portal-Passwort bleibt.
          bericht.lehrkraefte.zusammengefuehrt++;
          hinweis(`Lehrkraft ${email}: gibt es schon im Portal – Kurse werden diesem Konto zugeordnet, Passwort bleibt.`);
          if (gleicheMail.rolle !== 'superadmin' && !gleicheMail.alt_quelle) db.prepare('UPDATE lehrkraefte SET alt_quelle = ?, alt_id = ? WHERE id = ?').run(quelle, a, gleicheMail.id);
          lkMap.set(a, gleicheMail);
          zuordnung.lehrkraefte.push({ altId: a, sub: subLehrkraft(gleicheMail), art: 'zusammengefuehrt' });
          if (plattformBekannt && gleicheMail.rolle !== 'superadmin') freischalten(gleicheMail.id, quelle);
          continue;
        }
        const status = STATUS.includes(l.status) ? l.status : 'wartet';
        const info = db
          .prepare(
            `INSERT INTO lehrkraefte (email, name, schule, pw_hash, rolle, status, created_at, entschieden_at, alt_quelle, alt_id)
             VALUES (?, ?, ?, ?, 'lehrkraft', ?, ?, ?, ?, ?)`
          )
          .run(email, name, typeof l.schule === 'string' ? l.schule.slice(0, 120) : '', l.pwHash, status, l.erstellt || iso(), status === 'wartet' ? null : iso(), quelle, a);
        const neu = konten.lkZeile(info.lastInsertRowid);
        if (plattformBekannt && status === 'aktiv') freischalten(neu.id, quelle);
        bericht.lehrkraefte.neu++;
        lkMap.set(a, neu);
        zuordnung.lehrkraefte.push({ altId: a, sub: subLehrkraft(neu), art: 'neu' });
      }

      /* Kurse */
      const kMap = new Map();
      for (const k of d.kurse) {
        const a = altId(k.altId, 'kurse.altId');
        const schon = db.prepare('SELECT * FROM kurse WHERE alt_quelle = ? AND alt_id = ?').get(quelle, a);
        if (schon) {
          bericht.kurse.vorhanden++;
          kMap.set(a, schon.id);
          zuordnung.kurse.push({ altId: a, kursId: kursId(schon.id), kurscode: schon.code, art: 'vorhanden' });
          continue;
        }
        const lk = lkMap.get(k.lehrkraftAltId);
        if (!lk) {
          bericht.kurse.uebersprungen++;
          hinweis(`Kurs ${a} („${k.name}“): zugehörige Lehrkraft wurde nicht übernommen.`);
          continue;
        }
        let name;
        try {
          name = V.str(k.name, 'Kursname', { min: 1, max: 80 });
        } catch (e) {
          bericht.kurse.uebersprungen++;
          hinweis(`Kurs ${a}: ${e.message}`);
          continue;
        }
        let code = V.kursCode(k.code);
        let art = 'neu';
        if (!code || db.prepare('SELECT 1 FROM kurse WHERE code = ?').get(code)) {
          hinweis(`Kurs „${name}“: Kurscode ${k.code} ist im Portal schon vergeben oder ungültig – neuer Kurscode.`);
          code = kurse.neuerKurscode();
          art = 'neuerKurscode';
          bericht.kurse.neuerKurscode++;
        }
        const info = db
          .prepare('INSERT INTO kurse (name, code, inhaber_id, beitritt_offen, ablauf, created_at, alt_quelle, alt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(name, code, lk.id, k.beitrittOffen === false ? 0 : 1, kurse.standardAblauf(), k.erstellt || iso(), quelle, a);
        const kid = Number(info.lastInsertRowid);
        if (plattformBekannt) db.prepare('INSERT INTO kurs_plattformen (kurs_id, plattform_id, aktiv, seit) VALUES (?, ?, 1, ?)').run(kid, quelle, iso());
        bericht.kurse.neu++;
        kMap.set(a, kid);
        zuordnung.kurse.push({ altId: a, kursId: kursId(kid), kurscode: code, art });
      }

      /* Schüler: ältere zuerst, damit bei Code-Kollisionen der zuerst angelegte seinen Code behält */
      const schueler = [...d.schueler].sort((x, y) => String(x.erstellt || '').localeCompare(String(y.erstellt || '')) || x.altId - y.altId);
      for (const s of schueler) {
        const a = altId(s.altId, 'schueler.altId');
        const schon = db.prepare('SELECT * FROM schueler WHERE alt_quelle = ? AND alt_id = ?').get(quelle, a);
        if (schon) {
          bericht.schueler.vorhanden++;
          zuordnung.schueler.push({ altId: a, sub: subSchueler(schon.id), art: 'vorhanden' });
          continue;
        }
        const kid = kMap.get(s.kursAltId);
        if (!kid) {
          bericht.schueler.uebersprungen++;
          continue;
        }
        let n;
        try {
          n = V.schuelerName(s.name);
        } catch (e) {
          bericht.schueler.uebersprungen++;
          hinweis(`Schüler ${a}: ${e.message}`);
          continue;
        }
        if (!konten.nameImKursFrei(kid, n.key)) {
          bericht.schueler.uebersprungen++;
          hinweis(`Schüler „${n.name}“: Name ist im Kurs schon vergeben – nicht übernommen.`);
          continue;
        }
        let code = S.normSchuelerCode(s.code);
        let art = 'neu';
        if (!code || db.prepare('SELECT 1 FROM schueler WHERE code = ?').get(code)) {
          code = konten.neuerSchuelerCode();
          art = 'neuerCode';
          bericht.schueler.neuerCode++;
        }
        const info = db
          .prepare('INSERT INTO schueler (name, name_key, code, code_neu, created_at, last_active_at, alt_quelle, alt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(n.name, n.key, code, art === 'neuerCode' ? 1 : 0, s.erstellt || iso(), s.zuletztAktiv || null, quelle, a);
        db.prepare('INSERT INTO kurs_mitglieder (kurs_id, schueler_id, seit) VALUES (?, ?, ?)').run(kid, info.lastInsertRowid, s.erstellt || iso());
        bericht.schueler.neu++;
        const eintrag = { altId: a, sub: subSchueler(Number(info.lastInsertRowid)), art };
        if (art === 'neuerCode') {
          eintrag.neuerCode = code;
          hinweis(`Schüler „${n.name}“ (Kurs ${kursId(kid)}): Code ${s.code} war schon vergeben – neuer Code ${code}.`);
        }
        zuordnung.schueler.push(eintrag);
      }
      if (probelauf) throw new Probelauf();
    });

    try {
      lauf();
    } catch (e) {
      if (!(e instanceof Probelauf)) throw e;
    }
    if (!plattformBekannt) hinweis(`Die Plattform „${quelle}“ ist im Portal nicht (nutzbar) eingetragen – Freischaltungen und Kurs-Plattformen bitte nachtragen.`);
    if (!probelauf) {
      db.prepare('INSERT INTO importe (quelle, bericht, zuordnung, created_at) VALUES (?, ?, ?, ?)').run(quelle, JSON.stringify(bericht), JSON.stringify(zuordnung), iso());
    }
    return { bericht, zuordnung };
  }

  function freischalten(lid, pid) {
    db.prepare('INSERT INTO lehrkraft_plattformen (lehrkraft_id, plattform_id, seit) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(lid, pid, iso());
  }

  function liste() {
    return db
      .prepare('SELECT id, quelle, bericht, created_at FROM importe ORDER BY id DESC')
      .all()
      .map((r) => ({ id: r.id, quelle: r.quelle, bericht: JSON.parse(r.bericht), erstellt: r.created_at }));
  }

  function zuordnung(id) {
    const r = db.prepare('SELECT zuordnung FROM importe WHERE id = ?').get(id);
    if (!r) throw new V.NotFoundError('Import nicht gefunden.');
    return JSON.parse(r.zuordnung);
  }

  return { ausfuehren, liste, zuordnung };
}

class Probelauf extends Error {}

module.exports = { createImport };

'use strict';
// Sicherung des Portals: JSON-Sicherung zum Herunterladen und Wiederherstellen (Superadmin) sowie tägliche
// automatische Kopien der Datenbank im Datenverzeichnis (DATA_DIR/sicherungen, die letzten 14 Tage).
// Der Signaturschlüssel ist bewusst NICHT enthalten (liegt als Datei in DATA_DIR bzw. in PORTAL_PRIVATE_KEY).

const fs = require('node:fs');
const path = require('node:path');
const V = require('../validate');
const { SCHEMA_VERSION, APP_KENNUNG } = require('../db');

// Reihenfolge = Abhängigkeiten (Fremdschlüssel); Wiederherstellen löscht rückwärts und fügt vorwärts ein.
const TABELLEN = [
  'lehrkraefte',
  'schueler',
  'plattformen',
  'kurse',
  'kurs_lehrkraefte',
  'kurs_einladungen',
  'kurs_mitglieder',
  'lehrkraft_plattformen',
  'kurs_plattformen',
  'sso_nutzung',
  'verbund_auftraege',
  'importe'
];
const BEHALTEN = 14;
const DATEI_MUSTER = /^portal-\d{4}-\d{2}-\d{2}\.db$/;

function createSicherung(ctx) {
  const { db } = ctx;
  const iso = () => new Date(ctx.now()).toISOString();

  /** Vollständige Sicherung als JSON (inkl. Passwort-Hashes – vertraulich behandeln). */
  function exportieren() {
    const tabellen = {};
    for (const t of TABELLEN) tabellen[t] = db.prepare(`SELECT * FROM ${t}`).all();
    const sequenzen = Object.fromEntries(db.prepare('SELECT name, seq FROM sqlite_sequence').all().map((r) => [r.name, r.seq]));
    return { app: APP_KENNUNG, format: 1, schemaVersion: SCHEMA_VERSION, erstellt: iso(), sequenzen, tabellen };
  }

  /**
   * Sicherung einspielen: ersetzt alle Daten. IDs werden danach nie unter den bisherigen Höchststand vergeben
   * (sonst könnte ein neues Konto die sub eines gelöschten erben, Vertrag §2). Alle Sitzungen enden.
   */
  function wiederherstellen(d) {
    if (!d || d.app !== APP_KENNUNG || d.format !== 1 || !d.tabellen || typeof d.tabellen !== 'object') {
      throw new V.ValidationError('Ungültige Datei (erwartet: InfoLabs-Sicherung, Format 1).');
    }
    if (d.schemaVersion !== SCHEMA_VERSION) throw new V.ValidationError(`Die Sicherung hat Schema ${d.schemaVersion}, das Portal ${SCHEMA_VERSION}.`);
    for (const k of Object.keys(d.tabellen)) if (!TABELLEN.includes(k)) throw new V.ValidationError(`Unbekannte Tabelle ${k}.`);
    const spalten = {};
    for (const t of TABELLEN) {
      spalten[t] = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      const zeilen = d.tabellen[t] || [];
      if (!Array.isArray(zeilen)) throw new V.ValidationError(`Tabelle ${t} ist keine Liste.`);
      for (const z of zeilen) {
        if (!z || typeof z !== 'object' || Array.isArray(z)) throw new V.ValidationError(`Ungültige Zeile in ${t}.`);
        for (const [k, w] of Object.entries(z)) {
          if (!spalten[t].has(k)) throw new V.ValidationError(`Unbekannte Spalte ${t}.${k}.`);
          if (w !== null && !['string', 'number'].includes(typeof w)) throw new V.ValidationError(`Ungültiger Wert in ${t}.${k}.`);
        }
      }
    }
    const vorher = Object.fromEntries(db.prepare('SELECT name, seq FROM sqlite_sequence').all().map((r) => [r.name, r.seq]));
    const anzahl = {};
    try {
      db.transaction(() => {
        for (const t of [...TABELLEN].reverse()) db.prepare(`DELETE FROM ${t}`).run();
        for (const t of TABELLEN) {
          const zeilen = d.tabellen[t] || [];
          anzahl[t] = zeilen.length;
          for (const z of zeilen) {
            const k = Object.keys(z);
            db.prepare(`INSERT INTO ${t} (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`).run(...k.map((x) => z[x]));
          }
        }
        // Höchststände der IDs: Maximum aus bisher, Sicherung und vorhandenen Zeilen
        const seq = d.sequenzen && typeof d.sequenzen === 'object' ? d.sequenzen : {};
        for (const t of new Set([...Object.keys(vorher), ...Object.keys(seq)])) {
          if (!TABELLEN.includes(t)) continue;
          const max = Math.max(Number(vorher[t]) || 0, Number(seq[t]) || 0, db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${t}`).get().m);
          db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t);
          db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(t, max);
        }
        db.prepare('UPDATE lehrkraefte SET session_gen = session_gen + 1').run();
        db.prepare('UPDATE schueler SET session_gen = session_gen + 1').run();
        const fk = db.prepare('PRAGMA foreign_key_check').all();
        if (fk.length) throw new V.ValidationError(`Die Sicherung ist unvollständig (${fk.length} fehlende Verweise, z. B. in ${fk[0].table}).`);
      })();
    } catch (e) {
      if (e instanceof V.ValidationError) throw e;
      throw new V.ValidationError(`Wiederherstellung fehlgeschlagen, nichts geändert: ${e.message}`);
    }
    return { anzahl };
  }

  /* ---------- automatische Kopien im Datenverzeichnis ---------- */

  const ordner = () => ctx.sicherungsDir || null;

  /** Kopie der Datenbank für heute anlegen (falls noch nicht vorhanden), ältere als die letzten 14 löschen. */
  function taeglich() {
    const dir = ordner();
    if (!dir) return null;
    fs.mkdirSync(dir, { recursive: true });
    const name = `portal-${V.tagBerlin(ctx.now())}.db`;
    const datei = path.join(dir, name);
    let neu = false;
    if (!fs.existsSync(datei)) {
      db.prepare('VACUUM INTO ?').run(datei);
      fs.chmodSync(datei, 0o600);
      neu = true;
    }
    const alle = fs.readdirSync(dir).filter((f) => DATEI_MUSTER.test(f)).sort();
    for (const f of alle.slice(0, Math.max(0, alle.length - BEHALTEN))) fs.unlinkSync(path.join(dir, f));
    return { name, neu };
  }

  function liste() {
    const dir = ordner();
    if (!dir || !fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => DATEI_MUSTER.test(f))
      .sort()
      .reverse()
      .map((f) => ({ name: f, groesse: fs.statSync(path.join(dir, f)).size }));
  }

  /** Pfad einer automatischen Kopie (nur gültige Namen, sonst 404). */
  function datei(name) {
    const dir = ordner();
    if (!dir || typeof name !== 'string' || !DATEI_MUSTER.test(name)) throw new V.NotFoundError('Sicherung nicht gefunden.');
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) throw new V.NotFoundError('Sicherung nicht gefunden.');
    return p;
  }

  return { exportieren, wiederherstellen, taeglich, liste, datei, TABELLEN };
}

module.exports = { createSicherung, TABELLEN };

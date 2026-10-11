'use strict';
// Löschung (Vertrag H.3/H.10): Das Portal löscht bei sich und stößt die Löschung auf allen betroffenen Plattformen an
// (POST /api/verbund/loeschen, als Auftrag mit Wiederholung). Schüler ohne Kurs werden mitgelöscht.

const { subLehrkraft, subSchueler } = require('./konten');

const kursId = (id) => 'k:' + id;

function createLoeschung(ctx, { verbund }) {
  const { db } = ctx;

  const plattformenVonKursen = (ids) =>
    ids.length ? db.prepare(`SELECT DISTINCT plattform_id FROM kurs_plattformen WHERE kurs_id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => r.plattform_id) : [];
  const plattformenVonSub = (sub) => db.prepare('SELECT plattform_id FROM sso_nutzung WHERE sub = ?').all(sub).map((r) => r.plattform_id);

  /** Schülerkonto löschen (Portal + alle Plattformen seiner Kurse bzw. seiner bisherigen Anmeldungen). */
  function schueler(id) {
    const sub = subSchueler(id);
    const kurse = db.prepare('SELECT kurs_id FROM kurs_mitglieder WHERE schueler_id = ?').all(id).map((r) => r.kurs_id);
    const ziele = [...plattformenVonSub(sub), ...plattformenVonKursen(kurse)];
    const n = db.transaction(() => {
      db.prepare('DELETE FROM sso_nutzung WHERE sub = ?').run(sub);
      return db.prepare('DELETE FROM schueler WHERE id = ?').run(id).changes;
    })();
    if (n) verbund.loescheSub(sub, ziele);
    return n;
  }

  /** Kurs löschen; Schüler, die danach in keinem Kurs mehr sind, werden mitgelöscht. */
  function kurs(id) {
    const ziele = plattformenVonKursen([id]);
    const mitglieder = db.prepare('SELECT schueler_id FROM kurs_mitglieder WHERE kurs_id = ?').all(id).map((r) => r.schueler_id);
    const n = db.prepare('DELETE FROM kurse WHERE id = ?').run(id).changes;
    if (!n) return { kurs: 0, schueler: 0 };
    verbund.loescheKurs(kursId(id), ziele);
    let geloescht = 0;
    for (const sid of mitglieder) {
      if (!db.prepare('SELECT 1 FROM kurs_mitglieder WHERE schueler_id = ?').get(sid)) geloescht += schueler(sid);
    }
    return { kurs: 1, schueler: geloescht };
  }

  /** Schüler aus einem Kurs entfernen; ohne weiteren Kurs wird das Konto gelöscht. */
  function ausKurs(kid, sid) {
    const n = db.prepare('DELETE FROM kurs_mitglieder WHERE kurs_id = ? AND schueler_id = ?').run(kid, sid).changes;
    if (!n) return { entfernt: 0, kontoGeloescht: false };
    const weiter = db.prepare('SELECT 1 FROM kurs_mitglieder WHERE schueler_id = ?').get(sid);
    if (!weiter) {
      schueler(sid);
      return { entfernt: 1, kontoGeloescht: true };
    }
    return { entfernt: 1, kontoGeloescht: false };
  }

  /** Lehrkraft mit allen eigenen Kursen löschen (Mitlehrkraft-Rollen entfallen). */
  function lehrkraft(id) {
    const r = db.prepare('SELECT * FROM lehrkraefte WHERE id = ?').get(id);
    if (!r) return { kurse: 0, schueler: 0 };
    const sub = subLehrkraft(r);
    const eigene = db.prepare('SELECT id FROM kurse WHERE inhaber_id = ?').all(id).map((k) => k.id);
    const mit = db.prepare('SELECT kurs_id FROM kurs_lehrkraefte WHERE lehrkraft_id = ?').all(id).map((k) => k.kurs_id);
    const freigeschaltet = db.prepare('SELECT plattform_id FROM lehrkraft_plattformen WHERE lehrkraft_id = ?').all(id).map((p) => p.plattform_id);
    const ziele = [...plattformenVonSub(sub), ...plattformenVonKursen([...eigene, ...mit]), ...freigeschaltet];
    let s = 0;
    for (const k of eigene) s += kurs(k).schueler;
    db.transaction(() => {
      db.prepare('DELETE FROM sso_nutzung WHERE sub = ?').run(sub);
      db.prepare('DELETE FROM lehrkraefte WHERE id = ?').run(id);
    })();
    verbund.loescheSub(sub, ziele);
    return { kurse: eigene.length, schueler: s };
  }

  return { schueler, kurs, ausKurs, lehrkraft };
}

module.exports = { createLoeschung, kursId };

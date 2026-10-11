'use strict';
// Kurse: gehören einer Lehrkraft (Inhaberin), haben Kurscode, Ablaufdatum, Mitlehrkräfte (per Einladung)
// und eine Liste freigeschalteter Plattformen (nur solche, für die die Inhaberin freigeschaltet ist).

const QRCode = require('qrcode');
const V = require('../validate');
const S = require('../security');
const { kursId } = require('./loeschung');
const { subSchueler } = require('./konten');

const { ValidationError, NotFoundError, ForbiddenError, ConflictError } = V;
const TAG_MS = 24 * 3600 * 1000;

function createKurse(ctx, { konten, plattformen, verbund, loeschung }) {
  const { db } = ctx;
  const iso = () => new Date(ctx.now()).toISOString();
  const heute = () => V.tagBerlin(ctx.now());

  /* ---------- Ablaufdatum ---------- */

  /** Standard: 31.07. des laufenden Schuljahres (ab Juni: des nächsten). */
  function standardAblauf() {
    const [j, m] = heute().split('-').map(Number);
    return `${m >= 6 ? j + 1 : j}-07-31`;
  }

  function spaetestesAblauf() {
    return V.tagBerlin(ctx.now() + 730 * TAG_MS);
  }

  function pruefeAblauf(wert) {
    const d = V.datum(wert, 'Ablaufdatum');
    if (d <= heute()) throw new ValidationError('Das Ablaufdatum muss in der Zukunft liegen.');
    if (d > spaetestesAblauf()) throw new ValidationError('Das Ablaufdatum darf höchstens 24 Monate in der Zukunft liegen.');
    return d;
  }

  const tageBis = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(heute() + 'T00:00:00Z')) / TAG_MS);

  /* ---------- Zugriff ---------- */

  const zeile = (id) => db.prepare('SELECT * FROM kurse WHERE id = ?').get(id);

  /** Kurs + Rolle der Lehrkraft darin (inhaber | mitlehrkraft | superadmin); sonst 404 (keine Auskunft über fremde Kurse). */
  function zugriff(lk, id) {
    const k = Number.isInteger(id) ? zeile(id) : null;
    if (!k) throw new NotFoundError('Kurs nicht gefunden.');
    if (k.inhaber_id === lk.id) return { k, rolle: 'inhaber' };
    if (db.prepare('SELECT 1 FROM kurs_lehrkraefte WHERE kurs_id = ? AND lehrkraft_id = ?').get(k.id, lk.id)) return { k, rolle: 'mitlehrkraft' };
    if (lk.rolle === 'superadmin') return { k, rolle: 'superadmin' };
    throw new NotFoundError('Kurs nicht gefunden.');
  }

  function nurInhaber(z) {
    if (z.rolle === 'mitlehrkraft') throw new ForbiddenError('Das darf nur die Lehrkraft, der der Kurs gehört.');
  }

  /* ---------- Ansichten ---------- */

  function kursPlattformen(k) {
    const inhaber = konten.lkZeile(k.inhaber_id);
    return db
      .prepare('SELECT kp.plattform_id, kp.aktiv FROM kurs_plattformen kp WHERE kp.kurs_id = ? ORDER BY kp.plattform_id')
      .all(k.id)
      .map((r) => {
        let p = null;
        try {
          p = plattformen.get(r.plattform_id);
        } catch {
          p = null;
        }
        return {
          id: r.plattform_id,
          name: p ? p.name : r.plattform_id,
          farbe: p ? p.farbe : '#1F4E79',
          aktiv: r.aktiv === 1,
          nutzbar: plattformen.nutzbar(r.plattform_id),
          inhaberFreigeschaltet: !!inhaber && konten.freigeschaltet(inhaber, r.plattform_id)
        };
      });
  }

  function kennzahlen(k) {
    const grenze = new Date(ctx.now() - 7 * TAG_MS).toISOString();
    const schueler = db.prepare('SELECT COUNT(*) AS n FROM kurs_mitglieder WHERE kurs_id = ?').get(k.id).n;
    const aktiv7 = db
      .prepare('SELECT COUNT(*) AS n FROM kurs_mitglieder m JOIN schueler s ON s.id = m.schueler_id WHERE m.kurs_id = ? AND s.last_active_at >= ?')
      .get(k.id, grenze).n;
    const nutzung = db
      .prepare(
        `SELECT u.plattform_id AS plattform, COUNT(*) AS schueler, MAX(u.letzte) AS zuletzt
         FROM kurs_mitglieder m JOIN sso_nutzung u ON u.sub = 's:' || m.schueler_id
         WHERE m.kurs_id = ? GROUP BY u.plattform_id`
      )
      .all(k.id);
    return { schueler, aktiv7, nutzung };
  }

  function ansicht(k, rolle) {
    const inhaber = konten.lkZeile(k.inhaber_id);
    const ablaufInTagen = tageBis(k.ablauf);
    return {
      id: k.id,
      kursId: kursId(k.id),
      name: k.name,
      code: k.code,
      beitrittOffen: k.beitritt_offen === 1,
      ablauf: k.ablauf,
      ablaufInTagen,
      ablaufBald: ablaufInTagen <= 30,
      rolle,
      inhaber: inhaber ? { id: inhaber.id, name: inhaber.name } : null,
      lehrkraefte: db
        .prepare('SELECT l.id, l.name, l.email FROM kurs_lehrkraefte kl JOIN lehrkraefte l ON l.id = kl.lehrkraft_id WHERE kl.kurs_id = ? ORDER BY l.name')
        .all(k.id),
      einladungen: db.prepare('SELECT id, email, created_at AS erstellt FROM kurs_einladungen WHERE kurs_id = ? ORDER BY id').all(k.id),
      plattformen: kursPlattformen(k),
      kennzahlen: kennzahlen(k),
      link: `${ctx.portalUrl}/?kurs=${k.code}`,
      importiert: k.alt_quelle || null,
      erstellt: k.created_at
    };
  }

  function listeFuer(lk) {
    const zeilen =
      lk.rolle === 'superadmin'
        ? db.prepare('SELECT * FROM kurse ORDER BY name COLLATE NOCASE').all()
        : db
            .prepare(
              `SELECT * FROM kurse WHERE inhaber_id = ? OR id IN (SELECT kurs_id FROM kurs_lehrkraefte WHERE lehrkraft_id = ?)
               ORDER BY name COLLATE NOCASE`
            )
            .all(lk.id, lk.id);
    return zeilen.map((k) => ansicht(k, k.inhaber_id === lk.id ? 'inhaber' : lk.rolle === 'superadmin' && !istMit(k.id, lk.id) ? 'superadmin' : 'mitlehrkraft'));
  }

  const istMit = (kid, lid) => !!db.prepare('SELECT 1 FROM kurs_lehrkraefte WHERE kurs_id = ? AND lehrkraft_id = ?').get(kid, lid);

  function get(lk, id) {
    const z = zugriff(lk, id);
    return ansicht(z.k, z.rolle);
  }

  /* ---------- Anlegen und Ändern ---------- */

  function neuerKurscode() {
    for (let i = 0; i < 200; i++) {
      const c = S.kursCode();
      if (!db.prepare('SELECT 1 FROM kurse WHERE code = ?').get(c)) return c;
    }
    throw new Error('Kein freier Kurscode gefunden.');
  }

  function pruefePlattformListe(liste, inhaber) {
    if (!Array.isArray(liste) || liste.length > 50) throw new ValidationError('Plattformen: Liste erwartet.');
    const ids = [...new Set(liste.map((p) => V.plattformId(p)))];
    for (const pid of ids) {
      if (!plattformen.nutzbar(pid)) throw new ValidationError(`Die Plattform „${pid}“ ist nicht verfügbar.`);
      if (!konten.freigeschaltet(inhaber, pid)) throw new ForbiddenError(`Für die Plattform „${pid}“ ist die Lehrkraft des Kurses nicht freigeschaltet.`);
    }
    return ids;
  }

  function anlegen(lk, b) {
    b = b || {};
    const name = V.str(b.name, 'Kursname', { min: 2, max: 80 });
    const ablauf = b.ablauf ? pruefeAblauf(b.ablauf) : standardAblauf();
    const ids = pruefePlattformListe(b.plattformen || [], lk);
    const id = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO kurse (name, code, inhaber_id, beitritt_offen, ablauf, created_at) VALUES (?, ?, ?, 1, ?, ?)')
        .run(name, neuerKurscode(), lk.id, ablauf, iso());
      for (const pid of ids) db.prepare('INSERT INTO kurs_plattformen (kurs_id, plattform_id, aktiv, seit) VALUES (?, ?, 1, ?)').run(info.lastInsertRowid, pid, iso());
      return Number(info.lastInsertRowid);
    })();
    return ansicht(zeile(id), 'inhaber');
  }

  function aendern(lk, id, b) {
    const z = zugriff(lk, id);
    const k = z.k;
    b = b || {};
    if (b.name !== undefined) {
      const name = V.str(b.name, 'Kursname', { min: 2, max: 80 });
      if (name !== k.name) {
        db.prepare('UPDATE kurse SET name = ? WHERE id = ?').run(name, k.id);
        const alle = db.prepare('SELECT plattform_id FROM kurs_plattformen WHERE kurs_id = ?').all(k.id).map((r) => r.plattform_id);
        verbund.kursGeaendert(kursId(k.id), alle, { name });
      }
    }
    if (b.beitrittOffen !== undefined) db.prepare('UPDATE kurse SET beitritt_offen = ? WHERE id = ?').run(V.bool(b.beitrittOffen, 'Beitritt offen') ? 1 : 0, k.id);
    if (b.ablauf !== undefined) {
      nurInhaber(z);
      db.prepare('UPDATE kurse SET ablauf = ? WHERE id = ?').run(pruefeAblauf(b.ablauf), k.id);
    }
    if (b.plattformen !== undefined) {
      nurInhaber(z);
      setzePlattformen(k, b.plattformen);
    }
    return ansicht(zeile(k.id), z.rolle);
  }

  function setzePlattformen(k, liste) {
    const inhaber = konten.lkZeile(k.inhaber_id);
    const neu = new Set(pruefePlattformListe(liste, inhaber));
    const bisher = db.prepare('SELECT plattform_id, aktiv FROM kurs_plattformen WHERE kurs_id = ?').all(k.id);
    const name = zeile(k.id).name;
    const aus = [];
    const wieder = [];
    db.transaction(() => {
      for (const r of bisher) {
        if (r.aktiv && !neu.has(r.plattform_id)) {
          db.prepare('UPDATE kurs_plattformen SET aktiv = 0 WHERE kurs_id = ? AND plattform_id = ?').run(k.id, r.plattform_id);
          aus.push(r.plattform_id);
        } else if (!r.aktiv && neu.has(r.plattform_id)) {
          db.prepare('UPDATE kurs_plattformen SET aktiv = 1 WHERE kurs_id = ? AND plattform_id = ?').run(k.id, r.plattform_id);
          wieder.push(r.plattform_id);
        }
      }
      for (const pid of neu) {
        if (!bisher.some((r) => r.plattform_id === pid)) db.prepare('INSERT INTO kurs_plattformen (kurs_id, plattform_id, aktiv, seit) VALUES (?, ?, 1, ?)').run(k.id, pid, iso());
      }
    })();
    if (aus.length) verbund.kursGeaendert(kursId(k.id), aus, { name, aktiv: false });
    if (wieder.length) verbund.kursGeaendert(kursId(k.id), wieder, { name, aktiv: true });
  }

  function neuerKurscodeFuer(lk, id) {
    const z = zugriff(lk, id);
    db.prepare('UPDATE kurse SET code = ? WHERE id = ?').run(neuerKurscode(), z.k.id);
    return ansicht(zeile(z.k.id), z.rolle);
  }

  function loeschen(lk, id, bestaetigung) {
    const z = zugriff(lk, id);
    nurInhaber(z);
    if (typeof bestaetigung !== 'string' || bestaetigung.trim() !== z.k.name) throw new ValidationError('Zur Bestätigung bitte den Kursnamen genau eingeben.');
    return loeschung.kurs(z.k.id);
  }

  async function qrSvg(lk, id) {
    const z = zugriff(lk, id);
    return QRCode.toString(`${ctx.portalUrl}/?kurs=${z.k.code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1F4E79', light: '#FFFFFF' } });
  }

  /* ---------- Schüler eines Kurses ---------- */

  function schuelerListe(lk, id) {
    const z = zugriff(lk, id);
    return db
      .prepare(
        `SELECT s.*, m.seit,
           (SELECT COUNT(*) - 1 FROM kurs_mitglieder m2 WHERE m2.schueler_id = s.id) AS weitere
         FROM kurs_mitglieder m JOIN schueler s ON s.id = m.schueler_id
         WHERE m.kurs_id = ? ORDER BY s.name COLLATE NOCASE`
      )
      .all(z.k.id)
      .map((s) => ({
        id: s.id,
        sub: subSchueler(s.id),
        name: s.name,
        code: s.code,
        codeNeu: s.code_neu === 1,
        weitereKurse: s.weitere,
        beigetreten: s.seit,
        zuletzt: s.last_active_at,
        plattformen: db.prepare('SELECT plattform_id AS id, letzte FROM sso_nutzung WHERE sub = ?').all(subSchueler(s.id))
      }));
  }

  function mitglied(z, sid) {
    const s = Number.isInteger(sid) ? db.prepare('SELECT s.* FROM kurs_mitglieder m JOIN schueler s ON s.id = m.schueler_id WHERE m.kurs_id = ? AND s.id = ?').get(z.k.id, sid) : null;
    if (!s) throw new NotFoundError('Schüler nicht gefunden.');
    return s;
  }

  function schuelerUmbenennen(lk, id, sid, nameEingabe) {
    const z = zugriff(lk, id);
    const s = mitglied(z, sid);
    const { name, key } = V.schuelerName(nameEingabe);
    const kurse = db.prepare('SELECT kurs_id FROM kurs_mitglieder WHERE schueler_id = ?').all(s.id);
    for (const r of kurse) if (!konten.nameImKursFrei(r.kurs_id, key, s.id)) throw new ConflictError('Diesen Namen gibt es in einem Kurs dieses Schülers schon.');
    db.prepare('UPDATE schueler SET name = ?, name_key = ? WHERE id = ?').run(name, key, s.id);
    return { id: s.id, name };
  }

  function schuelerNeuerCode(lk, id, sid) {
    const z = zugriff(lk, id);
    const s = mitglied(z, sid);
    const code = konten.neuerSchuelerCode();
    db.prepare('UPDATE schueler SET code = ?, code_neu = 0, session_gen = session_gen + 1 WHERE id = ?').run(code, s.id);
    return { id: s.id, name: s.name, code };
  }

  function schuelerEntfernen(lk, id, sid) {
    const z = zugriff(lk, id);
    const s = mitglied(z, sid);
    return loeschung.ausKurs(z.k.id, s.id);
  }

  /* ---------- Mitlehrkräfte ---------- */

  function einladen(lk, id, emailEingabe) {
    const z = zugriff(lk, id);
    nurInhaber(z);
    const email = V.email(emailEingabe);
    const inhaber = konten.lkZeile(z.k.inhaber_id);
    if (inhaber && inhaber.email === email) throw new ConflictError('Diese Lehrkraft ist bereits Inhaberin des Kurses.');
    if (db.prepare('SELECT 1 FROM kurs_lehrkraefte kl JOIN lehrkraefte l ON l.id = kl.lehrkraft_id WHERE kl.kurs_id = ? AND l.email = ?').get(z.k.id, email)) {
      throw new ConflictError('Diese Lehrkraft gehört schon zum Kurs.');
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM kurs_einladungen WHERE kurs_id = ?').get(z.k.id).n >= 20) throw new ValidationError('Zu viele offene Einladungen.');
    db.prepare('INSERT INTO kurs_einladungen (kurs_id, email, von_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(kurs_id, email) DO NOTHING').run(z.k.id, email, lk.id, iso());
    return ansicht(zeile(z.k.id), z.rolle);
  }

  function einladungZurueckziehen(lk, id, eid) {
    const z = zugriff(lk, id);
    nurInhaber(z);
    db.prepare('DELETE FROM kurs_einladungen WHERE id = ? AND kurs_id = ?').run(eid, z.k.id);
    return ansicht(zeile(z.k.id), z.rolle);
  }

  /** Mitlehrkraft entfernen (Inhaberin) oder selbst austreten (Mitlehrkraft). */
  function mitlehrkraftEntfernen(lk, id, lid) {
    const z = zugriff(lk, id);
    if (z.rolle === 'mitlehrkraft' && lid !== lk.id) throw new ForbiddenError('Das darf nur die Lehrkraft, der der Kurs gehört.');
    const n = db.prepare('DELETE FROM kurs_lehrkraefte WHERE kurs_id = ? AND lehrkraft_id = ?').run(z.k.id, lid).changes;
    if (!n) throw new NotFoundError('Lehrkraft gehört nicht zum Kurs.');
    return { ok: true };
  }

  function meineEinladungen(lk) {
    return db
      .prepare(
        `SELECT e.id, e.created_at AS erstellt, k.name AS kurs, l.name AS von
         FROM kurs_einladungen e JOIN kurse k ON k.id = e.kurs_id LEFT JOIN lehrkraefte l ON l.id = e.von_id
         WHERE e.email = ? ORDER BY e.id`
      )
      .all(lk.email);
  }

  function einladungBeantworten(lk, eid, annehmen) {
    const e = db.prepare('SELECT * FROM kurs_einladungen WHERE id = ? AND email = ?').get(eid, lk.email);
    if (!e) throw new NotFoundError('Einladung nicht gefunden.');
    db.transaction(() => {
      db.prepare('DELETE FROM kurs_einladungen WHERE id = ?').run(e.id);
      if (annehmen) {
        const k = zeile(e.kurs_id);
        if (k && k.inhaber_id !== lk.id) {
          db.prepare('INSERT INTO kurs_lehrkraefte (kurs_id, lehrkraft_id, seit) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(e.kurs_id, lk.id, iso());
        }
      }
    })();
    return { ok: true };
  }

  /* ---------- Schüler-Sicht ---------- */

  /** Kurse eines Schülers mit nutzbaren Plattformen (Startseite „Weiter zu …“). */
  function fuerSchueler(sid) {
    return db
      .prepare('SELECT k.* FROM kurs_mitglieder m JOIN kurse k ON k.id = m.kurs_id WHERE m.schueler_id = ? ORDER BY k.name COLLATE NOCASE')
      .all(sid)
      .map((k) => {
        const inhaber = konten.lkZeile(k.inhaber_id);
        return {
          id: k.id,
          name: k.name,
          lehrkraft: inhaber ? inhaber.name : '',
          plattformen: db
            .prepare('SELECT plattform_id FROM kurs_plattformen WHERE kurs_id = ? AND aktiv = 1')
            .all(k.id)
            .map((r) => r.plattform_id)
            .filter((pid) => plattformen.nutzbar(pid))
        };
      });
  }

  /* ---------- Wartung ---------- */

  /** Kurse nach Ablaufdatum löschen (inkl. Verbund-Löschung). */
  function abgelaufeneLoeschen() {
    const ids = db.prepare('SELECT id FROM kurse WHERE ablauf < ?').all(heute()).map((r) => r.id);
    let schueler = 0;
    for (const id of ids) schueler += loeschung.kurs(id).schueler;
    return { kurse: ids.length, schueler };
  }

  /** Öffentliche Kurzinfo zum Kurscode (Beitrittsseite). */
  function info(code) {
    const c = V.kursCode(code);
    const k = c ? db.prepare('SELECT * FROM kurse WHERE code = ?').get(c) : null;
    if (!k) throw new NotFoundError('Diesen Kurscode gibt es nicht.');
    return { name: k.name, offen: k.beitritt_offen === 1 };
  }

  return {
    standardAblauf,
    zeile,
    zugriff,
    listeFuer,
    get,
    anlegen,
    aendern,
    neuerKurscode,
    neuerKurscodeFuer,
    loeschen,
    qrSvg,
    schuelerListe,
    schuelerUmbenennen,
    schuelerNeuerCode,
    schuelerEntfernen,
    einladen,
    einladungZurueckziehen,
    mitlehrkraftEntfernen,
    meineEinladungen,
    einladungBeantworten,
    fuerSchueler,
    abgelaufeneLoeschen,
    info
  };
}

module.exports = { createKurse };

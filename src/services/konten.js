'use strict';
// Konten: Superadmin (aus der Umgebung), Lehrkräfte (Registrierung auf Anfrage, Freigabe, Freischaltung je Plattform),
// Schüler (Beitritt mit Kurscode + Name → persönlicher Code, Anmeldung mit Name + Code; ein Konto für mehrere Kurse).

const V = require('../validate');
const S = require('../security');

const { ValidationError, NotFoundError, ForbiddenError, ConflictError } = V;

/** sub nach Vertrag §2 */
const subLehrkraft = (r) => (r.rolle === 'superadmin' ? 'a:' : 'l:') + r.id;
const subSchueler = (id) => 's:' + id;

function createKonten(ctx, { loeschung }) {
  const { db } = ctx;
  const iso = () => new Date(ctx.now()).toISOString();

  /* ---------- Lehrkräfte ---------- */

  const lkZeile = (id) => db.prepare('SELECT * FROM lehrkraefte WHERE id = ?').get(id);

  function freischaltungen(id) {
    return db.prepare('SELECT plattform_id FROM lehrkraft_plattformen WHERE lehrkraft_id = ? ORDER BY plattform_id').all(id).map((r) => r.plattform_id);
  }

  function lkAnsicht(r) {
    if (!r) return null;
    return {
      id: r.id,
      sub: subLehrkraft(r),
      email: r.email,
      name: r.name,
      schule: r.schule,
      nachricht: r.nachricht,
      rolle: r.rolle,
      status: r.status,
      mussPasswortAendern: r.muss_pw_aendern === 1,
      plattformen: r.rolle === 'superadmin' ? db.prepare('SELECT id FROM plattformen ORDER BY reihenfolge, id').all().map((p) => p.id) : freischaltungen(r.id),
      importiert: r.alt_quelle || null,
      erstellt: r.created_at,
      entschieden: r.entschieden_at,
      letzterLogin: r.last_login_at
    };
  }

  /**
   * Superadmin aus ADMIN_EMAIL/ADMIN_PASSWORD anlegen bzw. aktualisieren. Das Konto (und damit sub a:<id>) bleibt stabil.
   * Ohne Passwort bleibt ein vorhandenes Konto bestehen, der Login ist dann gesperrt.
   */
  function sichereSuperadmin(email, passwort) {
    const mail = String(email || 'admin').trim().toLowerCase() || 'admin';
    const vorhanden = db.prepare("SELECT * FROM lehrkraefte WHERE rolle = 'superadmin' ORDER BY id LIMIT 1").get();
    if (!passwort) return vorhanden ? vorhanden.id : null;
    const konflikt = db.prepare("SELECT id FROM lehrkraefte WHERE email = ? AND rolle != 'superadmin'").get(mail);
    if (konflikt) throw new Error(`ADMIN_EMAIL „${mail}“ gehört bereits einer Lehrkraft – bitte eine andere Adresse wählen.`);
    if (!vorhanden) {
      const info = db
        .prepare("INSERT INTO lehrkraefte (email, name, pw_hash, rolle, status, created_at, entschieden_at) VALUES (?, 'Admin', ?, 'superadmin', 'aktiv', ?, ?)")
        .run(mail, S.hashPasswortSync(passwort), iso(), iso());
      return Number(info.lastInsertRowid);
    }
    if (vorhanden.email !== mail) db.prepare('UPDATE lehrkraefte SET email = ? WHERE id = ?').run(mail, vorhanden.id);
    // Anzeigename (geht per SSO als „name“ an die Plattformen): früherer Standard „Superadmin“ → „Admin“.
    // Die Rolle bleibt „superadmin“ (Vertrag §5), nur der sichtbare Name ändert sich.
    if (vorhanden.name === 'Superadmin') db.prepare("UPDATE lehrkraefte SET name = 'Admin' WHERE id = ?").run(vorhanden.id);
    if (!S.pruefePasswortSync(passwort, vorhanden.pw_hash)) {
      db.prepare('UPDATE lehrkraefte SET pw_hash = ?, session_gen = session_gen + 1 WHERE id = ?').run(S.hashPasswortSync(passwort), vorhanden.id);
    }
    if (vorhanden.status !== 'aktiv') db.prepare("UPDATE lehrkraefte SET status = 'aktiv' WHERE id = ?").run(vorhanden.id);
    return vorhanden.id;
  }

  async function registrieren(input) {
    const b = input || {};
    const name = V.str(b.name, 'Name', { min: 2, max: 80 });
    const email = V.email(b.email);
    const schule = V.str(b.schule, 'Schule', { min: 2, max: 120 });
    const nachricht = V.str(b.nachricht === undefined ? '' : b.nachricht, 'Nachricht', { max: 1000 });
    const pw = V.passwort(b.passwort);
    if (db.prepare('SELECT 1 FROM lehrkraefte WHERE email = ?').get(email)) {
      throw new ConflictError('Für diese E-Mail-Adresse gibt es bereits ein Konto oder eine Anfrage.');
    }
    const hash = await S.hashPasswort(pw);
    const info = db
      .prepare("INSERT INTO lehrkraefte (email, name, schule, nachricht, pw_hash, rolle, status, created_at) VALUES (?, ?, ?, ?, ?, 'lehrkraft', 'wartet', ?)")
      .run(email, name, schule, nachricht, hash, iso());
    return lkAnsicht(lkZeile(info.lastInsertRowid));
  }

  /** Login prüfen (401 falsche Daten, 403 Status). */
  async function anmeldenLehrkraft(email, passwort, { superadminAktiv }) {
    const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const pw = typeof passwort === 'string' ? passwort : '';
    const r = mail ? db.prepare('SELECT * FROM lehrkraefte WHERE email = ?').get(mail) : null;
    const ok = await S.pruefePasswort(pw, r ? r.pw_hash : null);
    if (!r || !ok) throw Object.assign(new Error('E-Mail oder Passwort falsch.'), { status: 401 });
    if (r.rolle === 'superadmin' && !superadminAktiv) throw new ForbiddenError('Der Admin-Login ist deaktiviert (ADMIN_PASSWORD nicht gesetzt).');
    if (r.status === 'wartet') throw new ForbiddenError('Ihre Registrierung wartet noch auf die Freigabe durch den Administrator.');
    if (r.status === 'abgelehnt') throw new ForbiddenError('Ihre Registrierung wurde abgelehnt.');
    if (r.status === 'deaktiviert') throw new ForbiddenError('Ihr Konto ist deaktiviert. Bitte wenden Sie sich an den Administrator.');
    db.prepare('UPDATE lehrkraefte SET last_login_at = ? WHERE id = ?').run(iso(), r.id);
    return lkZeile(r.id);
  }

  function lehrkraftAusSitzung(id, gen, { superadminAktiv }) {
    const r = lkZeile(id);
    if (!r || r.session_gen !== gen || r.status !== 'aktiv') return null;
    if (r.rolle === 'superadmin' && !superadminAktiv) return null;
    return r;
  }

  async function passwortAendern(id, alt, neu) {
    const r = lkZeile(id);
    if (!r) throw new NotFoundError('Konto nicht gefunden.');
    if (r.rolle === 'superadmin') throw new ForbiddenError('Das Admin-Passwort wird über die Umgebungsvariable ADMIN_PASSWORD festgelegt.');
    if (!(await S.pruefePasswort(typeof alt === 'string' ? alt : '', r.pw_hash))) throw new ValidationError('Das bisherige Passwort ist falsch.');
    const pw = V.passwort(neu, 'Neues Passwort');
    if (pw === alt) throw new ValidationError('Das neue Passwort muss sich vom bisherigen unterscheiden.');
    const hash = await S.hashPasswort(pw);
    db.prepare('UPDATE lehrkraefte SET pw_hash = ?, muss_pw_aendern = 0, session_gen = session_gen + 1 WHERE id = ?').run(hash, id);
    return lkZeile(id);
  }

  /** Lehrkraft für die Plattform freigeschaltet? (Superadmin: immer) */
  function freigeschaltet(r, plattformId) {
    if (r.rolle === 'superadmin') return true;
    return !!db.prepare('SELECT 1 FROM lehrkraft_plattformen WHERE lehrkraft_id = ? AND plattform_id = ?').get(r.id, plattformId);
  }

  /* ---------- Superadmin: Lehrkräfte verwalten ---------- */

  function listeLehrkraefte() {
    return db
      .prepare(
        `SELECT l.*,
           (SELECT COUNT(*) FROM kurse k WHERE k.inhaber_id = l.id) AS kurse,
           (SELECT COUNT(*) FROM kurs_lehrkraefte kl WHERE kl.lehrkraft_id = l.id) AS mitKurse
         FROM lehrkraefte l
         ORDER BY CASE l.rolle WHEN 'superadmin' THEN 0 ELSE 1 END,
                  CASE l.status WHEN 'wartet' THEN 0 WHEN 'aktiv' THEN 1 WHEN 'deaktiviert' THEN 2 ELSE 3 END, l.created_at DESC`
      )
      .all()
      .map((r) => ({ ...lkAnsicht(r), kurse: r.kurse, mitKurse: r.mitKurse }));
  }

  function normalesKonto(id) {
    const r = lkZeile(id);
    if (!r) throw new NotFoundError('Lehrkraft nicht gefunden.');
    if (r.rolle === 'superadmin') throw new ForbiddenError('Das Admin-Konto kann hier nicht geändert werden.');
    return r;
  }

  function setzeStatus(id, status) {
    const r = normalesKonto(id);
    const erlaubt = { aktiv: ['wartet', 'deaktiviert', 'abgelehnt'], abgelehnt: ['wartet'], deaktiviert: ['aktiv'] };
    if (!erlaubt[status] || !erlaubt[status].includes(r.status)) {
      throw new ValidationError(`Statuswechsel von „${r.status}“ nach „${status}“ ist nicht möglich.`);
    }
    db.prepare('UPDATE lehrkraefte SET status = ?, entschieden_at = ?, session_gen = session_gen + 1 WHERE id = ?').run(status, iso(), id);
    return lkAnsicht(lkZeile(id));
  }

  /** Einmal-Passwort: wird genau einmal angezeigt, muss beim nächsten Login geändert werden. */
  async function einmalPasswort(id) {
    normalesKonto(id);
    const pw = S.einmalPasswort();
    const hash = await S.hashPasswort(pw);
    db.prepare('UPDATE lehrkraefte SET pw_hash = ?, muss_pw_aendern = 1, session_gen = session_gen + 1 WHERE id = ?').run(hash, id);
    return { passwort: pw, konto: lkAnsicht(lkZeile(id)) };
  }

  /** Freischaltung je Plattform setzen (Liste ersetzt die bisherige). */
  function setzeFreischaltungen(id, plattformen) {
    normalesKonto(id);
    if (!Array.isArray(plattformen) || plattformen.length > 100) throw new ValidationError('Plattformen: Liste erwartet.');
    const ids = [...new Set(plattformen.map((p) => V.plattformId(p)))];
    for (const pid of ids) {
      const p = db.prepare('SELECT vorlaeufig FROM plattformen WHERE id = ?').get(pid);
      if (!p) throw new ValidationError(`Plattform „${pid}“ ist nicht eingetragen.`);
      if (p.vorlaeufig) throw new ValidationError(`Plattform „${pid}“ ist nur vorläufig eingetragen (kein Manifest).`);
    }
    db.transaction(() => {
      db.prepare('DELETE FROM lehrkraft_plattformen WHERE lehrkraft_id = ?').run(id);
      for (const pid of ids) db.prepare('INSERT INTO lehrkraft_plattformen (lehrkraft_id, plattform_id, seit) VALUES (?, ?, ?)').run(id, pid, iso());
    })();
    return lkAnsicht(lkZeile(id));
  }

  function loescheLehrkraft(id) {
    normalesKonto(id);
    return loeschung.lehrkraft(id);
  }

  /* ---------- Schüler ---------- */

  const sZeile = (id) => db.prepare('SELECT * FROM schueler WHERE id = ?').get(id);

  /** Eindeutigen persönlichen Code erzeugen (kursübergreifend eindeutig). */
  function neuerSchuelerCode() {
    for (let i = 0; i < 200; i++) {
      const c = S.schuelerCode();
      if (!db.prepare('SELECT 1 FROM schueler WHERE code = ?').get(c)) return c;
    }
    throw new Error('Kein freier Code gefunden.');
  }

  function kursZumBeitritt(kurscode) {
    const code = V.kursCode(kurscode);
    const k = code ? db.prepare('SELECT * FROM kurse WHERE code = ?').get(code) : null;
    if (!k) throw new NotFoundError('Diesen Kurscode gibt es nicht. Prüfe die Schreibweise.');
    if (!k.beitritt_offen) throw new ForbiddenError('Der Beitritt zu diesem Kurs ist geschlossen. Frag deine Lehrkraft.');
    return k;
  }

  function nameImKursFrei(kursId, key, ausser = 0) {
    return !db.prepare('SELECT 1 FROM kurs_mitglieder m JOIN schueler s ON s.id = m.schueler_id WHERE m.kurs_id = ? AND s.name_key = ? AND s.id != ?').get(kursId, key, ausser);
  }

  /** Neuer Schüler: Kurscode + selbst gewählter Name → Konto mit persönlichem Code. */
  function beitreten(kurscode, nameEingabe) {
    const k = kursZumBeitritt(kurscode);
    const { name, key } = V.schuelerName(nameEingabe);
    if (!nameImKursFrei(k.id, key)) {
      throw new ConflictError('Diesen Namen gibt es in diesem Kurs schon. Wenn du das bist: Melde dich mit Name und Code an. Sonst wähle einen anderen Namen (z. B. mit Initial).');
    }
    const code = neuerSchuelerCode();
    const id = db.transaction(() => {
      const info = db.prepare('INSERT INTO schueler (name, name_key, code, created_at, last_active_at) VALUES (?, ?, ?, ?, ?)').run(name, key, code, iso(), iso());
      db.prepare('INSERT INTO kurs_mitglieder (kurs_id, schueler_id, seit) VALUES (?, ?, ?)').run(k.id, info.lastInsertRowid, iso());
      return Number(info.lastInsertRowid);
    })();
    return sZeile(id);
  }

  /** Angemeldeter Schüler tritt einem weiteren Kurs bei. */
  function weitererKurs(schuelerId, kurscode) {
    const s = sZeile(schuelerId);
    if (!s) throw new NotFoundError('Konto nicht gefunden.');
    const k = kursZumBeitritt(kurscode);
    if (db.prepare('SELECT 1 FROM kurs_mitglieder WHERE kurs_id = ? AND schueler_id = ?').get(k.id, s.id)) throw new ConflictError('Du bist schon in diesem Kurs.');
    if (!nameImKursFrei(k.id, s.name_key, s.id)) throw new ConflictError('In diesem Kurs gibt es deinen Namen schon. Bitte deine Lehrkraft, einen von beiden umzubenennen.');
    db.prepare('INSERT INTO kurs_mitglieder (kurs_id, schueler_id, seit) VALUES (?, ?, ?)').run(k.id, s.id, iso());
    return { id: k.id, name: k.name };
  }

  /** Weiterlernen mit Name + persönlichem Code (Groß-/Kleinschreibung und Bindestrich egal). */
  function anmeldenSchueler(nameEingabe, codeEingabe) {
    const fehler = () => Object.assign(new Error('Name oder Code stimmen nicht. Prüfe beides – den Code findest du in deinen Notizen.'), { status: 401 });
    const code = S.normSchuelerCode(codeEingabe);
    let key;
    try {
      key = V.schuelerName(nameEingabe).key;
    } catch {
      throw fehler();
    }
    const s = code ? db.prepare('SELECT * FROM schueler WHERE code = ?').get(code) : null;
    if (!s || !S.safeEqual(s.name_key, key)) throw fehler();
    db.prepare('UPDATE schueler SET last_active_at = ? WHERE id = ?').run(iso(), s.id);
    return s;
  }

  function schuelerAusSitzung(id, gen) {
    const s = sZeile(id);
    if (!s || s.session_gen !== gen) return null;
    return s;
  }

  function aktivMerken(id) {
    db.prepare('UPDATE schueler SET last_active_at = ? WHERE id = ?').run(iso(), id);
  }

  return {
    subLehrkraft,
    subSchueler,
    lkZeile,
    lkAnsicht,
    sichereSuperadmin,
    registrieren,
    anmeldenLehrkraft,
    lehrkraftAusSitzung,
    passwortAendern,
    freigeschaltet,
    listeLehrkraefte,
    setzeStatus,
    einmalPasswort,
    setzeFreischaltungen,
    loescheLehrkraft,
    sZeile,
    neuerSchuelerCode,
    beitreten,
    weitererKurs,
    anmeldenSchueler,
    schuelerAusSitzung,
    aktivMerken,
    nameImKursFrei
  };
}

module.exports = { createKonten, subLehrkraft, subSchueler };

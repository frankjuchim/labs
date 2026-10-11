'use strict';
// Single Sign-on nach Vertrag H.5: /sso/autorisieren prüft Plattform, Rücksprung-Adresse (Whitelist) und Berechtigung
// und stellt ein einmal verwendbares, kurzlebiges Token (Ed25519-JWT) aus.

const crypto = require('node:crypto');
const { signiere } = require('../jwt');
const { kursId } = require('./loeschung');

const TOKEN_DAUER_SEK = 90; // Vertrag: exp − iat ≤ 120 s
const STATE_MUSTER = /^[A-Za-z0-9_\-.~]{22,256}$/; // ≥ 128 bit Zufall (z. B. 16 Byte base64url = 22 Zeichen)
const ZIEL_MUSTER = /^\/(?![/\\])[^\s\\]{0,499}$/;

function createSso(ctx, { konten, plattformen }) {
  const { db } = ctx;
  const iso = () => new Date(ctx.now()).toISOString();

  /**
   * Anfrage einer Plattform prüfen. Bei ungültiger Plattform oder Rücksprung-Adresse wird NIE weitergeleitet
   * (sonst offener Redirect) – stattdessen zeigt das Portal eine Fehlerseite.
   * Liefert { ok: true, plattform, ruecksprung, state, ziel } oder { ok: false, meldung }.
   */
  function pruefeAnfrage(q) {
    const nein = (meldung) => ({ ok: false, meldung });
    const pid = typeof q.plattform === 'string' ? q.plattform : '';
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(pid)) return nein('Unbekannte Plattform.');
    const p = plattformen.zeile(pid);
    if (!p || p.aktiv !== 1) return nein('Unbekannte Plattform.');
    if (p.vorlaeufig === 1 || !p.ruecksprung) return nein('Diese Plattform ist noch nicht für die Anmeldung über das Portal eingerichtet.');
    if (typeof q.ruecksprung !== 'string' || q.ruecksprung !== p.ruecksprung) return nein('Die Rücksprung-Adresse ist für diese Plattform nicht freigegeben.');
    if (typeof q.state !== 'string' || !STATE_MUSTER.test(q.state)) return nein('Ungültige Anfrage (state fehlt oder ist zu kurz).');
    const ziel = typeof q.ziel === 'string' && ZIEL_MUSTER.test(q.ziel) ? q.ziel : '/';
    const angaben = JSON.parse(p.angaben);
    return { ok: true, plattform: { id: p.id, name: angaben.name || p.id, farbe: angaben.farbe }, ruecksprung: p.ruecksprung, state: q.state, ziel };
  }

  function zurueck(a, params) {
    const u = new URL(a.ruecksprung);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.href;
  }

  /** Ablehnung bzw. Abbruch (nur nach erfolgreicher Prüfung der Rücksprung-Adresse). */
  const fehlerUrl = (a, fehler) => zurueck(a, { fehler, state: a.state });

  /** Kurse für das Token: nur Kurse, die diese Plattform freigeschaltet haben (H.5). */
  function kurseFuer(konto, pid) {
    if (konto.typ === 'schueler') {
      return db
        .prepare(
          `SELECT k.id, k.name FROM kurs_mitglieder m JOIN kurse k ON k.id = m.kurs_id
           JOIN kurs_plattformen kp ON kp.kurs_id = k.id AND kp.plattform_id = ? AND kp.aktiv = 1
           WHERE m.schueler_id = ? ORDER BY k.id`
        )
        .all(pid, konto.s.id)
        .map((k) => ({ id: kursId(k.id), name: k.name, rolle: 'mitglied' }));
    }
    const r = konto.r;
    const sql =
      r.rolle === 'superadmin'
        ? `SELECT k.id, k.name FROM kurse k JOIN kurs_plattformen kp ON kp.kurs_id = k.id AND kp.plattform_id = ? AND kp.aktiv = 1 ORDER BY k.id`
        : `SELECT k.id, k.name FROM kurse k JOIN kurs_plattformen kp ON kp.kurs_id = k.id AND kp.plattform_id = ? AND kp.aktiv = 1
           WHERE k.inhaber_id = ? OR k.id IN (SELECT kurs_id FROM kurs_lehrkraefte WHERE lehrkraft_id = ?) ORDER BY k.id`;
    const rows = r.rolle === 'superadmin' ? db.prepare(sql).all(pid) : db.prepare(sql).all(pid, r.id, r.id);
    return rows.map((k) => ({ id: kursId(k.id), name: k.name, rolle: 'lehrkraft' }));
  }

  /**
   * Entscheidung für ein angemeldetes Konto: Token ausstellen oder ablehnen. Liefert die Weiterleitungs-URL.
   * konto = { typ: 'schueler', s } | { typ: 'lehrkraft', r }
   */
  function entscheide(a, konto) {
    const pid = a.plattform.id;
    let sub;
    let rolle;
    let name;
    if (konto.typ === 'schueler') {
      sub = konten.subSchueler(konto.s.id);
      rolle = 'schueler';
      name = konto.s.name;
    } else {
      if (!konten.freigeschaltet(konto.r, pid)) return { url: fehlerUrl(a, 'keine_berechtigung'), erlaubt: false };
      sub = konten.subLehrkraft(konto.r);
      rolle = konto.r.rolle === 'superadmin' ? 'superadmin' : 'lehrkraft';
      name = konto.r.name;
    }
    const kurse = kurseFuer(konto, pid);
    if (rolle === 'schueler' && kurse.length === 0) return { url: fehlerUrl(a, 'keine_berechtigung'), erlaubt: false };
    if (!ctx.schluessel) throw Object.assign(new Error('Das Portal hat keinen Signaturschlüssel (PORTAL_PRIVATE_KEY).'), { status: 503 });
    const iat = Math.floor(ctx.now() / 1000);
    const token = signiere(
      { iss: ctx.portalUrl, aud: pid, sub, rolle, name, kurse, iat, exp: iat + TOKEN_DAUER_SEK, jti: crypto.randomBytes(16).toString('base64url'), v: 1 },
      ctx.schluessel.privateKey,
      { kid: ctx.schluessel.kid }
    );
    db.prepare(
      `INSERT INTO sso_nutzung (sub, plattform_id, erste, letzte, anzahl) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(sub, plattform_id) DO UPDATE SET letzte = excluded.letzte, anzahl = anzahl + 1`
    ).run(sub, pid, iso(), iso());
    if (konto.typ === 'schueler') konten.aktivMerken(konto.s.id);
    return { url: zurueck(a, { token, state: a.state, ziel: a.ziel }), erlaubt: true };
  }

  /** Rücksprung nach „Überall abmelden“: nur auf eine eingetragene Plattform, sonst Portal-Startseite. */
  function abmeldeZiel(ruecksprung) {
    if (typeof ruecksprung !== 'string' || ruecksprung.length > 500) return '/';
    let u;
    try {
      u = new URL(ruecksprung);
    } catch {
      return '/';
    }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return '/';
    return plattformen.zuUrl(ruecksprung) ? u.href : '/';
  }

  return { pruefeAnfrage, entscheide, fehlerUrl, abmeldeZiel, TOKEN_DAUER_SEK };
}

module.exports = { createSso, TOKEN_DAUER_SEK };

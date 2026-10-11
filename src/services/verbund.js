'use strict';
// Verbund-API (Vertrag H.6): signierte Aufrufe Portal → Plattform.
// Schreibende Aufrufe (Löschung, Kursänderung) laufen als Auftrag mit Wiederholung, damit nichts verloren geht,
// wenn eine Plattform gerade nicht erreichbar ist. Lesende Aufrufe (Kursübersicht) laufen sofort.

const crypto = require('node:crypto');
const { signiere } = require('../jwt');

// Wartezeit vor dem n-ten Wiederholungsversuch (Minuten); danach gilt der Auftrag als fehlgeschlagen.
const WARTEN_MIN = [1, 5, 30, 120, 360, 720, 1440, 1440, 1440, 1440];
const TIMEOUT_MS = 10000;
const MAX_ANTWORT = 512 * 1024;

/** Zweck-Namen der Verbund-Endpunkte (Feld `zweck` im Token, Vorschlag v1.1 in docs/VERTRAG_VORSCHLAEGE.md). */
const ZWECK = { loeschen: 'loeschen', uebersicht: 'kurs-uebersicht', kurs: 'kurs-aendern' };

function createVerbund(ctx) {
  const { db, log } = ctx;
  const iso = (ms = ctx.now()) => new Date(ms).toISOString();
  const cache = new Map(); // Kursübersichten, 60 s
  let laeuft = null;

  function plattform(id) {
    const p = db.prepare('SELECT * FROM plattformen WHERE id = ?').get(id);
    if (!p) return null;
    return { ...p, manifestObj: p.manifest ? JSON.parse(p.manifest) : null };
  }

  /** Nimmt die Plattform Aufrufe der Verbund-API entgegen? (laut Manifest: Auth-Modus portal/beides) */
  function verbundFaehig(p) {
    return !!(p && !p.vorlaeufig && p.manifestObj && p.manifestObj.auth && ['portal', 'beides'].includes(p.manifestObj.auth.modus));
  }

  function token(plattformId, zweck) {
    if (!ctx.schluessel) throw new Error('Kein Portal-Schlüssel konfiguriert (PORTAL_PRIVATE_KEY).');
    const iat = Math.floor(ctx.now() / 1000);
    return signiere(
      { iss: ctx.portalUrl, aud: plattformId, sub: 'portal', zweck, iat, exp: iat + 60, jti: crypto.randomBytes(16).toString('base64url'), v: 1 },
      ctx.schluessel.privateKey,
      { kid: ctx.schluessel.kid }
    );
  }

  /** Einzelner Aufruf; liefert { status, daten } oder wirft bei Netzfehler/Zeitüberschreitung. */
  async function aufruf(p, zweck, methode, pfad, nutzlast) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const headers = { Authorization: `Bearer ${token(p.id, zweck)}`, Accept: 'application/json' };
      const opts = { method: methode, headers, signal: ctrl.signal, redirect: 'error' };
      if (nutzlast !== undefined && nutzlast !== null) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(nutzlast);
      }
      const r = await ctx.fetch(p.basis + pfad, opts);
      const text = await r.text();
      if (text.length > MAX_ANTWORT) throw new Error('Antwort zu groß.');
      let daten = null;
      try {
        daten = text ? JSON.parse(text) : null;
      } catch {
        daten = null;
      }
      return { status: r.status, daten };
    } finally {
      clearTimeout(t);
    }
  }

  /* ---------- Aufträge ---------- */

  function auftrag(plattformId, zweck, methode, pfad, nutzlast) {
    const info = db
      .prepare(
        "INSERT INTO verbund_auftraege (plattform_id, zweck, methode, pfad, nutzlast, status, naechster_versuch, created_at) VALUES (?, ?, ?, ?, ?, 'offen', ?, ?)"
      )
      .run(plattformId, zweck, methode, pfad, nutzlast === undefined ? null : JSON.stringify(nutzlast), iso(), iso());
    return Number(info.lastInsertRowid);
  }

  /** Aufträge an alle verbundfähigen Plattformen der Liste; danach (ohne zu warten) abarbeiten. */
  function verteile(plattformIds, zweck, methode, pfad, nutzlast) {
    const ids = [];
    for (const pid of new Set(plattformIds)) {
      const p = plattform(pid);
      if (!verbundFaehig(p)) continue; // Plattform kennt noch keine Portal-Daten (Auth-Modus lokal) bzw. vorläufig
      ids.push(auftrag(pid, zweck, methode, typeof pfad === 'function' ? pfad(pid) : pfad, nutzlast));
    }
    if (ids.length) anstossen();
    return ids;
  }

  function anstossen() {
    if (ctx.verbundAutomatisch === false) return;
    setImmediate(() => verarbeite().catch((e) => log('Verbund: ' + e.message)));
  }

  /** Fällige Aufträge abarbeiten (nie parallel). Liefert die Zahl der bearbeiteten Aufträge. */
  function verarbeite() {
    if (laeuft) return laeuft.then(() => verarbeite());
    laeuft = (async () => {
      const faellig = db.prepare("SELECT * FROM verbund_auftraege WHERE status = 'offen' AND naechster_versuch <= ? ORDER BY id").all(iso());
      for (const a of faellig) await einAuftrag(a);
      return faellig.length;
    })().finally(() => {
      laeuft = null;
    });
    return laeuft;
  }

  async function einAuftrag(a) {
    const p = plattform(a.plattform_id);
    let fehler = null;
    let antwort = null;
    if (!p) fehler = 'Plattform ist nicht mehr eingetragen.';
    else {
      try {
        const r = await aufruf(p, a.zweck, a.methode, a.pfad, a.nutzlast ? JSON.parse(a.nutzlast) : undefined);
        antwort = r.daten;
        if (r.status < 200 || r.status >= 300) fehler = `Antwort ${r.status}` + (r.daten && r.daten.error ? `: ${String(r.daten.error).slice(0, 200)}` : '');
      } catch (e) {
        fehler = e.name === 'AbortError' ? 'Zeitüberschreitung.' : `Nicht erreichbar: ${String(e.message).slice(0, 200)}`;
      }
    }
    const versuche = a.versuche + 1;
    if (!fehler) {
      db.prepare("UPDATE verbund_auftraege SET status = 'erledigt', versuche = ?, letzter_fehler = NULL, antwort = ?, erledigt_at = ? WHERE id = ?").run(
        versuche,
        antwort ? JSON.stringify(antwort).slice(0, 2000) : null,
        iso(),
        a.id
      );
      return;
    }
    const endgueltig = !p || versuche >= WARTEN_MIN.length;
    const naechster = iso(ctx.now() + (WARTEN_MIN[Math.min(versuche - 1, WARTEN_MIN.length - 1)] || 1) * 60000);
    db.prepare('UPDATE verbund_auftraege SET status = ?, versuche = ?, letzter_fehler = ?, naechster_versuch = ? WHERE id = ?').run(
      endgueltig ? 'fehlgeschlagen' : 'offen',
      versuche,
      fehler,
      naechster,
      a.id
    );
    log(`Verbund: Auftrag ${a.id} (${a.zweck} → ${a.plattform_id}) ${endgueltig ? 'endgültig fehlgeschlagen' : 'wird wiederholt'}: ${fehler}`);
  }

  function auftraege({ limit = 200 } = {}) {
    return db
      .prepare("SELECT * FROM verbund_auftraege ORDER BY CASE status WHEN 'fehlgeschlagen' THEN 0 WHEN 'offen' THEN 1 ELSE 2 END, id DESC LIMIT ?")
      .all(limit)
      .map((a) => ({
        id: a.id,
        plattform: a.plattform_id,
        zweck: a.zweck,
        methode: a.methode,
        pfad: a.pfad,
        nutzlast: a.nutzlast ? JSON.parse(a.nutzlast) : null,
        status: a.status,
        versuche: a.versuche,
        naechsterVersuch: a.status === 'offen' ? a.naechster_versuch : null,
        fehler: a.letzter_fehler,
        erstellt: a.created_at,
        erledigt: a.erledigt_at
      }));
  }

  function wiederholen(id) {
    const r = db.prepare("UPDATE verbund_auftraege SET status = 'offen', versuche = 0, naechster_versuch = ? WHERE id = ? AND status != 'erledigt'").run(iso(), id);
    if (r.changes) anstossen();
    return r.changes > 0;
  }

  /* ---------- fachliche Aufrufe ---------- */

  const loescheSub = (sub, plattformIds) => verteile(plattformIds, ZWECK.loeschen, 'POST', '/api/verbund/loeschen', { sub });
  const loescheKurs = (kursId, plattformIds) => verteile(plattformIds, ZWECK.loeschen, 'POST', '/api/verbund/loeschen', { kurs: kursId });
  const kursGeaendert = (kursId, plattformIds, aenderung) =>
    verteile(plattformIds, ZWECK.kurs, 'POST', `/api/verbund/kurse/${encodeURIComponent(kursId)}`, aenderung);

  /** Kursübersicht (SOLL-Endpunkt): sofort abrufen, 60 s zwischenspeichern. */
  async function kursUebersicht(plattformId, kursId) {
    const p = plattform(plattformId);
    if (!verbundFaehig(p)) return { verfuegbar: false, grund: 'Die Plattform ist noch nicht an das Portal angebunden.' };
    const key = `${plattformId}|${kursId}`;
    const c = cache.get(key);
    if (c && c.bis > ctx.now()) return c.wert;
    let wert;
    try {
      const r = await aufruf(p, ZWECK.uebersicht, 'GET', `/api/verbund/kurse/${encodeURIComponent(kursId)}/uebersicht`);
      if (r.status === 404) wert = { verfuegbar: false, grund: 'Die Plattform bietet (noch) keine Kursübersicht an oder kennt den Kurs noch nicht.' };
      else if (r.status !== 200 || !r.daten || typeof r.daten !== 'object') wert = { verfuegbar: false, grund: `Die Plattform antwortet mit ${r.status}.` };
      else wert = { verfuegbar: true, daten: r.daten };
    } catch (e) {
      wert = { verfuegbar: false, grund: e.name === 'AbortError' ? 'Zeitüberschreitung.' : 'Die Plattform ist nicht erreichbar.' };
    }
    cache.set(key, { bis: ctx.now() + 60000, wert });
    return wert;
  }

  return { verbundFaehig, plattform, verteile, verarbeite, auftraege, wiederholen, loescheSub, loescheKurs, kursGeaendert, kursUebersicht, aufruf, ZWECK };
}

module.exports = { createVerbund, ZWECK };

'use strict';
// Plattform-Verwaltung (Superadmin): eintragen per Basis-URL, Manifest abrufen und gegen den Vertrag prüfen
// (scripts/vertrag_pruefen.js aus Algo Quest, unverändert), Rücksprung-Adresse für SSO (Whitelist), Status.

const V = require('../validate');
const { pruefeManifest } = require('../../scripts/vertrag_pruefen');

const { ValidationError, NotFoundError, ConflictError } = V;
const TIMEOUT_MS = 8000;
const MAX_ANTWORT = 256 * 1024;
const URL_SCHLUESSEL = ['start', 'gast', 'themen', 'lehrkraft', 'datenschutz', 'healthz'];

function createPlattformen(ctx) {
  const { db } = ctx;
  const iso = () => new Date(ctx.now()).toISOString();

  async function holeJson(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await ctx.fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal, redirect: 'manual' });
      const text = await r.text();
      if (text.length > MAX_ANTWORT) return { status: r.status, fehler: 'Antwort zu groß.' };
      try {
        return { status: r.status, daten: JSON.parse(text) };
      } catch {
        return { status: r.status, fehler: 'Antwort ist kein JSON.' };
      }
    } catch (e) {
      return { status: 0, fehler: e.name === 'AbortError' ? 'Zeitüberschreitung.' : `nicht erreichbar (${String(e.message).slice(0, 120)})` };
    } finally {
      clearTimeout(t);
    }
  }

  async function erreichbar(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await ctx.fetch(url, { signal: ctrl.signal, redirect: 'manual' });
      await r.arrayBuffer().catch(() => null);
      return r.status;
    } catch {
      return 0;
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Plattform unter `basis` prüfen: Manifest (Pflichtfelder nach §7 via pruefeManifest), Pflicht-URLs, /healthz.
   * Liefert { ok, fehler[], warnungen[], manifest|null, healthz|null, at }.
   */
  async function pruefeBasis(basis) {
    const fehler = [];
    const warnungen = [];
    const m = await holeJson(basis + '/api/plattform');
    let manifest = null;
    if (m.status !== 200 || !m.daten) fehler.push(`/api/plattform: ${m.fehler || 'Antwort ' + m.status}.`);
    else {
      manifest = m.daten;
      fehler.push(...pruefeManifest(manifest));
      if (typeof manifest.basis === 'string' && manifest.basis.replace(/\/+$/, '') !== basis) {
        warnungen.push(`Manifest nennt als Basis ${manifest.basis}, eingetragen ist ${basis}.`);
      }
    }
    let healthz = null;
    if (manifest && manifest.urls && typeof manifest.urls === 'object') {
      for (const k of URL_SCHLUESSEL) {
        const pfad = manifest.urls[k];
        if (typeof pfad !== 'string' || !pfad.startsWith('/')) continue;
        const st = await erreichbar(basis + pfad);
        if (st === 0 || st >= 400) warnungen.push(`urls.${k} (${pfad}) antwortet mit ${st || 'keiner Antwort'}.`);
      }
      const h = await holeJson(basis + (typeof manifest.urls.healthz === 'string' ? manifest.urls.healthz : '/healthz'));
      if (h.status !== 200 || !h.daten) fehler.push(`healthz: ${h.fehler || 'Antwort ' + h.status}.`);
      else {
        healthz = h.daten;
        if (h.daten.status !== 'ok') fehler.push('healthz: status ist nicht "ok".');
        if (h.daten.version !== manifest.version) fehler.push(`healthz.version (${h.daten.version}) ≠ manifest.version (${manifest.version}).`);
      }
      if (manifest.auth && manifest.auth.sso === false) warnungen.push('Die Plattform bietet noch kein SSO an (auth.sso = false).');
    }
    return { ok: fehler.length === 0, fehler, warnungen, manifest, healthz, at: iso() };
  }

  /** Anzeige-Angaben aus einem Manifest (nur Felder, die das Portal zeigt). */
  function angabenAus(m) {
    const t = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
    const urls = {};
    if (m.urls && typeof m.urls === 'object') {
      for (const [k, v] of Object.entries(m.urls)) if (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//')) urls[k] = v.slice(0, 300);
    }
    return {
      name: t(m.name, 80),
      titel: t(m.titel, 160),
      themenfeld: t(m.themenfeld, 120),
      kurs: t(m.kurs, 160),
      beschreibung: t(m.beschreibung, 600),
      farbe: typeof m.farbe === 'string' && /^#[0-9A-Fa-f]{6}$/.test(m.farbe) ? m.farbe.toUpperCase() : '#1F4E79',
      version: t(m.version, 40),
      vertrag: t(m.vertrag, 20),
      urls,
      auth: m.auth && typeof m.auth === 'object' ? { modus: t(m.auth.modus, 20), sso: m.auth.sso === true } : { modus: 'lokal', sso: false },
      umfang: m.umfang && typeof m.umfang === 'object' ? m.umfang : null,
      faehigkeiten: Array.isArray(m.faehigkeiten) ? m.faehigkeiten.filter((f) => typeof f === 'string').slice(0, 40) : []
    };
  }

  function zeile(id) {
    return db.prepare('SELECT * FROM plattformen WHERE id = ?').get(id);
  }

  function ansicht(r) {
    const angaben = JSON.parse(r.angaben);
    const pruefung = r.pruefung ? JSON.parse(r.pruefung) : null;
    return {
      id: r.id,
      basis: r.basis,
      vorlaeufig: r.vorlaeufig === 1,
      aktiv: r.aktiv === 1,
      reihenfolge: r.reihenfolge,
      ruecksprung: r.ruecksprung,
      ruecksprungVorschlag: r.basis + (angaben.urls && angaben.urls.ssoEnde ? angaben.urls.ssoEnde : '/sso/ende'),
      ...angaben,
      status: status(r, pruefung),
      pruefung,
      erstellt: r.created_at,
      geprueft: r.geprueft_at
    };
  }

  /** Ampel: ok | warnung | fehler | vorlaeufig | aus */
  function status(r, pruefung) {
    if (!r.aktiv) return 'aus';
    if (r.vorlaeufig) return 'vorlaeufig';
    if (!pruefung) return 'warnung';
    if (!pruefung.ok) return 'fehler';
    return pruefung.warnungen && pruefung.warnungen.length ? 'warnung' : 'ok';
  }

  function liste() {
    return db.prepare('SELECT * FROM plattformen ORDER BY reihenfolge, id').all().map(ansicht);
  }

  function get(id) {
    const r = zeile(id);
    if (!r) throw new NotFoundError('Plattform nicht gefunden.');
    return ansicht(r);
  }

  /** Für SSO/Kurse nutzbar: aktiv, nicht vorläufig. */
  function nutzbar(id) {
    const r = zeile(id);
    return !!(r && r.aktiv === 1 && r.vorlaeufig === 0);
  }

  /** Öffentliche Übersicht (Startseite): nur aktive Plattformen, absolute Links, keine internen Angaben. */
  function oeffentlich() {
    return liste()
      .filter((p) => p.aktiv)
      .map((p) => {
        const link = (k) => (p.urls && p.urls[k] ? p.basis + p.urls[k] : null);
        return {
          id: p.id,
          name: p.name,
          titel: p.titel,
          themenfeld: p.themenfeld,
          kurs: p.kurs,
          beschreibung: p.beschreibung,
          farbe: p.farbe,
          vorlaeufig: p.vorlaeufig,
          basis: p.basis,
          links: { start: link('start') || p.basis + '/', gast: link('gast'), themen: link('themen'), datenschutz: link('datenschutz') },
          sso: !p.vorlaeufig && !!(p.auth && p.auth.sso) && !!p.ruecksprung,
          umfang: p.umfang
        };
      });
  }

  /** Plattform per Basis-URL eintragen (Manifest muss vertragsgemäß sein). */
  async function eintragen(basisEingabe) {
    const basis = V.basisUrl(basisEingabe, { erlaubeHttp: ctx.erlaubeHttp });
    if (db.prepare('SELECT 1 FROM plattformen WHERE basis = ?').get(basis)) throw new ConflictError('Diese Plattform ist schon eingetragen.');
    const p = await pruefeBasis(basis);
    if (!p.manifest) throw new ValidationError('Kein Manifest abrufbar – als vorläufigen Eintrag anlegen?', { pruefung: p, vorlaeufigMoeglich: true });
    if (!p.ok) throw new ValidationError('Das Manifest erfüllt den Vertrag nicht.', { pruefung: p });
    const id = p.manifest.id;
    if (zeile(id)) throw new ConflictError(`Die Plattform-ID „${id}“ ist schon eingetragen.`);
    db.prepare('INSERT INTO plattformen (id, basis, vorlaeufig, angaben, manifest, pruefung, created_at, geprueft_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?)').run(
      id,
      basis,
      JSON.stringify(angabenAus(p.manifest)),
      JSON.stringify(p.manifest),
      JSON.stringify(ohneManifest(p)),
      iso(),
      p.at
    );
    return get(id);
  }

  const ohneManifest = (p) => ({ ok: p.ok, fehler: p.fehler, warnungen: p.warnungen, healthz: p.healthz, at: p.at });

  function pruefeAngaben(b, alt = {}) {
    return {
      ...alt,
      name: V.str(b.name, 'Name', { min: 2, max: 80 }),
      titel: V.str(b.titel === undefined ? b.name : b.titel, 'Titel', { max: 160 }),
      themenfeld: V.str(b.themenfeld, 'Themenfeld', { min: 2, max: 120 }),
      kurs: V.str(b.kurs === undefined ? '' : b.kurs, 'Kurs', { max: 160 }),
      beschreibung: V.str(b.beschreibung === undefined ? '' : b.beschreibung, 'Beschreibung', { max: 600 }),
      farbe: V.farbe(b.farbe || '#1F4E79'),
      urls: alt.urls || { start: '/' },
      auth: alt.auth || { modus: 'lokal', sso: false },
      faehigkeiten: alt.faehigkeiten || []
    };
  }

  /** Vorläufiger Eintrag ohne Manifest (nur Link, kein SSO, nicht für Kurse wählbar). */
  function vorlaeufigEintragen(b) {
    const id = V.plattformId(b && b.id);
    const basis = V.basisUrl(b && b.basis, { erlaubeHttp: ctx.erlaubeHttp });
    if (zeile(id)) throw new ConflictError(`Die Plattform-ID „${id}“ ist schon eingetragen.`);
    if (db.prepare('SELECT 1 FROM plattformen WHERE basis = ?').get(basis)) throw new ConflictError('Diese Plattform ist schon eingetragen.');
    const angaben = pruefeAngaben(b);
    db.prepare('INSERT INTO plattformen (id, basis, vorlaeufig, angaben, created_at) VALUES (?, ?, 1, ?, ?)').run(id, basis, JSON.stringify(angaben), iso());
    return get(id);
  }

  /** Erneut prüfen; bei gültigem Manifest Angaben übernehmen (vorläufige Einträge werden so umgestellt). */
  async function pruefen(id) {
    const r = zeile(id);
    if (!r) throw new NotFoundError('Plattform nicht gefunden.');
    const p = await pruefeBasis(r.basis);
    if (p.manifest && p.manifest.id !== id) {
      p.ok = false;
      p.fehler.unshift(`Manifest meldet die ID „${p.manifest.id}“, eingetragen ist „${id}“.`);
    }
    if (p.ok) {
      db.prepare('UPDATE plattformen SET vorlaeufig = 0, angaben = ?, manifest = ?, pruefung = ?, geprueft_at = ? WHERE id = ?').run(
        JSON.stringify(angabenAus(p.manifest)),
        JSON.stringify(p.manifest),
        JSON.stringify(ohneManifest(p)),
        p.at,
        id
      );
    } else {
      // Angaben und letztes gültiges Manifest bleiben; die Ampel zeigt den Fehler.
      db.prepare('UPDATE plattformen SET pruefung = ?, geprueft_at = ? WHERE id = ?').run(JSON.stringify(ohneManifest(p)), p.at, id);
    }
    return get(id);
  }

  async function allePruefen() {
    const out = [];
    for (const r of db.prepare('SELECT id FROM plattformen WHERE aktiv = 1').all()) out.push(await pruefen(r.id).catch((e) => ({ id: r.id, fehler: e.message })));
    return out;
  }

  /** Rücksprung-Adresse (exakt), aktiv, Reihenfolge, Angaben (nur vorläufig) ändern. */
  function aendern(id, b) {
    const r = zeile(id);
    if (!r) throw new NotFoundError('Plattform nicht gefunden.');
    b = b || {};
    if (b.ruecksprung !== undefined) {
      let rs = null;
      if (b.ruecksprung !== null && b.ruecksprung !== '') {
        let u;
        try {
          u = new URL(String(b.ruecksprung).trim());
        } catch {
          throw new ValidationError('Rücksprung-Adresse ungültig.');
        }
        if (u.origin !== r.basis) throw new ValidationError(`Die Rücksprung-Adresse muss auf der Plattform liegen (${r.basis}).`);
        if (u.hash || u.username || u.password) throw new ValidationError('Rücksprung-Adresse ohne Fragment und Zugangsdaten angeben.');
        rs = u.href;
      }
      db.prepare('UPDATE plattformen SET ruecksprung = ? WHERE id = ?').run(rs, id);
    }
    if (b.aktiv !== undefined) db.prepare('UPDATE plattformen SET aktiv = ? WHERE id = ?').run(V.bool(b.aktiv, 'aktiv') ? 1 : 0, id);
    if (b.reihenfolge !== undefined) db.prepare('UPDATE plattformen SET reihenfolge = ? WHERE id = ?').run(V.int(b.reihenfolge, 'Reihenfolge', { min: 0, max: 9999 }), id);
    if (b.angaben !== undefined) {
      if (!r.vorlaeufig) throw new ValidationError('Angaben kommen aus dem Manifest und können nur bei vorläufigen Einträgen geändert werden.');
      db.prepare('UPDATE plattformen SET angaben = ? WHERE id = ?').run(JSON.stringify(pruefeAngaben(b.angaben, JSON.parse(r.angaben))), id);
    }
    return get(id);
  }

  function entfernen(id) {
    const r = zeile(id);
    if (!r) throw new NotFoundError('Plattform nicht gefunden.');
    db.prepare('DELETE FROM plattformen WHERE id = ?').run(id);
    return true;
  }

  /** Plattform, deren Basis zur gegebenen URL passt (für /sso/abmelden). */
  function zuUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    return db.prepare('SELECT id FROM plattformen WHERE basis = ? AND aktiv = 1').get(u.origin) || null;
  }

  return { liste, get, nutzbar, oeffentlich, eintragen, vorlaeufigEintragen, pruefen, allePruefen, aendern, entfernen, zuUrl, zeile, pruefeBasis };
}

module.exports = { createPlattformen };

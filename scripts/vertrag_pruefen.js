#!/usr/bin/env node
'use strict';
// Prüft eine Plattform gegen den Verbundvertrag (VERTRAG.md im Repo frankjuchim/labs, Hauptversion 1).
// Maßgebliche Fassung: frankjuchim/labs/scripts/vertrag_pruefen.js.
// Aufruf: node scripts/vertrag_pruefen.js https://algoquest.frankjuchim.de   (oder http://localhost:3000)
// Ohne Netz nutzbar als Modul: const { pruefeManifest } = require('./scripts/vertrag_pruefen');
// Mit Netz (ab v1.3): pruefeSsoStart(basis, manifest) – /sso/start leitet ohne Anmeldung zum Portal weiter.
// Diese Datei wird unverändert in jede Plattform des Verbunds kopiert.

const VERTRAG_HAUPTVERSION = 1;
const URL_SCHLUESSEL = ['start', 'gast', 'themen', 'lehrkraft', 'datenschutz', 'healthz'];

/** Liefert eine Liste von Fehlermeldungen (leer = vertragsgemäß). */
function pruefeManifest(m) {
  const f = [];
  const text = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!m || typeof m !== 'object') return ['Manifest ist kein JSON-Objekt.'];
  if (!text(m.vertrag) || !/^\d+\.\d+$/.test(m.vertrag)) f.push('vertrag: Versionsangabe „<Haupt>.<Neben>“ fehlt.');
  else if (Number(m.vertrag.split('.')[0]) !== VERTRAG_HAUPTVERSION) f.push(`vertrag: Hauptversion ${m.vertrag} passt nicht zu v${VERTRAG_HAUPTVERSION}.`);
  if (!text(m.id) || !/^[a-z][a-z0-9-]{1,30}$/.test(m.id)) f.push('id: Plattform-ID fehlt oder ungültig (klein, a–z, 0–9, „-“, wie die Subdomain).');
  for (const k of ['name', 'titel', 'themenfeld', 'kurs', 'beschreibung', 'version', 'basis']) if (!text(m[k])) f.push(`${k}: fehlt.`);
  if (text(m.farbe) && !/^#[0-9A-Fa-f]{6}$/.test(m.farbe)) f.push('farbe: muss #RRGGBB sein.');
  if (!m.urls || typeof m.urls !== 'object') f.push('urls: fehlt.');
  else for (const k of URL_SCHLUESSEL) if (!text(m.urls[k]) || !m.urls[k].startsWith('/')) f.push(`urls.${k}: Pfad (beginnend mit „/“) fehlt.`);
  if (!m.auth || typeof m.auth !== 'object') f.push('auth: fehlt.');
  else {
    if (!['lokal', 'portal', 'beides'].includes(m.auth.modus)) f.push('auth.modus: lokal | portal | beides.');
    if (typeof m.auth.sso !== 'boolean') f.push('auth.sso: true/false fehlt.');
  }
  // urls.ssoStart: ab v1.3 SOLL mit Standard /sso/start (vorher Pflicht bei sso: true) – wenn angegeben, ein Pfad
  if (m.urls && typeof m.urls === 'object' && m.urls.ssoStart !== undefined && (!text(m.urls.ssoStart) || !m.urls.ssoStart.startsWith('/') || m.urls.ssoStart.startsWith('//'))) {
    f.push('urls.ssoStart: Pfad (beginnend mit „/“), Standard /sso/start.');
  }
  if (!m.umfang || typeof m.umfang !== 'object' || !Number.isInteger(m.umfang.aufgaben)) f.push('umfang: { welten, level, aufgaben, bosse } (Ganzzahlen) fehlt.');
  if (m.niveaus !== undefined && (!Array.isArray(m.niveaus) || !m.niveaus.length || m.niveaus.some((n) => !['eA', 'gA'].includes(n)))) {
    f.push('niveaus: Liste aus "eA" und/oder "gA" (ab v1.2; ohne Angabe gilt: eA und gA).');
  }
  if (m.urls && m.urls.niveaus !== undefined && (typeof m.urls.niveaus !== 'string' || !m.urls.niveaus.startsWith('/'))) f.push('urls.niveaus: Pfad (beginnend mit „/“).');
  if (!Array.isArray(m.faehigkeiten)) f.push('faehigkeiten: Liste fehlt (z. B. "gast", "themen", "lehrkraft-materialien").');
  else if (!m.faehigkeiten.includes('gast')) f.push('faehigkeiten: "gast" ist Pflicht (Gastmodus /gast).');
  return f;
}

/** Pfad des SSO-Einstiegs laut Manifest (Standard /sso/start, §5/§7 ab v1.3). */
function ssoStartPfad(m) {
  const p = m && m.urls && m.urls.ssoStart;
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : '/sso/start';
}

/**
 * Prüft ohne Anmeldung, ob der SSO-Einstieg zum Portal weiterleitet (§5, §12 ab v1.3).
 * Nur für auth.modus portal/beides. Liefert { fehler: [...], hinweise: [...] }: 404 ist ein Fehler (MUSS),
 * jede andere Abweichung ein Hinweis.
 */
async function pruefeSsoStart(basis, m, holen = fetch) {
  const fehler = [];
  const hinweise = [];
  if (!m || !m.auth || !['portal', 'beides'].includes(m.auth.modus)) return { fehler, hinweise };
  const pfad = ssoStartPfad(m);
  let r;
  try {
    r = await holen(basis.replace(/\/+$/, '') + pfad, { redirect: 'manual' });
  } catch (e) {
    hinweise.push(`SSO-Einstieg ${pfad} nicht erreichbar: ${e.message}`);
    return { fehler, hinweise };
  }
  if (r.status === 404) {
    fehler.push(`SSO-Einstieg ${pfad} antwortet mit 404 (MUSS bei auth.modus ${m.auth.modus}, §5).`);
    return { fehler, hinweise };
  }
  const ort = r.headers.get('location') || '';
  let ziel = null;
  try {
    ziel = new URL(ort, basis);
  } catch {
    /* unten Hinweis */
  }
  const portal = typeof m.auth.portal === 'string' ? m.auth.portal.replace(/\/+$/, '') : null;
  const ziel_ok = ziel && ziel.pathname.endsWith('/sso/autorisieren') && (!portal || ziel.href.startsWith(portal + '/sso/autorisieren'));
  if (r.status < 300 || r.status >= 400 || !ziel_ok) {
    hinweise.push(`SSO-Einstieg ${pfad} sollte ohne Anmeldung mit 302 auf ${portal || '<PORTAL_URL>'}/sso/autorisieren weiterleiten (Antwort ${r.status}${ort ? ' → ' + ort.split('?')[0] : ''}).`);
  } else if (ziel.searchParams.get('plattform') !== m.id) {
    hinweise.push(`SSO-Einstieg ${pfad}: Parameter plattform (${ziel.searchParams.get('plattform')}) ≠ id (${m.id}).`);
  }
  return { fehler, hinweise };
}

async function main() {
  const basis = (process.argv[2] || '').replace(/\/+$/, '');
  if (!basis) {
    console.error('Aufruf: node scripts/vertrag_pruefen.js <Basis-URL der Plattform>');
    process.exit(2);
  }
  const fehler = [];
  let m = null;
  try {
    const r = await fetch(basis + '/api/plattform');
    if (!r.ok) fehler.push(`/api/plattform antwortet mit ${r.status}.`);
    else m = await r.json();
  } catch (e) {
    fehler.push(`/api/plattform nicht erreichbar: ${e.message}`);
  }
  if (m) fehler.push(...pruefeManifest(m));
  if (m && m.urls) {
    for (const k of URL_SCHLUESSEL) {
      try {
        const r = await fetch(basis + m.urls[k], { redirect: 'manual' });
        if (r.status >= 400) fehler.push(`${k} (${m.urls[k]}) antwortet mit ${r.status}.`);
      } catch (e) {
        fehler.push(`${k} (${m.urls[k]}) nicht erreichbar: ${e.message}`);
      }
    }
    try {
      const h = await (await fetch(basis + m.urls.healthz)).json();
      if (h.status !== 'ok') fehler.push('healthz: status ist nicht "ok".');
      if (h.version !== m.version) fehler.push(`healthz.version (${h.version}) ≠ manifest.version (${m.version}).`);
    } catch (e) {
      fehler.push(`healthz nicht lesbar: ${e.message}`);
    }
  }
  let hinweise = [];
  if (m) {
    const sso = await pruefeSsoStart(basis, m);
    fehler.push(...sso.fehler);
    hinweise = sso.hinweise;
  }
  for (const x of hinweise) console.log('⚠ ' + x);
  if (fehler.length) {
    for (const x of fehler) console.log('✘ ' + x);
    console.log(`Vertrag v${VERTRAG_HAUPTVERSION}: ${fehler.length} Problem(e).`);
    process.exit(1);
  }
  console.log(`✔ ${m.name} (${m.id}) erfüllt Vertrag v${m.vertrag} – Version ${m.version}, Anmeldung: ${m.auth.modus}.`);
}

if (require.main === module) main();
module.exports = { pruefeManifest, pruefeSsoStart, ssoStartPfad, VERTRAG_HAUPTVERSION };

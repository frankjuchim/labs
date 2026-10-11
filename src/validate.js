'use strict';
// Validierungshelfer (Regeln wie in Algo Quest). Werfen Fehler mit deutscher Meldung und HTTP-Status.

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.status = 400;
    this.details = details;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Nicht gefunden.') {
    super(message);
    this.status = 404;
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Keine Berechtigung.') {
    super(message);
    this.status = 403;
  }
}

class ConflictError extends Error {
  constructor(message, extra) {
    super(message);
    this.status = 409;
    this.extra = extra;
  }
}

function str(value, field, { min = 0, max = 200, optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return '';
    throw new ValidationError(`${field} fehlt.`);
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} muss Text sein.`);
  const v = value.normalize('NFC').trim();
  if (v.length < min) throw new ValidationError(min <= 1 ? `${field} darf nicht leer sein.` : `${field} ist zu kurz (mind. ${min} Zeichen).`);
  if (v.length > max) throw new ValidationError(`${field} ist zu lang (max. ${max} Zeichen).`);
  return v;
}

function int(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isInteger(n)) throw new ValidationError(`${field} muss eine ganze Zahl sein.`);
  if (n < min || n > max) throw new ValidationError(`${field} muss zwischen ${min} und ${max} liegen.`);
  return n;
}

function bool(value, field) {
  if (value === true || value === false) return value;
  throw new ValidationError(`${field} muss ja oder nein sein.`);
}

/** Datum JJJJ-MM-TT (gültiger Kalendertag). */
function datum(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${field}: Datum im Format JJJJ-MM-TT angeben.`);
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new ValidationError(`${field}: ungültiges Datum.`);
  return value;
}

function farbe(value, field = 'Farbe') {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) throw new ValidationError(`${field} muss #RRGGBB sein.`);
  return value.toUpperCase();
}

/**
 * Schülername: getrimmt, 2–30 Zeichen, Buchstaben/Ziffern/Leerzeichen/.-' (wie Algo Quest).
 * Liefert { name, key } – key ist die Vergleichsform (ohne Groß-/Kleinschreibung, Leerzeichen zusammengefasst).
 */
function schuelerName(value) {
  if (typeof value !== 'string') throw new ValidationError('Bitte gib einen Namen ein.');
  const v = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (v.length < 2) throw new ValidationError('Der Name ist zu kurz (mindestens 2 Zeichen).');
  if (v.length > 30) throw new ValidationError('Der Name ist zu lang (höchstens 30 Zeichen).');
  if (!/^[\p{L}\p{N} .\-']+$/u.test(v)) {
    throw new ValidationError('Der Name darf nur Buchstaben, Ziffern, Leerzeichen, Punkt, Bindestrich und Apostroph enthalten.');
  }
  return { name: v, key: v.toLocaleLowerCase('de-DE') };
}

function email(value) {
  const v = str(value, 'E-Mail', { min: 3, max: 200 }).toLowerCase();
  // „admin“ (ohne @) ist nur für den Superadmin aus der Umgebung erlaubt – siehe konten.js
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ValidationError('Bitte eine gültige E-Mail-Adresse angeben.');
  return v;
}

function passwort(value, field = 'Passwort') {
  if (typeof value !== 'string') throw new ValidationError(`${field} fehlt.`);
  if (value.length < 10) throw new ValidationError(`${field} muss mindestens 10 Zeichen lang sein.`);
  if (value.length > 200) throw new ValidationError(`${field} ist zu lang.`);
  return value;
}

/** Kurscode: 6 Zeichen aus dem eindeutigen Alphabet (ohne 0/O/1/I), Eingabe tolerant. */
function kursCode(value) {
  const v = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(v)) return null;
  return v;
}

/** Plattform-ID nach Vertrag H.2. */
function plattformId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(value)) throw new ValidationError('Plattform-ID ungültig (a–z, 0–9, „-“, 2–31 Zeichen).');
  return value;
}

/** Basis-URL einer Plattform: https (http nur, wenn erlaubt), ohne Pfad, Query und Fragment. */
function basisUrl(value, { erlaubeHttp = false } = {}) {
  let u;
  try {
    u = new URL(String(value || '').trim());
  } catch {
    throw new ValidationError('Basis-URL ungültig.');
  }
  const ok = u.protocol === 'https:' || (u.protocol === 'http:' && (erlaubeHttp || ['localhost', '127.0.0.1'].includes(u.hostname)));
  if (!ok) throw new ValidationError('Basis-URL muss mit https:// beginnen.');
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) throw new ValidationError('Basis-URL ohne Pfad angeben, z. B. https://algoquest.frankjuchim.de');
  return u.origin;
}

/** Datum (JJJJ-MM-TT) des Tages in Europe/Berlin zu einem Zeitpunkt in ms. */
function tagBerlin(ms) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

module.exports = {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  str,
  int,
  bool,
  datum,
  farbe,
  schuelerName,
  email,
  passwort,
  kursCode,
  plattformId,
  basisUrl,
  tagBerlin
};

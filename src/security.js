'use strict';
const crypto = require('node:crypto');

// Sicherheitsbausteine des Portals – bewusst gleich wie in Algo Quest (src/security.js dort),
// damit importierte Passwort-Hashes gültig bleiben und alle Apps des Verbunds gleich funktionieren.

/* ---------- Cookie: eine Sitzung je Browser (Schüler oder Lehrkraft) ---------- */
const COOKIE_SITZUNG = 'ilp_s';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** Signiertes, zustandsloses Token (HMAC-SHA256). */
function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token, secret) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

/** Session-Cookie: httpOnly, SameSite=Lax, secure hinter HTTPS (req.secure berücksichtigt TRUST_PROXY). */
function setCookie(req, res, name, payload, secret, maxAgeMs) {
  const token = sign({ ...payload, exp: Date.now() + maxAgeMs }, secret);
  res.cookie(name, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: maxAgeMs });
}

function clearCookie(req, res, name) {
  res.clearCookie(name, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
}

/** Konstantzeit-Vergleich zweier Strings. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ---------- Passwörter: scrypt ---------- */
// Parameter: N = 2^15 (Kosten), r = 8, p = 1, Schlüssellänge 64 Byte, Salt 16 Byte (zufällig je Passwort).
// Format in der Datenbank: scrypt$N$r$p$<salt base64>$<hash base64>
// (Nur für automatische Tests kann N über PORTAL_SCRYPT_N verkleinert werden.)
const SCRYPT = { N: Number(process.env.PORTAL_SCRYPT_N) || 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function hashPasswortSync(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function hashPasswort(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (err, hash) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`);
    });
  });
}

function parseHash(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, N, r, p, salt, hash] = parts;
  return { N: Number(N), r: Number(r), p: Number(p), salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') };
}

function pruefePasswortSync(pw, stored) {
  const h = parseHash(stored);
  if (!h) return false;
  const got = crypto.scryptSync(String(pw), h.salt, h.hash.length, { N: h.N, r: h.r, p: h.p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(got, h.hash);
}

/** Passwort prüfen (asynchron). Ohne gültigen Hash wird trotzdem gerechnet (gleiche Antwortzeit). */
function pruefePasswort(pw, stored) {
  return new Promise((resolve) => {
    const h = parseHash(stored) || { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: Buffer.alloc(16), hash: Buffer.alloc(64), dummy: true };
    crypto.scrypt(String(pw), h.salt, h.hash.length, { N: h.N, r: h.r, p: h.p, maxmem: SCRYPT.maxmem }, (err, got) => {
      if (err || h.dummy) return resolve(false);
      resolve(crypto.timingSafeEqual(got, h.hash));
    });
  });
}

/* ---------- Rate-Limits (im Speicher) ---------- */

class Limiter {
  /** @param {{max:number, windowMs:number}} o */
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.map = new Map();
    // abgelaufene Einträge (Schlüssel enthalten u. a. IP-Adressen) spätestens nach einer Minute entfernen
    // (Datenschutz: IP-Adressen werden nur für die Dauer des Zeitfensters gehalten)
    this.aufraeumer = setInterval(() => this.prune(), 60 * 1000);
    this.aufraeumer.unref();
  }
  _entry(key, now) {
    let e = this.map.get(key);
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + this.windowMs };
      this.map.set(key, e);
    }
    return e;
  }
  isBlocked(key, now = Date.now()) {
    const e = this.map.get(key);
    if (!e || e.reset <= now) return false;
    return e.count >= this.max;
  }
  retryAfterSec(key, now = Date.now()) {
    const e = this.map.get(key);
    return e ? Math.max(1, Math.ceil((e.reset - now) / 1000)) : 0;
  }
  /** Zählt einen Vorgang (Fehlversuch bzw. Anfrage). */
  hit(key, now = Date.now()) {
    const e = this._entry(key, now);
    e.count += 1;
    if (this.map.size > 20000) this.prune(now);
  }
  /** Zählt und meldet, ob das Limit jetzt überschritten ist. */
  take(key, now = Date.now()) {
    if (this.isBlocked(key, now)) return false;
    this.hit(key, now);
    return true;
  }
  reset(key) {
    this.map.delete(key);
  }
  prune(now = Date.now()) {
    for (const [k, e] of this.map) if (e.reset <= now) this.map.delete(k);
  }
}

/* ---------- CSRF-Schutz: Origin-/Referer-Prüfung + JSON-Pflicht ---------- */

function sameOriginCheck(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const host = req.get('host');
  const origin = req.get('origin');
  const referer = req.get('referer');
  let source = null;
  try {
    if (origin && origin !== 'null') source = new URL(origin).host;
    else if (referer) source = new URL(referer).host;
  } catch {
    source = null;
  }
  if (!source || source !== host) {
    return res.status(403).json({ error: 'Anfrage abgelehnt (Herkunft ungültig).' });
  }
  if (method !== 'DELETE' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Nur JSON-Anfragen erlaubt.' });
  }
  next();
}

/* ---------- Zufallscodes ---------- */

const KURS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I
const CODE_BUCHSTABEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne I/O
const CODE_ZIFFERN = '23456789'; // ohne 0/1

function randomFrom(alphabet, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}

function kursCode() {
  return randomFrom(KURS_ALPHABET, 6);
}

/** Persönlicher Schülercode im Format ABC-123. */
function schuelerCode() {
  return `${randomFrom(CODE_BUCHSTABEN, 3)}-${randomFrom(CODE_ZIFFERN, 3)}`;
}

/** Eingabe eines Schülercodes vereinheitlichen ("abc123", "ABC 123" → "ABC-123"). */
function normSchuelerCode(v) {
  const s = String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}[0-9]{3}$/.test(s)) return null;
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

function einmalPasswort() {
  // gut abtippbar, 12 Zeichen aus dem eindeutigen Alphabet, in Vierergruppen
  const s = randomFrom(KURS_ALPHABET.toLowerCase().replace(/[^a-z2-9]/g, '') + KURS_ALPHABET, 12);
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

module.exports = {
  COOKIE_SITZUNG,
  sign,
  verify,
  parseCookies,
  setCookie,
  clearCookie,
  safeEqual,
  SCRYPT,
  hashPasswort,
  hashPasswortSync,
  pruefePasswort,
  pruefePasswortSync,
  Limiter,
  sameOriginCheck,
  kursCode,
  schuelerCode,
  normSchuelerCode,
  einmalPasswort
};

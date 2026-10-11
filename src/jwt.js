'use strict';
// Kompakte JWT mit Ed25519 (alg „EdDSA“) – nur Node-Bordmittel (crypto.sign/verify), Vertrag §5/§6.
// Diese Datei ist so geschrieben, dass Plattformen sie unverändert übernehmen können (siehe docs/INTEGRATION.md).

const crypto = require('node:crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Token signieren. privateKey: KeyObject oder PEM (PKCS#8, Ed25519). */
function signiere(nutzlast, privateKey, { kid } = {}) {
  const kopf = { alg: 'EdDSA', typ: 'JWT' };
  if (kid) kopf.kid = kid;
  const teil = `${b64url(JSON.stringify(kopf))}.${b64url(JSON.stringify(nutzlast))}`;
  const sig = crypto.sign(null, Buffer.from(teil), privateKey);
  return `${teil}.${b64url(sig)}`;
}

/**
 * Token prüfen. Liefert { ok: true, nutzlast } oder { ok: false, grund }.
 * Geprüft: Aufbau, alg = EdDSA, Signatur, iss, aud, exp (mit höchstens `toleranzSek` Uhrabweichung),
 * exp − iat ≤ maxDauerSek, v = 1. Die Prüfung von jti (einmalig) und state übernimmt der Aufrufer.
 */
function pruefe(token, publicKey, { iss, aud, maxDauerSek = 120, jetztSek = Math.floor(Date.now() / 1000), toleranzSek = 30 } = {}) {
  if (typeof token !== 'string' || token.length > 8192) return { ok: false, grund: 'format' };
  const teile = token.split('.');
  if (teile.length !== 3) return { ok: false, grund: 'format' };
  let kopf;
  let nutzlast;
  try {
    kopf = JSON.parse(Buffer.from(teile[0], 'base64url').toString('utf8'));
    nutzlast = JSON.parse(Buffer.from(teile[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, grund: 'format' };
  }
  if (!kopf || kopf.alg !== 'EdDSA') return { ok: false, grund: 'alg' };
  let gueltig = false;
  for (const key of schluesselListe(publicKey)) {
    try {
      gueltig = crypto.verify(null, Buffer.from(`${teile[0]}.${teile[1]}`), key, Buffer.from(teile[2], 'base64url'));
    } catch {
      gueltig = false;
    }
    if (gueltig) break;
  }
  if (!gueltig) return { ok: false, grund: 'signatur' };
  if (!nutzlast || typeof nutzlast !== 'object') return { ok: false, grund: 'format' };
  if (nutzlast.v !== 1) return { ok: false, grund: 'version' };
  if (iss !== undefined && nutzlast.iss !== iss) return { ok: false, grund: 'iss' };
  if (aud !== undefined && nutzlast.aud !== aud) return { ok: false, grund: 'aud' };
  if (!Number.isInteger(nutzlast.iat) || !Number.isInteger(nutzlast.exp)) return { ok: false, grund: 'zeit' };
  if (nutzlast.exp - nutzlast.iat > maxDauerSek || nutzlast.exp <= nutzlast.iat) return { ok: false, grund: 'dauer' };
  if (nutzlast.iat > jetztSek + toleranzSek) return { ok: false, grund: 'zeit' };
  if (nutzlast.exp <= jetztSek) return { ok: false, grund: 'abgelaufen' };
  if (typeof nutzlast.jti !== 'string' || nutzlast.jti.length < 16 || nutzlast.jti.length > 200) return { ok: false, grund: 'jti' };
  return { ok: true, nutzlast };
}

/**
 * Öffentliche Schlüssel als Liste: KeyObject, PEM (auch mehrere Blöcke, auch einzeilig mit „\\n“) oder Liste davon.
 * Mehrere Schlüssel erlauben einen Schlüsselwechsel ohne Ausfall (Vertrag §5).
 */
function schluesselListe(k) {
  if (Array.isArray(k)) return k.flatMap(schluesselListe);
  if (k instanceof crypto.KeyObject) return [k];
  const text = String(k || '').replace(/\\n/g, '\n');
  return (text.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g) || []).map((pem) => crypto.createPublicKey(pem));
}

/** Merkt sich verwendete jti bis zu ihrem Ablauf (im Speicher). merke() liefert false, wenn schon verwendet. */
class JtiSpeicher {
  constructor() {
    this.map = new Map();
  }
  merke(jti, expSek, jetztSek = Math.floor(Date.now() / 1000)) {
    for (const [k, e] of this.map) if (e < jetztSek) this.map.delete(k);
    if (this.map.has(jti)) return false;
    this.map.set(jti, expSek);
    return true;
  }
}

/** Kennung eines öffentlichen Schlüssels (kurz, stabil): SHA-256 über den DER-Inhalt, 16 Zeichen. */
function schluesselKennung(publicKey) {
  const key = publicKey instanceof crypto.KeyObject ? publicKey : crypto.createPublicKey(publicKey);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('base64url').slice(0, 16);
}

module.exports = { signiere, pruefe, JtiSpeicher, schluesselKennung, schluesselListe };

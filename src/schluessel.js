'use strict';
// Ed25519-Schlüsselpaar des Portals. Der private Schlüssel kommt aus PORTAL_PRIVATE_KEY (PEM, PKCS#8) und verlässt
// das Portal nie; der öffentliche Schlüssel wird abgeleitet und an die Plattformen verteilt (PORTAL_PUBLIC_KEY).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { schluesselKennung } = require('./jwt');

/** PEM aus einer Umgebungsvariablen: CapRover speichert Variablen einzeilig, daher sind „\n“ erlaubt. */
function pemAusText(text) {
  return String(text || '')
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, '$2') // Anführungszeichen aus der Variablen-Eingabe entfernen
    .replace(/\\n/g, '\n')
    .trim();
}

/** Liefert { privateKey, publicKey, pem, kid } oder wirft bei ungültigem Schlüssel. */
function ladeSchluessel(pemText) {
  const text = pemAusText(pemText);
  if (/^(-----BEGIN OPENSSH PRIVATE KEY-----\s*)?b3BlbnNzaC1rZXktdjE/.test(text)) {
    throw new Error('PORTAL_PRIVATE_KEY ist im OpenSSH-Format (ssh-keygen) – das wird nicht unterstützt. Variable leer lassen (das Portal erzeugt dann selbst einen Schlüssel) oder „npm run schluessel“ verwenden.');
  }
  let privateKey;
  try {
    privateKey = text.includes('-----BEGIN')
      ? crypto.createPrivateKey(text)
      : crypto.createPrivateKey({ key: Buffer.from(text.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    throw new Error('PORTAL_PRIVATE_KEY ist kein gültiger Schlüssel (erwartet: Ed25519, PKCS#8-PEM – erzeugen mit „npm run schluessel“).');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('PORTAL_PRIVATE_KEY muss ein Ed25519-Schlüssel (PKCS#8, PEM) sein.');
  const publicKey = crypto.createPublicKey(privateKey);
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { privateKey, publicKey, pem, kid: schluesselKennung(publicKey) };
}

function neuesPaar() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/**
 * Schlüssel in DATA_DIR erzeugen bzw. wiederverwenden (ohne PORTAL_PRIVATE_KEY): Der private Schlüssel entsteht auf
 * dem Server, liegt nur im persistenten Verzeichnis (Rechte 600) und muss nirgends abgetippt oder verschickt werden.
 * Liefert { pem, neu }.
 */
function dateiSchluessel(dataDir, name = 'portal-schluessel.pem') {
  const datei = path.join(dataDir, name);
  let neu = false;
  if (!fs.existsSync(datei)) {
    fs.writeFileSync(datei, neuesPaar(), { mode: 0o600, flag: 'wx' });
    neu = true;
  }
  return { pem: fs.readFileSync(datei, 'utf8'), datei, neu };
}

module.exports = { ladeSchluessel, neuesPaar, dateiSchluessel, pemAusText };

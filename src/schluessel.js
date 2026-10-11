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
    .replace(/\\n/g, '\n')
    .trim();
}

/** Liefert { privateKey, publicKey, pem, kid } oder wirft bei ungültigem Schlüssel. */
function ladeSchluessel(pemText) {
  const privateKey = crypto.createPrivateKey(pemAusText(pemText));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('PORTAL_PRIVATE_KEY muss ein Ed25519-Schlüssel (PKCS#8, PEM) sein.');
  const publicKey = crypto.createPublicKey(privateKey);
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { privateKey, publicKey, pem, kid: schluesselKennung(publicKey) };
}

function neuesPaar() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** Nur Entwicklung (PORTAL_DEV_SCHLUESSEL=1): Schlüssel in DATA_DIR erzeugen bzw. wiederverwenden. */
function devSchluessel(dataDir) {
  const datei = path.join(dataDir, 'dev-portal-schluessel.pem');
  if (!fs.existsSync(datei)) fs.writeFileSync(datei, neuesPaar(), { mode: 0o600 });
  return fs.readFileSync(datei, 'utf8');
}

module.exports = { ladeSchluessel, neuesPaar, devSchluessel, pemAusText };

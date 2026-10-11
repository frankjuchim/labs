#!/usr/bin/env node
'use strict';
// Erzeugt ein Ed25519-Schlüsselpaar für das Portal.
// Aufruf: npm run schluessel
// Ausgabe: PORTAL_PRIVATE_KEY (kompakt, eine Zeile: base64 des PKCS#8-Schlüssels, beginnt mit „MC4CAQAw“) für CapRover
// und der öffentliche Schlüssel (PORTAL_PUBLIC_KEY für die Plattformen). Den privaten Schlüssel nirgends speichern
// außer in CapRover – nicht ins Repository, nicht in Chats oder Tickets.

const crypto = require('node:crypto');
const { ladeSchluessel } = require('../src/schluessel');

const { privateKey } = crypto.generateKeyPairSync('ed25519');
const kompakt = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const k = ladeSchluessel(kompakt);
console.log('# Portal (CapRover → App labs → Umgebungsvariablen), GEHEIM:');
console.log('PORTAL_PRIVATE_KEY=' + kompakt);
console.log('');
console.log(`# Plattformen (öffentlich, Kennung ${k.kid}); nach dem Deploy auch unter <PORTAL_URL>/sso/schluessel.pem:`);
console.log('PORTAL_PUBLIC_KEY=' + k.pem.trim().replace(/\n/g, '\\n'));

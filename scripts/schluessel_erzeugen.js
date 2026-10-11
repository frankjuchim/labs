#!/usr/bin/env node
'use strict';
// Erzeugt ein Ed25519-Schlüsselpaar für das Portal.
// Aufruf: npm run schluessel
// Ausgabe: PORTAL_PRIVATE_KEY (einzeilig mit \n, zum Einfügen in CapRover) und der öffentliche Schlüssel
// (PORTAL_PUBLIC_KEY für die Plattformen). Den privaten Schlüssel nirgends speichern außer in CapRover.

const { neuesPaar, ladeSchluessel } = require('../src/schluessel');

const pem = neuesPaar();
const k = ladeSchluessel(pem);
console.log('# Portal (CapRover → App labs → Umgebungsvariablen), GEHEIM:');
console.log('PORTAL_PRIVATE_KEY=' + pem.trim().replace(/\n/g, '\\n'));
console.log('');
console.log(`# Plattformen (öffentlich, Kennung ${k.kid}):`);
console.log('PORTAL_PUBLIC_KEY=' + k.pem.trim().replace(/\n/g, '\\n'));

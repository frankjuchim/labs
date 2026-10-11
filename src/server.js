'use strict';
// Start des Portals (Konfiguration über Umgebungsvariablen, siehe README „Betrieb“).

const fs = require('node:fs');
const path = require('node:path');
const { createApp, VERSION } = require('./app');
const { devSchluessel } = require('./schluessel');

const PORT = Number(process.env.PORT) || 80;
const DATA_DIR = process.env.DATA_DIR || '/app/data';
fs.mkdirSync(DATA_DIR, { recursive: true });

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
let privateKeyPem = process.env.PORTAL_PRIVATE_KEY || '';
if (!privateKeyPem && process.env.PORTAL_DEV_SCHLUESSEL === '1') {
  privateKeyPem = devSchluessel(DATA_DIR);
  log('Entwicklung: Schlüssel aus ' + path.join(DATA_DIR, 'dev-portal-schluessel.pem'));
}

const app = createApp({
  dbFile: path.join(DATA_DIR, 'portal.db'),
  sessionSecret: process.env.SESSION_SECRET,
  portalUrl: process.env.PORTAL_URL,
  adminEmail: process.env.ADMIN_EMAIL || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  privateKeyPem,
  erlaubeHttp: process.env.ERLAUBE_HTTP === '1',
  trustProxy: process.env.TRUST_PROXY === undefined ? 1 : /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY,
  log
});
app.locals.wartung.start();

app.listen(PORT, () => log(`InfoLabs-Portal ${VERSION} läuft auf Port ${PORT} (Daten: ${DATA_DIR}).`));

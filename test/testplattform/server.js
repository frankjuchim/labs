'use strict';
// Test-Plattform einzeln starten (z. B. neben `npm run dev`):
//   PORTAL_URL=http://localhost:3100 PORT=4100 npm run testplattform
// Den öffentlichen Schlüssel holt sie beim Start vom Portal (/sso/schluessel.pem), falls PORTAL_PUBLIC_KEY fehlt.
// Danach im Portal (Superadmin → Plattformen) http://localhost:4100 eintragen und die Rücksprung-Adresse bestätigen.

const { createTestplattform } = require('./app');

const PORT = Number(process.env.PORT) || 4100;
const PORTAL_URL = (process.env.PORTAL_URL || 'http://localhost:3100').replace(/\/+$/, '');

(async () => {
  let pem = (process.env.PORTAL_PUBLIC_KEY || '').replace(/\\n/g, '\n');
  if (!pem) pem = await (await fetch(PORTAL_URL + '/sso/schluessel.pem')).text();
  const basis = process.env.PLATTFORM_URL || `http://localhost:${PORT}`;
  createTestplattform({ basis, portalUrl: PORTAL_URL, portalPublicKey: pem, id: process.env.PLATTFORM_ID }).listen(PORT, () =>
    console.log(`Testlabor auf ${basis} (Portal ${PORTAL_URL})`)
  );
})().catch((e) => {
  console.error('Start fehlgeschlagen:', e.message);
  process.exit(1);
});

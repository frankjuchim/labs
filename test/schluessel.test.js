'use strict';
// Portal-Schlüssel: Formate (PEM, einzeilig, kompakt), ungültiger Schlüssel legt das Portal nicht lahm, Schlüsselwechsel.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const H = require('./helpers');
const { ladeSchluessel, neuesPaar } = require('../src/schluessel');
const { signiere, pruefe } = require('../src/jwt');

test('Schlüsselformate: PEM, einzeilig mit \\n, kompakt (base64-PKCS#8)', () => {
  const pem = neuesPaar();
  const a = ladeSchluessel(pem);
  const b = ladeSchluessel(pem.trim().replace(/\n/g, '\\n'));
  const der = crypto.createPrivateKey(pem).export({ type: 'pkcs8', format: 'der' }).toString('base64');
  assert.match(der, /^MC4CAQAw/);
  const c = ladeSchluessel(der);
  assert.equal(a.kid, b.kid);
  assert.equal(a.kid, c.kid);
  assert.throws(() => ladeSchluessel('cZ2bR1Hhf+fJlAtCDTQZlpsaM+kppilGMvps+NngooOlunCpQ1AY0fEddQunoHaM'), /kein gültiger Schlüssel/);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => ladeSchluessel(rsa), /Ed25519/);
});

test('npm run schluessel liefert einen ladbaren kompakten Schlüssel', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'schluessel_erzeugen.js')], { encoding: 'utf8' });
  const priv = /PORTAL_PRIVATE_KEY=(\S+)/.exec(out)[1];
  const pub = /PORTAL_PUBLIC_KEY=(.+)/.exec(out)[1];
  const k = ladeSchluessel(priv);
  assert.equal(k.pem.trim(), pub.replace(/\\n/g, '\n'));
});

test('Ungültiger PORTAL_PRIVATE_KEY: Portal startet, SSO aus, Superadmin sieht den Grund', async () => {
  const meldungen = [];
  const app = H.makeApp({ privateKeyPem: 'kein-schluessel', log: (m) => meldungen.push(m) });
  assert.ok(meldungen.some((m) => /kein gültiger Schlüssel/.test(m)));
  const admin = await H.adminClient(app);
  const s = await H.erwarte(await admin.get('/api/admin/schluessel'), 200);
  assert.equal(s.aktiv, false);
  assert.match(s.fehler, /kein gültiger Schlüssel/);
  assert.equal((await admin.get('/api/admin/uebersicht')).body.schluessel, false);
  // Kurse funktionieren trotzdem
  await H.erwarte(await admin.post('/api/lehrkraft/kurse').send({ name: 'Ohne SSO' }), 201);
  assert.equal((await H.client(app).get('/sso/schluessel.pem')).status, 503);
});

test('Schlüsselwechsel: pruefe() akzeptiert mehrere öffentliche Schlüssel (PEM-Blöcke, auch einzeilig)', () => {
  const alt = ladeSchluessel(neuesPaar());
  const neu = ladeSchluessel(neuesPaar());
  const fremd = ladeSchluessel(neuesPaar());
  const beide = (alt.pem + neu.pem).replace(/\n/g, '\\n');
  const jetzt = Math.floor(Date.now() / 1000);
  const t = (k) => signiere({ iss: 'p', aud: 'x', sub: 's:1', iat: jetzt, exp: jetzt + 60, jti: crypto.randomUUID(), v: 1 }, k.privateKey);
  assert.equal(pruefe(t(alt), beide, { iss: 'p', aud: 'x' }).ok, true);
  assert.equal(pruefe(t(neu), beide, { iss: 'p', aud: 'x' }).ok, true);
  assert.equal(pruefe(t(fremd), beide, { iss: 'p', aud: 'x' }).grund, 'signatur');
  assert.equal(pruefe(t(neu), [alt.publicKey, neu.pem], { iss: 'p', aud: 'x' }).ok, true);
});

test('OpenSSH-Schlüssel (ssh-keygen) wird mit verständlicher Meldung abgelehnt', () => {
  const ssh = '-----BEGIN OPENSSH PRIVATE KEY-----\\nb3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0\\n-----END OPENSSH PRIVATE KEY-----';
  assert.throws(() => ladeSchluessel(ssh), /OpenSSH-Format/);
  assert.throws(() => ladeSchluessel('b3BlbnNzaC1rZXktdjEAAAAABG5vbmU='), /OpenSSH-Format/);
});

test('Ohne PORTAL_PRIVATE_KEY: Schlüssel wird im Datenverzeichnis erzeugt (600) und beim nächsten Start wiederverwendet', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const { dateiSchluessel } = require('../src/schluessel');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-schluessel-'));
  const a = dateiSchluessel(dir);
  const b = dateiSchluessel(dir);
  assert.equal(a.neu, true);
  assert.equal(b.neu, false);
  assert.equal(ladeSchluessel(a.pem).kid, ladeSchluessel(b.pem).kid);
  assert.equal(fs.statSync(a.datei).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true });
});

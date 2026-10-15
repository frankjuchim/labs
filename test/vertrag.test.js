'use strict';
// VERTRAG.md ist maßgeblich: Version, Änderungstabelle und Test-Plattform passen zusammen; Verweise sind gültig.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VERTRAG_HAUPTVERSION } = require('../scripts/vertrag_pruefen');

const WURZEL = path.join(__dirname, '..');
const vertrag = fs.readFileSync(path.join(WURZEL, 'VERTRAG.md'), 'utf8');
const version = /Vertrag v(\d+\.\d+)/.exec(vertrag)[1];

test('VERTRAG.md: Version im Titel = letzte Zeile der Änderungstabelle (§14), Hauptversion = Prüfskript', () => {
  const zeilen = [...vertrag.matchAll(/^\| (\d+\.\d+) \| \d{4}-\d{2} \|/gm)].map((m) => m[1]);
  assert.equal(zeilen.at(-1), version);
  assert.equal(Number(version.split('.')[0]), VERTRAG_HAUPTVERSION);
  for (let n = 1; n <= 14; n++) assert.match(vertrag, new RegExp(`^## §${n} `, 'm'), `§${n} fehlt`);
});

test('Test-Plattform meldet die aktuelle Vertragsversion; Doku verweist auf existierende Dateien', () => {
  const tp = fs.readFileSync(path.join(WURZEL, 'test', 'testplattform', 'app.js'), 'utf8');
  assert.match(tp, new RegExp(`vertrag: '${version.replace('.', '\\.')}'`));
  for (const datei of ['VERTRAG.md', 'README.md', 'CLAUDE.md', 'docs/INTEGRATION.md']) {
    const text = fs.readFileSync(path.join(WURZEL, datei), 'utf8');
    assert.doesNotMatch(text, /VERTRAG_VORSCHLAEGE/, datei);
    for (const m of text.matchAll(/\]\(((?:\.\.\/)?(?:docs|src|scripts|test)\/[^)#]+|VERTRAG\.md|\.\.\/VERTRAG\.md)\)/g)) {
      const ziel = path.join(WURZEL, path.dirname(datei), m[1]);
      assert.ok(fs.existsSync(ziel), `${datei}: Verweis ${m[1]} ins Leere`);
    }
  }
});

test('Vertragsprüfung: niveaus und urls.niveaus (ab v1.2) – optional, aber wenn vorhanden gültig', () => {
  const { pruefeManifest } = require('../scripts/vertrag_pruefen');
  const basis = {
    vertrag: '1.2', id: 'beispiel', name: 'B', titel: 'B', themenfeld: 'T', kurs: 'K', beschreibung: 'D', version: '1', basis: 'https://b.example',
    urls: { start: '/', gast: '/gast', themen: '/themen', lehrkraft: '/l', datenschutz: '/d', healthz: '/healthz' },
    auth: { modus: 'lokal', sso: false }, umfang: { aufgaben: 1 }, faehigkeiten: ['gast']
  };
  assert.deepEqual(pruefeManifest(basis), [], 'ohne niveaus gültig (v1.0/v1.1-Plattformen)');
  assert.deepEqual(pruefeManifest({ ...basis, niveaus: ['eA', 'gA'], urls: { ...basis.urls, niveaus: '/themen#niveaus' } }), []);
  assert.deepEqual(pruefeManifest({ ...basis, niveaus: ['gA'] }), []);
  assert.equal(pruefeManifest({ ...basis, niveaus: ['LK'] }).length, 1);
  assert.equal(pruefeManifest({ ...basis, niveaus: [] }).length, 1);
  assert.equal(pruefeManifest({ ...basis, urls: { ...basis.urls, niveaus: 'themen' } }).length, 1);
});

test('Vertragsprüfung: urls.ssoStart (ab v1.3) optional mit Standard /sso/start; /sso/start ohne Anmeldung → Portal', async () => {
  const { pruefeManifest, pruefeSsoStart, ssoStartPfad } = require('../scripts/vertrag_pruefen');
  const portal = 'https://labs.example';
  const m = {
    vertrag: '1.3', id: 'beispiel', name: 'B', titel: 'B', themenfeld: 'T', kurs: 'K', beschreibung: 'D', version: '1', basis: 'https://b.example',
    urls: { start: '/', gast: '/gast', themen: '/themen', lehrkraft: '/l', datenschutz: '/d', healthz: '/healthz' },
    auth: { modus: 'beides', portal, sso: true }, umfang: { aufgaben: 1 }, faehigkeiten: ['gast', 'sql-konsole', 'live']
  };
  assert.deepEqual(pruefeManifest(m), [], 'sso: true ohne urls.ssoStart ist ab v1.3 gültig');
  assert.equal(ssoStartPfad(m), '/sso/start');
  assert.equal(ssoStartPfad({ urls: { ssoStart: '/anmelden/portal' } }), '/anmelden/portal');
  assert.equal(pruefeManifest({ ...m, urls: { ...m.urls, ssoStart: 'sso/start' } }).length, 1);
  assert.equal(pruefeManifest({ ...m, urls: { ...m.urls, ssoStart: '//boese.example' } }).length, 1);

  const antwort = (status, location) => async (url) => {
    antwort.letzte = url;
    return { status, headers: { get: (k) => (k === 'location' ? location || null : null) } };
  };
  const zumPortal = `${portal}/sso/autorisieren?plattform=beispiel&ruecksprung=x&state=y`;
  assert.deepEqual(await pruefeSsoStart(m.basis, m, antwort(302, zumPortal)), { fehler: [], hinweise: [] });
  assert.equal(antwort.letzte, 'https://b.example/sso/start');
  assert.equal((await pruefeSsoStart(m.basis, m, antwort(404))).fehler.length, 1, '404 ist ein Fehler');
  assert.equal((await pruefeSsoStart(m.basis, m, antwort(200))).hinweise.length, 1, '200 nur Hinweis');
  assert.equal((await pruefeSsoStart(m.basis, m, antwort(302, 'https://boese.example/sso/autorisieren'))).hinweise.length, 1);
  assert.equal((await pruefeSsoStart(m.basis, m, antwort(302, zumPortal.replace('beispiel', 'anders')))).hinweise.length, 1);
  const fehlerNetz = async () => { throw new Error('weg'); };
  assert.deepEqual((await pruefeSsoStart(m.basis, m, fehlerNetz)).fehler, []);
  // lokal: keine Prüfung (keine bestehende Plattform wird ungültig)
  assert.deepEqual(await pruefeSsoStart(m.basis, { ...m, auth: { modus: 'lokal', sso: false } }, antwort(404)), { fehler: [], hinweise: [] });
});

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

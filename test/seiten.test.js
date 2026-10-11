'use strict';
// Seiten: ausgeliefert, ohne Inline-Skripte/-Styles (CSP), Cache-Versionen passend zu package.json, keine CDNs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const H = require('./helpers');

const PUBLIC = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const htmlDateien = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

test('Seiten werden ausgeliefert, unbekannte Adressen → 404-Seite', async () => {
  const app = H.makeApp();
  for (const p of ['/', '/anmelden', '/schueler', '/lehrkraft', '/datenschutz']) {
    const r = await request(app).get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers['content-type'], /text\/html/);
  }
  const r = await request(app).get('/gibt-es-nicht');
  assert.equal(r.status, 404);
  assert.match(r.text, /Seite nicht gefunden/);
  assert.equal((await request(app).get('/static/css/portal.css')).status, 200);
});

test('HTML: keine Inline-Skripte, keine style-Attribute, keine externen Ressourcen', () => {
  for (const f of htmlDateien) {
    const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert.match(m[1], /src="\/static\//, `${f}: Skript ohne lokale Quelle`);
      assert.equal(m[2].trim(), '', `${f}: Inline-Skript`);
    }
    assert.doesNotMatch(html, /<style\b/, `${f}: <style>`);
    assert.doesNotMatch(html, /\sstyle="/, `${f}: style-Attribut`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${f}: Event-Handler-Attribut`);
    assert.doesNotMatch(html, /(src|href)="https?:\/\//, `${f}: externe Ressource`);
  }
});

test('Cache-Versionen (?v=) entsprechen package.json; alle verlinkten Dateien existieren', () => {
  for (const f of htmlDateien) {
    const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="(\/static\/[^"?]+)(?:\?v=([^"]+))?"/g)) {
      assert.ok(fs.existsSync(path.join(PUBLIC, m[1])), `${f}: ${m[1]} fehlt`);
      if (/\.(js|css)$/.test(m[1])) assert.equal(m[2], VERSION, `${f}: ${m[1]} ohne aktuelle ?v=`);
    }
  }
});

test('JavaScript der Oberfläche: kein innerHTML, kein eval, kein document.write', () => {
  const dir = path.join(PUBLIC, 'static', 'js');
  for (const f of fs.readdirSync(dir)) {
    const js = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, f);
  }
});

test('Datenschutzseite: zentrale Erklärung mit Platzhaltern der Schule', async () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'datenschutz.html'), 'utf8');
  assert.match(html, /\[Name der Schule\]/);
  assert.match(html, /\[Hoster, Standort in der EU\]/);
  assert.match(html, /Ablaufdatum/);
});

#!/usr/bin/env node
'use strict';
/*
 * Ende-zu-Ende-Durchlauf im echten Browser (Playwright, Chromium) – Portal und Test-Plattform „Testlabor“ laufen lokal:
 *   Superadmin trägt das Testlabor ein und bestätigt die Rücksprung-Adresse → Lehrkraft fragt Zugang an → Freigabe
 *   + Freischaltung → Kurs anlegen → Schüler tritt per Link bei (Code notieren) → „Weiter zu Testlabor“ (SSO)
 *   → zweiter Schüler startet auf der Plattform, meldet sich im Portal an und landet zurück → Lehrkraft sieht Kennzahlen.
 *   Dabei: keine Konsolenfehler (CSP!). Screenshots (Tablet 1024×768, Smartphone 390×844) nach docs/screenshots/.
 *
 * Aufruf: npm run e2e   (Chromium: CHROMIUM_PATH oder PLAYWRIGHT_BROWSERS_PATH, Standard /opt/pw-browsers)
 */
process.env.PORTAL_SCRYPT_N = process.env.PORTAL_SCRYPT_N || '1024';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createApp } = require('../../src/app');
const { neuesPaar, ladeSchluessel } = require('../../src/schluessel');
const { createTestplattform } = require('../testplattform/app');

const BILDER = path.join(__dirname, '..', '..', 'docs', 'screenshots');
const ADMIN_PW = 'e2e-admin-passwort-1';
const TABLET = { width: 1024, height: 768 };
const HANDY = { width: 390, height: 844 };

function chromiumPfad() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const basis = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(basis)) {
    for (const d of fs.readdirSync(basis).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const p = path.join(basis, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const lausche = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

async function main() {
  fs.mkdirSync(BILDER, { recursive: true });
  const daten = fs.mkdtempSync(path.join(os.tmpdir(), 'infolabs-e2e-'));
  const pem = neuesPaar();

  const portalSrv = http.createServer();
  const portalUrl = await lausche(portalSrv);
  const portal = createApp({ dbFile: path.join(daten, 'portal.db'), sessionSecret: 'e2e-geheimnis-0123456789', portalUrl, adminEmail: 'admin', adminPassword: ADMIN_PW, privateKeyPem: pem, trustProxy: false });
  portalSrv.on('request', portal);
  const tpSrv = http.createServer();
  const tpUrl = await lausche(tpSrv);
  const tp = createTestplattform({ basis: tpUrl, portalUrl, portalPublicKey: ladeSchluessel(pem).pem });
  tpSrv.on('request', tp);

  const browser = await chromium.launch({ executablePath: chromiumPfad(), headless: true });
  const fehler = [];
  async function neueSeite(groesse) {
    const ctx = await browser.newContext({ viewport: groesse, locale: 'de-DE' });
    const page = await ctx.newPage();
    // Meldungen der Test-Plattform (z. B. fehlendes favicon.ico) zählen nicht
    page.on('console', (m) => m.type() === 'error' && !page.url().startsWith(tpUrl) && fehler.push(`${page.url()}: ${m.text()}`));
    page.on('pageerror', (e) => fehler.push(`${page.url()}: ${e.message}`));
    return page;
  }
  const bild = (page, name, voll = true) => page.screenshot({ path: path.join(BILDER, name), fullPage: voll });

  try {
    /* 1. Superadmin: Testlabor eintragen, Rücksprung bestätigen, AutomatenLab vorläufig */
    const admin = await neueSeite(TABLET);
    await admin.goto(portalUrl + '/#lehrkraft');
    await admin.click('#tab-lehrkraft');
    await admin.fill('#l-email', 'admin');
    await admin.fill('#l-passwort', ADMIN_PW);
    await admin.click('#form-lehrkraft button[type="submit"]');
    await admin.waitForURL(/\/lehrkraft/);
    await admin.goto(portalUrl + '/lehrkraft#/admin/plattformen');
    await admin.fill('input[name="basis"]', tpUrl);
    await admin.click('text=Manifest abrufen und eintragen');
    await admin.waitForSelector('text=Vorschlag');
    await admin.click('button:has-text("Vorschlag")');
    // warten, bis die Seite nach dem Speichern neu aufgebaut ist (sonst landet die Eingabe im alten Formular)
    await admin.waitForSelector('text=Noch nicht freigegeben', { state: 'detached' });
    await admin.waitForSelector('.ampel.ok');
    // Plattform ohne Manifest (hier: nicht erreichbar, ohne Netz) → vorläufiges Formular
    await admin.fill('input[name="basis"]', 'http://localhost:1');
    await admin.click('text=Manifest abrufen und eintragen');
    await admin.waitForSelector('text=Als vorläufigen Eintrag anlegen', { timeout: 20000 });
    // erwartete Ablehnung (400) des Manifest-Abrufs ist kein Fehler der Oberfläche
    for (let i = fehler.length - 1; i >= 0; i--) if (/status of 400/.test(fehler[i])) fehler.splice(i, 1);
    await admin.fill('form:has-text("vorläufigen") input[name="id"]', 'automatenlab');
    await admin.fill('form:has-text("vorläufigen") input[name="name"]', 'AutomatenLab');
    await admin.fill('form:has-text("vorläufigen") input[name="themenfeld"]', 'Automaten und formale Sprachen');
    await admin.fill('form:has-text("vorläufigen") textarea[name="beschreibung"]', 'Maschinen, die Sprache verstehen: Akzeptoren, Kellerautomaten, Grammatiken und Turingmaschinen.');
    await admin.click('text=Vorläufig eintragen');
    await admin.waitForSelector('.ampel.vorlaeufig');
    await bild(admin, 'superadmin_plattformen.png');

    /* 2. Lehrkraft fragt Zugang an */
    const lk = await neueSeite(TABLET);
    await lk.goto(portalUrl + '/');
    await lk.click('#tab-lehrkraft');
    await lk.click('summary');
    await lk.fill('#r-name', 'Lehrkraft Beispiel');
    await lk.fill('#r-email', 'lehrkraft@schule.example');
    await lk.fill('#r-schule', 'Beispielschule');
    await lk.fill('#r-passwort', 'lehrkraft-passwort-1');
    await lk.fill('#r-nachricht', 'Bitte Testlabor freischalten.');
    await lk.click('#form-registrieren button[type="submit"]');
    await lk.waitForSelector('text=Ihre Anfrage wird geprüft');

    /* 3. Superadmin gibt frei und schaltet das Testlabor frei */
    await admin.goto(portalUrl + '/lehrkraft#/admin/lehrkraefte');
    await admin.click('tr:has-text("lehrkraft@schule.example") >> text=Freigeben');
    await admin.waitForSelector('tr:has-text("lehrkraft@schule.example") >> text=Deaktivieren');
    await admin.check('tr:has-text("lehrkraft@schule.example") >> label:has-text("Testlabor") >> input');
    await admin.waitForSelector('text=Testlabor: freigeschaltet');
    await bild(admin, 'superadmin_lehrkraefte.png');

    /* 4. Lehrkraft legt einen Kurs an */
    await lk.click('#tab-lehrkraft');
    await lk.fill('#l-email', 'lehrkraft@schule.example');
    await lk.fill('#l-passwort', 'lehrkraft-passwort-1');
    await lk.click('#form-lehrkraft button[type="submit"]');
    await lk.waitForURL(/\/lehrkraft/);
    await lk.fill('#k-name', 'Informatik LK 13');
    await lk.click('#form-neu button[type="submit"]');
    await lk.waitForURL(/#\/kurs\/\d+/);
    const kurscode = (await lk.textContent('.kurskopf .code-gross')).trim();
    assert.match(kurscode, /^[A-HJ-NP-Z2-9]{6}$/);

    /* 5. Schüler (Tablet) tritt per Link bei und wechselt per SSO ins Testlabor */
    const s1 = await neueSeite(TABLET);
    await s1.goto(`${portalUrl}/?kurs=${kurscode}`);
    await s1.waitForSelector('#kurs-info:has-text("Informatik LK 13")');
    await bild(s1, 'start_tablet.png');
    await s1.fill('#b-name', 'Mika R.');
    await s1.click('#form-beitreten button[type="submit"]');
    await s1.waitForSelector('#code-box:not([hidden])');
    const code1 = (await s1.textContent('#code-wert')).trim();
    assert.match(code1, /^[A-HJ-NP-Z]{3}-[2-9]{3}$/);
    await bild(s1, 'schueler_code.png', false);
    await s1.check('#code-ok');
    await s1.click('#code-weiter');
    await s1.waitForURL(/\/schueler$/);
    await s1.waitForSelector('text=Weiter zu Testlabor');
    await bild(s1, 'schueler_plattformen.png');
    await s1.click('text=Weiter zu Testlabor');
    await s1.waitForURL(tpUrl + '/');
    assert.match(await s1.textContent('body'), /Angemeldet als Mika R\. \(schueler\)/);

    /* 6. Zweiter Schüler (Smartphone) startet auf der Plattform: Anmeldung im Portal, zurück zur Plattform */
    const s2 = await neueSeite(HANDY);
    await s2.goto(tpUrl + '/sso/start');
    await s2.waitForURL(/\/anmelden\?weiter=/);
    await s2.waitForSelector('#sso-hinweis:not([hidden]) >> text=Testlabor');
    await s2.fill('#b-kurscode', kurscode);
    await s2.fill('#b-name', 'Noa B.');
    await bild(s2, 'sso_anmeldung_handy.png');
    await s2.click('#form-beitreten button[type="submit"]');
    await s2.waitForSelector('#code-box:not([hidden])');
    await s2.check('#code-ok');
    await s2.click('#code-weiter');
    await s2.waitForURL(tpUrl + '/');
    assert.match(await s2.textContent('body'), /Angemeldet als Noa B\./);
    await fetch(tpUrl + '/api/punkte', { method: 'POST' }).catch(() => {});

    /* 7. Lehrkraft: Schülerliste und Kennzahlen aus dem Testlabor */
    await lk.reload();
    await lk.waitForSelector('text=Schüler (2)');
    await lk.click('text=Lernstand auf Testlabor laden');
    await lk.waitForSelector('td:has-text("Noa B.")');
    await bild(lk, 'lehrkraft_kurs.png');
    await lk.goto(portalUrl + '/lehrkraft#/kurse');
    await lk.waitForSelector('.kurskarte');
    await bild(lk, 'lehrkraft_kurse.png');

    /* 8. Öffentliche Startseite mit Plattformen (Tablet + Smartphone) */
    const gast = await neueSeite(TABLET);
    await gast.goto(portalUrl + '/');
    await gast.waitForSelector('.plattform >> text=Testlabor');
    await gast.waitForSelector('.plattform >> text=AutomatenLab');
    await bild(gast, 'startseite.png');
    const gastHandy = await neueSeite(HANDY);
    await gastHandy.goto(portalUrl + '/');
    await gastHandy.waitForSelector('.plattform >> text=Testlabor');
    await bild(gastHandy, 'startseite_handy.png');

    /* 9. keine horizontale Scrollleiste auf dem Smartphone */
    for (const [p, url] of [[gastHandy, '/'], [gastHandy, '/datenschutz'], [gastHandy, '/anmelden?weiter=%2Fsso%2Fautorisieren%3Fplattform%3Dtestlabor'], [gastHandy, '/gibt-es-nicht']]) {
      await p.goto(portalUrl + url);
      const breit = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(breit <= 1, `${url}: horizontales Scrollen (${breit}px)`);
    }

    assert.deepEqual(fehler, [], 'Konsolenfehler:\n' + fehler.join('\n'));
    console.log(`✔ E2E-Durchlauf erfolgreich (Kurscode ${kurscode}). Screenshots: docs/screenshots/`);
  } finally {
    await browser.close();
    portalSrv.closeAllConnections();
    tpSrv.closeAllConnections();
    portalSrv.close();
    tpSrv.close();
    fs.rmSync(daten, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('✘ E2E fehlgeschlagen:', e.message);
  process.exit(1);
});

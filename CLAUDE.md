# CLAUDE.md – InfoLabs (Portal des Plattform-Verbunds)

## Projektüberblick

InfoLabs ist das **Portal** des Plattform-Verbunds für den Informatikunterricht der Oberstufe (Niedersachsen, Abitur ab
2027): Konten (Superadmin, Lehrkräfte, Schüler), Kurse mit Kurscode, Freischaltungen Lehrkraft×Plattform und
Kurs×Plattform, Single Sign-on zu den Plattformen, Verbund-API (Löschung, Kursänderung, Kennzahlen), öffentliche
Übersicht, zentrale Datenschutzerklärung, Datenübernahme aus Algo Quest.
Ziel: https://labs.frankjuchim.de (CapRover, `captain-definition` + `Dockerfile`, Port 80, Datenbank in `/app/data`).

> ⚠️ **`main` ist direkt mit CapRover verbunden: Jeder Push auf `main` startet sofort den Live-Build.**
> Nur auf Feature-Branches arbeiten; nach `main` nur nach ausdrücklicher Freigabe und mit grünen Tests.

## Verbindliche Grundlage

- **Vertrag v1 = README Teil H im Repo `frankjuchim/AlgoQuest`** (Rollen H.4, SSO H.5, Verbund-API H.6, Manifest H.7,
  Konfiguration H.8, gemeinsame Regeln H.9, Datenschutz H.10, Übergang H.11). Nie still abweichen: Änderungen als
  konkreten Text mit neuer Versionsnummer und H.14-Eintrag vorschlagen (`docs/VERTRAG_VORSCHLAEGE.md`) und Frank fragen.
- Die Plattform-Repos (`frankjuchim/AlgoQuest`, `frankjuchim/AutomatenLab`) werden aus diesem Repo heraus **nicht**
  geändert – nur mit ausdrücklicher Genehmigung. Was Plattformen tun müssen, steht in `docs/INTEGRATION.md`.
- Stil, Arbeitsweise und Sicherheitsregeln wie in Algo Quest (dortige CLAUDE.md und README Teil F, G.4).

## Befehle

```
npm install
npm test                 # node:test + supertest (inkl. SSO/Verbund Ende-zu-Ende mit der Test-Plattform)
npm run e2e              # Playwright-Durchlauf (Chromium /opt/pw-browsers, kein `playwright install`), Screenshots → docs/screenshots
npm run pruefen          # test + e2e
npm run dev              # Port 3100, Superadmin admin / admin1234, Daten ./data, Entwicklungsschlüssel
PORTAL_URL=http://localhost:3100 npm run testplattform   # Testlabor auf Port 4100
npm run schluessel       # Ed25519-Schlüsselpaar für den Betrieb
node scripts/vertrag_pruefen.js <URL>                     # Manifest einer laufenden Plattform prüfen
```

## Ordnerstruktur

```
src/app.js, server.js, db.js (Migrationen nur anhängen), security.js (= Algo Quest), jwt.js (portabel), schluessel.js,
    validate.js, wartung.js
src/routes/      oeffentlich, schueler, lehrkraft, admin, sso
src/services/    konten, kurse, loeschung, plattformen, sso, verbund, import
public/          index.html (Übersicht/Anmeldung/SSO), schueler.html, lehrkraft.html (+ Superadmin), datenschutz.html, 404.html
scripts/         vertrag_pruefen.js (unverändert aus Algo Quest), schluessel_erzeugen.js
test/            *.test.js, helpers.js, testplattform/ (Mini-Plattform „Testlabor“), e2e/e2e.js
docs/            INTEGRATION.md, VERTRAG_VORSCHLAEGE.md, screenshots/
```

## Konventionen

### Sprache
- Alles auf Deutsch (Code-Bezeichner, Kommentare, Commit-Messages, UI, Doku).
- Schüler werden **geduzt**, Lehrkräfte **gesiezt**. Begriffe nach H.9: „Kurs“, „Kurscode“, „persönlicher Code“,
  „Lehrkraft“, „Plattform“, „Portal“; keine XP.

### Konten und Codes (nicht ändern ohne Vertragsänderung)
- `sub`: `a:<id>` Superadmin, `l:<id>` Lehrkraft, `s:<id>` Schüler; Kurs-ID `k:<id>`; IDs mit `AUTOINCREMENT` (nie neu vergeben).
- Kurscode 6 Zeichen aus `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; persönlicher Code `ABC-234` (Buchstaben ohne I/O,
  Ziffern 2–9), kursübergreifend eindeutig (UNIQUE). Schülername 2–30 Zeichen, je Kurs eindeutig (ohne Groß/Klein).
- Passwörter: `crypto.scrypt`, Format `scrypt$N$r$p$salt$hash` wie Algo Quest (importierte Hashes bleiben gültig).
- Ein Schüler = ein Konto für mehrere Kurse. Schüler ohne Kurs werden gelöscht (Kurs löschen, aus Kurs entfernen, Ablauf).

### SSO und Verbund
- Token-Inhalt **exakt** nach H.5 (`iss, aud, sub, rolle, name, kurse, iat, exp, jti, v`), `exp − iat = 90 s` (≤ 120),
  Verbund-Tokens 60 s mit `sub: "portal"` und `zweck` ∈ `loeschen | kurs-uebersicht | kurs-aendern`.
- Rücksprung zeichengenau aus der Whitelist (`plattformen.ruecksprung`); bei ungültiger Anfrage Fehlerseite, **nie** weiterleiten.
- Jede Löschung im Portal stößt `POST /api/verbund/loeschen` auf allen betroffenen Plattformen an (Aufträge mit
  Wiederholung, `services/verbund.js`); nur Plattformen mit `auth.modus` `beides`/`portal`.
- Neue Verbund-Funktionen immer mit Test gegen die Test-Plattform (`test/testplattform/app.js`) – sie ist zugleich die
  Referenz für `docs/INTEGRATION.md` und muss vertragsgemäß bleiben (`pruefeManifest` leer).

### Datenschutz und Sicherheit
- Keine Klarnamen außer selbst gewählten Schülernamen (in Beispieldaten, Tests, Screenshots nur Fantasienamen wie
  „Mika R.“ und `@schule.example`).
- Keine externen Ressourcen/CDNs, keine Inline-Skripte/-Styles (CSP), Ausgaben nur als DOM-Textknoten (`IL.h`),
  kein `innerHTML` (Test `seiten.test.js`).
- Privater Schlüssel nur in `PORTAL_PRIVATE_KEY`, nie committen, nie loggen; Tokens nie loggen.
- Plattformen bekommen nie persönliche Codes oder Passwörter; die Kursübersicht zeigt nur Kennzahlen.
- Neue Endpunkte: Rechte für jede Rolle testen (`rechte.test.js`), Fehlertexte auf Deutsch, ohne Details.

### Oberfläche
- Hausfarben #1F4E79 / Gold #B8860B / Grün #548235 / Rot #C00000 / Kasten #DBE7F5; Touch-Ziele ≥ 44 px; Tablet und
  Smartphone ohne horizontales Scrollen (E2E prüft das).
- Nach Änderungen an `public/static/**` die `?v=`-Version in `public/*.html` **und** `package.json` erhöhen
  (Browser-Cache 1 h; Test prüft Gleichstand).

### Qualitätssicherung (vor jedem Commit)
- `npm test` grün; bei Oberflächenänderungen zusätzlich `npm run e2e` und die Screenshots ansehen.
- Schema-Änderungen nur als neue Migration in `src/db.js`.

## Offene Punkte
- Vertrag v1.1 (`docs/VERTRAG_VORSCHLAEGE.md`) mit Frank abstimmen; danach Umzug des Vertrags nach `VERTRAG.md`.
- Algo Quest Phase 1 (SSO-Empfänger, Verbund-API, `AUTH_MODUS=beides`) nach `docs/INTEGRATION.md` – im AlgoQuest-Repo.
- AutomatenLab: Manifest `/api/plattform` + `/healthz` (bis dahin vorläufiger Eintrag).
- `public/datenschutz.html`: Angaben in `[…]` von der Schule ergänzen lassen.
- Mehrere öffentliche Schlüssel (Schlüsselwechsel) in `jwt.pruefe` unterstützen, sobald v1.1 freigegeben ist.

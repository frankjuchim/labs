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

- **Vertrag = [`VERTRAG.md`](VERTRAG.md) in diesem Repo (Version 1.1, maßgeblich für Portal und alle Plattformen;
  §n entspricht dem früheren README Teil H.n in AlgoQuest).** Rollen §4, SSO §5, Verbund-API §6, Manifest §7,
  Konfiguration §8, gemeinsame Regeln §9, Datenschutz §10, Übergang §11. Nie still abweichen: Änderungen nur in
  `VERTRAG.md`, mit Frank abgestimmt, neuer Versionsnummer und Eintrag in §14 – erst den Vertrag ändern, dann bauen.
- `scripts/vertrag_pruefen.js` und `src/jwt.js` sind die maßgeblichen Fassungen, die Plattformen unverändert kopieren;
  Änderungen daran sind Vertragsänderungen.
- Die Plattform-Repos (`frankjuchim/AlgoQuest`, `frankjuchim/AutomatenLab`) werden aus diesem Repo heraus **nicht**
  geändert – nur mit ausdrücklicher Genehmigung. Was Plattformen tun müssen, steht in `docs/INTEGRATION.md`.
- Stil, Arbeitsweise und Sicherheitsregeln wie in Algo Quest (dortige CLAUDE.md und README Teil F, G.4).

## Befehle

```
npm install
npm test                 # node:test + supertest (inkl. SSO/Verbund Ende-zu-Ende mit der Test-Plattform)
npm run e2e              # Playwright-Durchlauf (Chromium /opt/pw-browsers, kein `playwright install`), Screenshots → docs/screenshots
npm run pruefen          # test + e2e
npm run dev              # Port 3100, Superadmin admin / admin1234, Daten ./data (Signaturschlüssel dort)
PORTAL_URL=http://localhost:3100 npm run testplattform   # Testlabor auf Port 4100
npm run schluessel       # Ed25519-Schlüsselpaar für den Betrieb
node scripts/vertrag_pruefen.js <URL>                     # Manifest einer laufenden Plattform prüfen
```

## Ordnerstruktur

```
src/app.js, server.js, db.js (Migrationen nur anhängen), security.js (= Algo Quest), jwt.js (portabel), schluessel.js,
    validate.js, wartung.js
src/routes/      oeffentlich, schueler, lehrkraft, admin, sso
src/services/    konten, kurse, loeschung, plattformen, sso, verbund, import, sicherung
public/          index.html (Übersicht/Anmeldung/SSO), schueler.html, lehrkraft.html (+ Superadmin), datenschutz.html, 404.html
scripts/         vertrag_pruefen.js (unverändert aus Algo Quest), schluessel_erzeugen.js
test/            *.test.js, helpers.js, testplattform/ (Mini-Plattform „Testlabor“), e2e/e2e.js
VERTRAG.md       Vertrag des Plattform-Verbunds (maßgeblich)
docs/            INTEGRATION.md, screenshots/
```

## Konventionen

### Sprache
- Alles auf Deutsch (Code-Bezeichner, Kommentare, Commit-Messages, UI, Doku).
- Schüler werden **geduzt**, Lehrkräfte **gesiezt**. Begriffe nach §9: „Kurs“, „Kurscode“, „persönlicher Code“,
  „Lehrkraft“, „Plattform“, „Portal“; keine XP.

### Konten und Codes (nicht ändern ohne Vertragsänderung)
- `sub`: `a:<id>` Superadmin, `l:<id>` Lehrkraft, `s:<id>` Schüler; Kurs-ID `k:<id>`; IDs mit `AUTOINCREMENT` (nie neu vergeben).
- Kurscode 6 Zeichen aus `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; persönlicher Code `ABC-234` (Buchstaben ohne I/O,
  Ziffern 2–9), kursübergreifend eindeutig (UNIQUE). Schülername 2–30 Zeichen, je Kurs eindeutig (ohne Groß/Klein).
- Sichtbar heißt die oberste Rolle **„Admin“** (Kontoname „Admin“, geht per SSO als `name` an die Plattformen);
  technisch bleibt sie `superadmin` (`sub a:<id>`, Token-`rolle`, Vertrag §5) – nicht umbenennen.
- Passwörter: `crypto.scrypt`, Format `scrypt$N$r$p$salt$hash` wie Algo Quest (importierte Hashes bleiben gültig).
- Ein Schüler = ein Konto für mehrere Kurse. Schüler ohne Kurs werden gelöscht (Kurs löschen, aus Kurs entfernen, Ablauf).

### SSO und Verbund
- Token-Inhalt **exakt** nach §5 (`iss, aud, sub, rolle, name, kurse, iat, exp, jti, v`), `exp − iat = 90 s` (≤ 120),
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
- Privater Schlüssel nur auf dem Server: `DATA_DIR/portal-schluessel.pem` (automatisch, Standard) oder `PORTAL_PRIVATE_KEY`; nie committen, nie loggen, nie in Chats; Tokens nie loggen.
- Plattformen bekommen nie persönliche Codes oder Passwörter; die Kursübersicht zeigt nur Kennzahlen.
- Neue Endpunkte: Rechte für jede Rolle testen (`rechte.test.js`), Fehlertexte auf Deutsch, ohne Details.

### Oberfläche
- Design „Verbund · Aurora“: hell, Aurora aus den Hausfarben #1F4E79 / Gold #B8860B (#E3B341) / Grün #548235 /
  Rot #C00000, Nachtblau #0B1B2E für Text und Fußzeile; Überschriften Space Grotesk (lokal, `public/static/fonts`);
  Plattformen in ihrer Manifest-Farbe (`IL.textFarbe` für lesbaren Text). Das Portal sieht bewusst anders aus als die
  Plattformen (Algo Quest dunkel/Dungeon, AutomatenLab grün/Kästchenpapier).
- Spezialeffekte nur in `effekte.js` (global `window.IL_EFFEKTE`), immer mit `prefers-reduced-motion`-Ausstieg; Inhalte
  dürfen ohne Effekte nie versteckt bleiben (E2E prüft „nach dem Scrollen alles sichtbar“ und reduzierte Bewegung).
- Touch-Ziele ≥ 44 px; Tablet und Smartphone ohne horizontales Scrollen (E2E prüft das); Animationen nur ohne
  `prefers-reduced-motion`.
- Nach Änderungen an `public/static/**` die `?v=`-Version in `public/*.html` **und** `package.json` erhöhen
  (Browser-Cache 1 h; Test prüft Gleichstand).

### Qualitätssicherung (vor jedem Commit)
- `npm test` grün; bei Oberflächenänderungen zusätzlich `npm run e2e` und die Screenshots ansehen.
- Schema-Änderungen nur als neue Migration in `src/db.js`; neue Tabellen auch in `TABELLEN` (`services/sicherung.js`)
  aufnehmen, sonst fehlen sie in der Sicherung.

## Offene Punkte
- AlgoQuest-README Teil H auf einen Verweis auf `VERTRAG.md` kürzen (nur mit Genehmigung, im AlgoQuest-Repo).
- Algo Quest Phase 1 (SSO-Empfänger, Verbund-API, `AUTH_MODUS=beides`) nach `docs/INTEGRATION.md` – im AlgoQuest-Repo.
- AutomatenLab: Manifest `/api/plattform` + `/healthz` (bis dahin vorläufiger Eintrag).
- `public/datenschutz.html`: Angaben in `[…]` von der Schule ergänzen lassen.

# InfoLabs – Portal des Plattform-Verbunds

**InfoLabs** ist die übergeordnete Verwaltung der Lernplattformen für den Informatikunterricht der Oberstufe
(Niedersachsen, Abitur ab 2027). Das Portal führt Konten, Kurse und Freischaltungen, meldet Lehrkräfte und Schüler per
**Single Sign-on** bei den Plattformen an und gibt Löschungen an sie weiter. Die Lernplattformen (z. B. Algo Quest)
laufen als eigene Apps mit eigener Datenbank.

Ziel-Adresse: **https://labs.frankjuchim.de** (CapRover-App `labs`).

> ⚠️ **`main` ist direkt mit CapRover verbunden: Jeder Push auf `main` startet sofort den Live-Build.**
> Nur auf Feature-Branches arbeiten; nach `main` nur nach ausdrücklicher Freigabe und mit grüner Prüfung.

## Inhalt

1. [Was das Portal kann](#1-was-das-portal-kann)
2. [Verbund](#2-verbund)
3. [Aufbau](#3-aufbau)
4. [Entwicklung und Prüfung](#4-entwicklung-und-prüfung)
5. [Betrieb mit CapRover](#5-betrieb-mit-caprover)
6. [Datenschutz und Sicherheit](#6-datenschutz-und-sicherheit)
7. [API](#7-api)

---

## 1. Was das Portal kann

| Rolle | Funktionen |
|---|---|
| **Öffentlich** | Übersicht aller Plattformen aus ihren Manifesten (Name, Themenfeld, Farbe, Gastmodus, Themenseite); zentrale Datenschutzerklärung `/datenschutz` |
| **Schüler** | Beitritt mit **Kurscode + selbst gewähltem Namen** → persönlicher Code `ABC-234` (Buchstaben ohne I/O, Ziffern 2–9, kursübergreifend eindeutig); Weiterlernen mit Name + Code; **ein Konto für mehrere Kurse** (weiterem Kurs per Kurscode beitreten); Seite „Meine Plattformen“ mit „Weiter zu …“ (SSO) |
| **Lehrkraft** | Zugang anfragen, nach Freigabe anmelden; Kurse anlegen (Kurscode, Beitritts-Link, QR-Code, Ablaufdatum, Plattformen – nur freigeschaltete); Schülerliste mit Codes (umbenennen, neuer Code, entfernen, Codeliste drucken); **Mitlehrkräfte** per Einladung; Kennzahlen der Plattformen je Kurs |
| **Admin** (Rolle `superadmin`) | Lehrkräfte freigeben/ablehnen/deaktivieren, Einmal-Passwort, **Freischaltung je Plattform**, löschen; **Plattformen** per Basis-URL eintragen, Manifest gegen den Vertrag prüfen, Rücksprung-Adresse (Whitelist) bestätigen, Status/Version, vorläufige Einträge ohne Manifest; öffentlichen Schlüssel anzeigen; **Verbund-Aufträge** überwachen; **Datenübernahme** aus Algo Quest; **Sicherung** herunterladen und wiederherstellen |

Weitere Regeln:

- **Kurs-Ablauf:** Jeder Kurs hat ein Ablaufdatum (Standard 31.07. des Schuljahres, höchstens 24 Monate, verlängerbar).
  30 Tage vorher erscheint ein Hinweis bei der Lehrkraft; danach werden Kurs und Schülerkonten ohne weiteren Kurs
  gelöscht – im Portal und auf allen Plattformen.
- **Mitlehrkräfte** verwalten Schüler und sehen Kennzahlen; Plattformen, Ablaufdatum, Einladungen und Löschen bleiben
  bei der Inhaberin bzw. dem Inhaber des Kurses.
- **Vorläufige Plattformen** (ohne Manifest, z. B. AutomatenLab bis zur Umstellung) erscheinen nur als Link – kein SSO,
  nicht für Kurse wählbar. „Jetzt prüfen“ stellt sie automatisch um, sobald ein gültiges Manifest kommt.

## 2. Verbund

**Verbindlich für Portal und Plattformen ist der Vertrag [`VERTRAG.md`](VERTRAG.md) (Version 1.1)** in diesem
Repository. Er löst README Teil H im Repo `frankjuchim/AlgoQuest` ab (Abschnittsnummern gleich: §n = H.n) und regelt
Rollen (§4), Single Sign-on mit Ed25519-JWT (§5), Verbund-API (§6), Plattform-Manifest (§7), Konfiguration (§8),
gemeinsame Regeln (§9), Datenschutz (§10) und den Übergang bestehender Plattformen (§11). Änderungen nur dort, mit neuer
Version und Eintrag in §14.

**Verweis aus einer neuen Plattform** (README und CLAUDE.md):
„Verbindlich ist der Vertrag des Plattform-Verbunds: https://github.com/frankjuchim/labs/blob/main/VERTRAG.md
(Version 1.1); Anschluss nach https://github.com/frankjuchim/labs/blob/main/docs/INTEGRATION.md.“

| Thema | Umsetzung im Portal |
|---|---|
| Konten, `sub` | `a:<n>` Superadmin, `l:<n>` Lehrkraft, `s:<n>` Schüler, Kurs-IDs `k:<n>` – nie neu vergeben (`AUTOINCREMENT`) |
| SSO (§5) | `GET /sso/autorisieren` → Token (EdDSA, `exp − iat = 90 s`, `jti` zufällig 128 bit) an die freigegebene Rücksprung-Adresse; `GET /sso/abbrechen`; `GET /sso/abmelden` |
| Schlüssel | privat nur auf dem Server (`/app/data/portal-schluessel.pem` bzw. `PORTAL_PRIVATE_KEY`); öffentlich unter `/sso/schluessel.pem` und `/api/portal/schluessel` sowie im Superadmin-Bereich |
| Verbund-API (§6) | Löschung (`loeschen`), Kursänderung (`kurs-aendern`) als Aufträge mit Wiederholung; Kursübersicht (`kurs-uebersicht`) sofort |
| Manifest (§7, §12) | `scripts/vertrag_pruefen.js` (maßgebliche Fassung); Prüfung beim Eintragen, auf Knopfdruck und alle 6 h |
| Übergang (§11) | Import des Algo-Quest-Backups: Lehrkräfte mit scrypt-Hash, Kurse mit Kurscode, Schüler mit Name + Code – Codes unverändert; Zuordnung alt → neu als JSON |

- **Anschluss einer Plattform:** [`docs/INTEGRATION.md`](docs/INTEGRATION.md) – Schritt für Schritt mit Testfällen.
  Referenz: die Test-Plattform [`test/testplattform/`](test/testplattform/app.js); Bausteine zum Kopieren:
  [`src/jwt.js`](src/jwt.js), [`scripts/vertrag_pruefen.js`](scripts/vertrag_pruefen.js).

Bekannte Plattformen:

| Plattform | ID | Stand |
|---|---|---|
| Algo Quest | `algoquest` | Manifest vertragsgemäß (2.5.0), Anmeldung noch lokal (`AUTH_MODUS=lokal`) – nächster Schritt: Phase 1 nach `docs/INTEGRATION.md`; README Teil H dort auf Verweis kürzen |
| AutomatenLab | `automatenlab` | noch kein Manifest und kein Login → vorläufiger Eintrag |

## 3. Aufbau

```
src/
  app.js            Express 5, Helmet/CSP, Sitzung (ein signiertes Cookie), Routen, Fehler
  server.js         Start (Umgebungsvariablen)
  db.js             SQLite (better-sqlite3), Migrationen (nur anhängen)
  security.js       wie Algo Quest: scrypt (gleiches Hash-Format), Cookies, Rate-Limits, CSRF, Codes
  jwt.js            Ed25519-JWT signieren/prüfen, jti-Speicher – zum Kopieren in Plattformen gedacht
  schluessel.js     Portal-Schlüssel aus PORTAL_PRIVATE_KEY
  validate.js       Eingaben (Namen, Codes, URLs, Datum)
  wartung.js        tägliche Sicherung, Ablauf, Aufträge wiederholen, Plattformen prüfen
  routes/           oeffentlich, schueler, lehrkraft, admin, sso
  services/         konten, kurse, loeschung, plattformen, sso, verbund, import, sicherung
public/             index.html (Übersicht + Anmeldung + SSO-Anmeldung), schueler.html, lehrkraft.html (inkl. Superadmin),
                    datenschutz.html; static/js (common, start, schueler, lehrkraft, admin), static/css/portal.css
scripts/            vertrag_pruefen.js (aus Algo Quest), schluessel_erzeugen.js
test/               node:test + supertest; testplattform/ (Mini-Plattform „Testlabor“); e2e/e2e.js (Playwright)
docs/               INTEGRATION.md, screenshots/ (vom E2E-Durchlauf erzeugt)
VERTRAG.md          Vertrag des Plattform-Verbunds (maßgeblich)
```

Gestaltung „Verbund · Aurora“ (bewusst anders als die Plattformen: Algo Quest ist dunkel mit Dungeon-Mauer, AutomatenLab
grün auf Kästchenpapier): helle Bühne mit langsam fließender Aurora aus den Hausfarben, gläserne Kopfzeile und
Anmeldekarte, Verlaufs-Schriftzug, Regenbogenkante; ein Netz, in dem jede Plattform als farbiger Knoten am
InfoLabs-Zentrum hängt (aus den Manifesten); Überschriften in Space Grotesk (lokal in `public/static/fonts`, SIL OFL),
Fließtext Systemschrift; Plattform-Kacheln in der jeweiligen Plattformfarbe (Schriftfarbe automatisch nach Kontrast).
Spezialeffekte (`public/static/js/effekte.js`): schwebende Knoten mit Datenpaketen, wechselndes Themenfeld,
hochzählende Kennzahlen, 3D-Neigung mit Lichtreflex, Einblenden beim Scrollen, Lichtkegel am Mauszeiger, Konfetti beim
Beitritt – alle aus bei „reduzierter Bewegung“, ohne JavaScript bleibt die Seite vollständig nutzbar (E2E prüft beides).
Touch-Ziele ≥ 44 px, Tastaturbedienung, Druckansicht für Codelisten.

## 4. Entwicklung und Prüfung

```bash
npm install
npm run dev            # Portal auf http://localhost:3100, Superadmin admin / admin1234, Daten in ./data,
                       # Signaturschlüssel wird in ./data erzeugt
PORTAL_URL=http://localhost:3100 npm run testplattform   # Testlabor auf http://localhost:4100 (im Portal eintragen)
npm test               # Unit-/API-/SSO-/Verbund-Tests (node:test + supertest, Portal + Testlabor auf echten Ports)
npm run e2e            # Browser-Durchlauf (Chromium unter /opt/pw-browsers bzw. CHROMIUM_PATH), Screenshots → docs/screenshots
npm run pruefen        # beides
npm run schluessel     # optional: eigenes Ed25519-Schlüsselpaar (sonst erzeugt das Portal selbst einen)
```

Die GitHub-Prüfung (`.github/workflows/pruefung.yml`) führt bei jedem Push Tests, Browser-Durchlauf und Docker-Build aus.

## 5. Betrieb mit CapRover

1. App `labs` anlegen, **HTTP-Port 80**, Persistent Directory **`/app/data`** (SQLite `portal.db`), HTTPS aktivieren,
   Domain `labs.frankjuchim.de`.
2. Umgebungsvariablen (Beispiel: `.env.example`):

   | Variable | Bedeutung |
   |---|---|
   | `PORTAL_URL` | `https://labs.frankjuchim.de` – Pflicht, ist `iss` aller Tokens |
   | `PORTAL_PRIVATE_KEY` | **leer lassen (empfohlen):** Das Portal erzeugt beim ersten Start einen Ed25519-Schlüssel in `DATA_DIR/portal-schluessel.pem` (Rechte 600) und nutzt ihn danach immer wieder – der private Schlüssel verlässt den Server nie. Optional: eigener Schlüssel aus `npm run schluessel` (kompakt `MC4CAQAw…` oder PEM). Ein ungültiger Wert (z. B. OpenSSH-Schlüssel aus `ssh-keygen`) legt das Portal nicht lahm, schaltet aber SSO ab; der Superadmin sieht den Grund |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Superadmin (Standard-Login `admin`); Passwort wird bei jedem Start gesetzt, ohne Passwort ist der Superadmin-Login gesperrt |
   | `SESSION_SECRET` | langer Zufallswert (≥ 16 Zeichen) für die Cookies |
   | `PORT` / `DATA_DIR` / `TRUST_PROXY` | Standard `80` / `/app/data` / `1` |

3. Den öffentlichen Schlüssel (Superadmin → Plattformen, oder `https://labs.frankjuchim.de/sso/schluessel.pem`) als
   `PORTAL_PUBLIC_KEY` bei den Plattformen eintragen. **Wichtig:** Die Datei `/app/data/portal-schluessel.pem` gehört
   zum Datenbestand – geht sie verloren, entsteht ein neuer Schlüssel und alle Plattformen brauchen den neuen
   öffentlichen Schlüssel. In Sicherungen von `/app/data` ist sie enthalten; sie ist geheim zu halten.
4. Healthcheck `GET /healthz` → `{"status":"ok","version":"…"}`.
5. Deploy nur nach Freigabe: `git fetch origin main && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main`,
   danach `/healthz` auf die neue Version prüfen. Nicht während des Unterrichts deployen.

**Sicherung:** Superadmin → *Sicherung*: JSON-Sicherung aller Konten, Kurse, Codes, Plattformen und Freischaltungen
herunterladen (enthält Passwort-Hashes – vertraulich aufbewahren) bzw. wiederherstellen (ersetzt alles; alle
Sitzungen enden; `sub`/Kurs-IDs werden danach nie unter dem bisherigen Höchststand vergeben; der Superadmin kommt
wieder aus `ADMIN_EMAIL`/`ADMIN_PASSWORD`). Zusätzlich legt das Portal täglich eine Kopie der Datenbank in
`/app/data/sicherungen/` an (letzte 14 Tage) – Schutz vor Fehlbedienung, nicht vor Verlust des Servers; dafür
regelmäßig herunterladen. Der Signaturschlüssel `/app/data/portal-schluessel.pem` ist in keiner Sicherung enthalten:
beim Umzug auf einen neuen Server mitnehmen (sonst brauchen alle Plattformen den neuen öffentlichen Schlüssel).

**Schlüsselwechsel:** neues Paar erzeugen, öffentlichen Schlüssel zuerst bei allen Plattformen hinterlegen, dann
`PORTAL_PRIVATE_KEY` tauschen (Vertrag §5: neuen öffentlichen Schlüssel zuerst bei allen Plattformen ergänzen – `PORTAL_PUBLIC_KEY` darf mehrere PEM-Blöcke enthalten).

## 6. Datenschutz und Sicherheit

- Gespeichert: Schüler nur mit selbst gewähltem Namen, persönlichem Code, Kursen und Zeitstempeln; Lehrkräfte mit Name,
  E-Mail, Schule, Nachricht, scrypt-Hash. Keine Klarnamen in Beispieldaten, Tests oder Screenshots.
- Plattformen erhalten nur `sub`, Rolle, Anzeigenamen und Kurse (§5); vom Portal fließen nie Codes oder Passwörter.
  Die Kursübersicht liefert nur Kennzahlen. Die zentrale Datenschutzerklärung (`/datenschutz`) enthält Platzhalter in
  `[…]` für die Angaben der Schule.
- Strikte CSP ohne Inline-Skripte, Ausgaben nur als Textknoten, `X-Robots-Tag: noindex`, keine CDNs.
- Cookie signiert (HMAC-SHA256), `httpOnly`, `SameSite=Lax`, `secure` hinter HTTPS; Schüler 30 Tage, Lehrkräfte 8 h.
- CSRF: schreibende API nur mit passender `Origin`/`Referer` und als JSON.
- Rate-Limits: Beitritt 60 / 10 min je IP; Schüler-Login 8 Fehlversuche / 15 min je Name, 100 je IP; Lehrkraft-Login
  8 je Konto, 20 je IP; Registrierung 5 / h je IP; SSO 120 / min je IP. IP-Adressen nur im Arbeitsspeicher.
- SSO: Rücksprung-Adressen zeichengenau aus der Whitelist; bei Fehlern keine Weiterleitung; Antworten mit
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`; Tokens werden nie geloggt.

## 7. API

Alle Antworten JSON; schreibende Anfragen mit `Content-Type: application/json` und gleicher Herkunft.

| Bereich | Endpunkte |
|---|---|
| Öffentlich | `GET /healthz` · `GET /api/sitzung` · `GET /api/plattformen` · `GET /api/kurs/:code` · `POST /api/schueler/beitreten {kurscode, name}` · `POST /api/schueler/anmelden {name, code}` · `POST /api/abmelden` · `POST /api/lehrkraft/registrieren` · `POST /api/lehrkraft/anmelden` · `GET /api/portal/schluessel` |
| SSO | `GET /sso/autorisieren?plattform&ruecksprung&state&ziel` · `GET /sso/abbrechen?…` · `GET /sso/abmelden?ruecksprung` · `GET /sso/schluessel.pem` |
| Schüler | `GET /api/schueler/ich` · `POST /api/schueler/kurse {kurscode}` |
| Lehrkraft (`/api/lehrkraft`) | `/ich` · `/passwort` · `/plattformen` · `/kurse` (GET, POST) · `/kurse/:id` (GET, PATCH `{name?, beitrittOffen?, ablauf?, plattformen?}`, DELETE `{bestaetigung}`) · `/kurse/:id/neuer-kurscode` · `/kurse/:id/qr.svg` · `/kurse/:id/schueler` (+ `/:sid` PATCH/DELETE, `/:sid/neuer-code`) · `/kurse/:id/einladungen` · `/kurse/:id/lehrkraefte/:lid` (DELETE) · `/einladungen` · `/kurse/:id/uebersicht/:plattform` |
| Superadmin (`/api/admin`) | `/uebersicht` · `/lehrkraefte` (+ `/:id/status`, `/:id/einmalpasswort`, `/:id/plattformen` PUT, DELETE) · `/plattformen` (POST `{basis}`, `/vorlaeufig`, `/:pid/pruefen`, PATCH `{ruecksprung?, aktiv?, reihenfolge?, angaben?}`, DELETE) · `/schluessel` · `/auftraege` (+ `/verarbeiten`, `/:id/wiederholen`) · `/import {daten, probelauf}` · `/importe` (+ `/:id/zuordnung.json`) · `/sicherung` · `/wiederherstellen {daten, bestaetigung: "WIEDERHERSTELLEN"}` · `/sicherungen` (+ `/:name`) |

---

*InfoLabs – Portal des Plattform-Verbunds. Arbeitsregeln: `CLAUDE.md`.*

# Der Plattform-Verbund InfoLabs – Vertrag v1.1

> **Status:** Vertrag **v1.1 (verbindlich)**. Maßgeblich ist diese Datei im Repository **`frankjuchim/labs`**
> (Portal InfoLabs). Sie löst README Teil H im Repository `frankjuchim/AlgoQuest` ab (dort Fassung v1.0); die
> Abschnittsnummern sind gleich geblieben: **§n entspricht H.n**. Änderungen werden **nur hier** gemacht – mit
> Erhöhung der Versionsnummer und einem Eintrag in §14.
>
> **Verweis aus einer Plattform:** „Verbindlich ist der Vertrag des Plattform-Verbunds:
> https://github.com/frankjuchim/labs/blob/main/VERTRAG.md (Version 1.1)“.
>
> **An Claude:** Wenn du eine Plattform des Verbunds oder das Portal baust, ist dieser Vertrag verbindlich. **MUSS** =
> Pflicht, **SOLL** = Regelfall (Abweichung nur mit Begründung im README der Plattform), **KANN** = freiwillig.
> Weicht dein Projekt ab oder brauchst du eine Erweiterung, schlage eine Vertragsänderung vor (konkreter Text, neue
> Version, Eintrag in §14), statt still abzuweichen. Ändere aus einem Plattform-Repo heraus nie dieses Repository.

Begleitende Dateien in diesem Repository:

| Datei | Zweck |
|---|---|
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | Schritt-für-Schritt-Anleitung: Plattform an das Portal anschließen (SSO, Verbund-API, Testfälle) |
| [`scripts/vertrag_pruefen.js`](scripts/vertrag_pruefen.js) | Vertragsprüfung einer laufenden Plattform (§12) – unverändert in jede Plattform kopieren |
| [`src/jwt.js`](src/jwt.js) | empfohlener Baustein zum Prüfen der Tokens (nur `node:crypto`) – unverändert kopieren |
| [`test/testplattform/app.js`](test/testplattform/app.js) | kleinste vertragsgemäße Plattform („Testlabor“), Referenzumsetzung |

---

## §1 Zielbild

Für jedes Themenfeld der Informatik-Oberstufe gibt es eine eigene **Plattform** nach dem Muster von Algo Quest
(AlgoQuest-README Teil G). Alle Plattformen sind über **ein gemeinsames Login** erreichbar. Das **Portal InfoLabs**
(**https://labs.frankjuchim.de**) verwaltet Konten, Kurse und Freischaltungen und verlinkt die Plattformen.

```
                         ┌──────────────────────────────────────────────┐
                         │ PORTAL InfoLabs (https://labs.frankjuchim.de) │
                         │ Konten: Superadmin, Lehrkräfte, Schüler       │
                         │ Kurse + Kurscodes + Mitgliedschaften          │
                         │ Freischaltungen Lehrkraft×Plattform,          │
                         │ Kurs×Plattform · Übersicht · Datenschutz      │
                         └──────┬─────────────────────────────▲─────────┘
           ① Anmeldung (SSO):   │ Weiterleitung + signiertes  │ ③ Manifest /api/plattform
              Token (Ed25519)   │ Token                       │   (öffentlich)
                                ▼                             │
   ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐
   │ algoquest.…           │  │ <plattform-b>.…       │  │ <plattform-c>.…       │
   │ Inhalte, Lernstand,   │  │                       │  │                       │
   │ Kurs-Einstellungen,   │◄─┤ ② Verbund-API (Portal → Plattform, signiert):     │
   │ Auswertung, Gastmodus │  │   Übersicht, Löschung, Kursänderungen             │
   └───────────────────────┘  └───────────────────────┘  └───────────────────────┘
```

In Konfigurationen heißt die Portal-Adresse `PORTAL_URL` = `https://labs.frankjuchim.de` (ohne Schrägstrich am Ende).

## §2 Begriffe

| Begriff | Bedeutung |
|---|---|
| **Portal** | übergeordnete Verwaltung: Identitäten, Kurse, Freischaltungen, Links; eigene App (Repository `frankjuchim/labs`) |
| **Plattform** | Lern-App eines Themenfelds (z. B. Algo Quest); eigene App, eigene Datenbank, eigene Subdomain |
| **Plattform-ID** | kurzer, fester Name = Subdomain, `^[a-z][a-z0-9-]{1,30}$` (z. B. `algoquest`); ändert sich nie |
| **sub** | stabile, pseudonyme Kennung eines Kontos, vom Portal vergeben: `l:<n>` Lehrkraft, `s:<n>` Schüler, `a:<n>` Superadmin; wird nie neu vergeben |
| **Kurs-ID** | stabile Kennung eines Kurses, vom Portal vergeben: `k:<n>` |
| **Kurscode** | 6 Zeichen aus `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, zum Beitritt am Portal |
| **persönlicher Code** | Schüler-Code `ABC-234` (Buchstaben ohne I/O, Ziffern 2–9), kursübergreifend eindeutig, Anmeldung mit Name + Code am Portal |
| **Mitlehrkraft** | weitere Lehrkraft eines Kurses (per Einladung der Inhaberin bzw. des Inhabers) |

## §3 Zuständigkeiten

| Gegenstand | liegt beim | Bemerkung |
|---|---|---|
| Konten (Superadmin, Lehrkräfte, Schüler), Passwörter, persönliche Codes | **Portal** | Plattformen speichern **nie** Passwörter oder Codes |
| Registrierung und Freigabe von Lehrkräften | **Portal** | Superadmin schaltet je Lehrkraft die Plattformen frei |
| Kurse, Kurscodes, Mitgliedschaften, Mitlehrkräfte, Ablaufdatum | **Portal** | ein Kurs kann mehrere Plattformen nutzen (nur freigeschaltete der Inhaberin); ein Schülerkonto kann mehreren Kursen angehören |
| Kurs-Einstellungen je Plattform (freigeschaltete Welten, Bosse, Scoreboard, Beamer-Board) | **Plattform** | gespeichert unter der Kurs-ID |
| Inhalte, Aufgaben, Prüfung, Lernstand, Punkte, Abzeichen, Auswertung | **Plattform** | gespeichert unter `sub` und Kurs-ID |
| Gastmodus, Themenseite, Lehrkraft-Materialien | **Plattform** | wie in Algo Quest (AlgoQuest-README C.3–C.5) |
| Übersicht über alle Plattformen eines Kurses | **Portal** | holt Kennzahlen über die Verbund-API (§6) |
| Datenschutzerklärung | **Portal** (zentral, `/datenschutz`) | Plattform ergänzt nur ihre Besonderheiten und verlinkt die zentrale |
| Löschung | **Portal** stößt an | Plattform löscht auf Anforderung (§6) |

## §4 Rollen und Rechte

- **Superadmin** (`a:`): alles im Portal; auf jeder Plattform Lehrkraft-Rechte für alle Kurse plus Plattform-Verwaltung
  (Inhalte neu laden, Seed-Bericht, Backup).
- **Lehrkraft** (`l:`): darf eine Plattform nur nutzen, wenn sie dort **freigeschaltet** ist; sieht auf der Plattform
  nur Kurse, in denen sie im Token als `lehrkraft` steht (als Inhaberin oder Mitlehrkraft).
- **Schüler** (`s:`): darf eine Plattform nur nutzen, wenn mindestens einer seiner Kurse diese Plattform freigeschaltet
  hat; sieht nur eigenen Lernstand und das Scoreboard seiner Kurse (falls aktiv).
- Der **Gastmodus** (`/gast`) jeder Plattform bleibt ohne Anmeldung erreichbar und nutzt nie echte Daten.

## §5 Anmeldung: Single Sign-on (MUSS ab Auth-Modus `portal`/`beides`)

**Ablauf** (Weiterleitung im Browser, kein gemeinsames Cookie nötig):

1. Ohne Sitzung leitet die Plattform weiter auf
   `<PORTAL_URL>/sso/autorisieren?plattform=<id>&ruecksprung=<https://<id>.…/sso/ende>&state=<zufall>&ziel=<pfad>`.
   `state` besteht aus **mindestens 22 Zeichen** aus `A–Z a–z 0–9 - _ . ~` (z. B. 16 Byte Zufall, base64url) und wird
   in einem kurzlebigen Cookie gemerkt (`httpOnly`, `SameSite=Lax`, 10 min).
2. Das Portal meldet bei Bedarf an (Lehrkraft: E-Mail + Passwort; Schüler: Name + persönlicher Code; Beitritt neuer
   Schüler mit Kurscode + Name) und prüft die Berechtigung (§4). `ruecksprung` MUSS **zeichengenau** der im Portal
   hinterlegten Adresse der Plattform entsprechen (Whitelist). Bei unbekannter oder abgeschalteter Plattform, nicht
   freigegebener Rücksprung-Adresse oder ungültigem `state` leitet das Portal **nicht** weiter, sondern zeigt eine
   Fehlerseite. Ein `ziel`, das nicht mit genau einem `/` beginnt, ersetzt das Portal durch `/`.
3. Das Portal leitet zurück: `ruecksprung?token=<JWT>&state=<state>&ziel=<pfad>` – bei Ablehnung
   `ruecksprung?fehler=keine_berechtigung|abgebrochen&state=<state>`.
4. Die Plattform prüft das Token (siehe unten), legt das lokale Konto an bzw. aktualisiert es (Upsert nach `sub`),
   gleicht die Kursmitgliedschaften ab, setzt **ihre eigene** Sitzung (signiertes Cookie wie in Algo Quest) und leitet
   auf `ziel` (nur relative Pfade).

**Token** (JWT, kompakt, `alg: EdDSA` mit Ed25519; mit Node-Bordmitteln `crypto.sign/verify` prüfbar):

```json
{
  "iss": "https://labs.frankjuchim.de",
  "aud": "algoquest",
  "sub": "s:1042",
  "rolle": "schueler",
  "name": "Lena S.",
  "kurse": [{ "id": "k:17", "name": "LK Informatik 13", "rolle": "mitglied" }],
  "iat": 1760000000,
  "exp": 1760000090,
  "jti": "9f2c…",
  "v": 1
}
```

- `rolle`: `schueler` | `lehrkraft` | `superadmin`. `kurse[].rolle`: `mitglied` | `lehrkraft`.
  `kurse` enthält **nur** Kurse, die diese Plattform freigeschaltet haben:
  - Schüler: seine Kurse (`mitglied`); ohne solchen Kurs gibt es kein Token (`fehler=keine_berechtigung`).
  - Lehrkraft: Kurse als Inhaberin **und** als Mitlehrkraft (`lehrkraft`); ohne Freischaltung kein Token.
  - Superadmin: alle Kurse, die diese Plattform nutzen (`lehrkraft`).
- Der Token-Kopf ist `{"alg":"EdDSA","typ":"JWT"}` und KANN `kid` (Kennung des Portal-Schlüssels) enthalten.
- Die Plattform MUSS prüfen: Signatur mit dem öffentlichen Portal-Schlüssel (`PORTAL_PUBLIC_KEY`, PEM), `iss` =
  `PORTAL_URL`, `aud` = eigene Plattform-ID, `exp` noch nicht erreicht und `exp − iat ≤ 120 s`, `state` = Cookie,
  `jti` noch nicht verwendet (bis `exp` merken), `v` = 1. Ein Token ist genau einmal verwendbar.
  `/sso/ende` antwortet mit `Referrer-Policy: no-referrer` und leitet sofort weiter, damit das Token nicht in
  Verläufen oder Referern landet; Tokens werden nie geloggt.
- **Schlüssel:** Der öffentliche Schlüssel ist abrufbar unter `<PORTAL_URL>/sso/schluessel.pem` (PEM) und
  `<PORTAL_URL>/api/portal/schluessel` (`{alg, crv, kid, iss, pem}`). Plattformen konfigurieren ihn trotzdem **fest**
  (`PORTAL_PUBLIC_KEY`, einzeilig mit `\n` erlaubt) und holen ihn nicht zur Laufzeit. `PORTAL_PUBLIC_KEY` DARF mehrere
  PEM-Blöcke enthalten; ein Token ist gültig, wenn einer passt. **Schlüsselwechsel:** neuen öffentlichen Schlüssel
  zuerst auf allen Plattformen ergänzen, dann im Portal den privaten Schlüssel tauschen, den alten nach einem Tag entfernen.
- Kurse, die die Plattform noch nicht kennt, legt sie mit Standard-Einstellungen an; Name und Mitgliedschaft werden bei
  jeder Anmeldung aktualisiert. Fehlt ein Kurs im Token, verliert das Konto auf dieser Plattform den Zugang dazu
  (Lernstand bleibt bis zur Löschung erhalten).
- Sitzungsdauer auf der Plattform: Schüler höchstens 30 Tage, Lehrkräfte höchstens 8 Stunden. Läuft sie ab, startet
  die Plattform still den SSO-Ablauf neu.
- **Abmelden:** Die Plattform beendet ihre Sitzung; der Knopf „Überall abmelden“ führt auf
  `<PORTAL_URL>/sso/abmelden?ruecksprung=<https://<id>.…/>`. Das Portal leitet nur auf Adressen zurück, deren Ursprung
  die Basis einer eingetragenen Plattform ist, sonst auf seine Startseite.

## §6 Verbund-API (Portal → Plattform, serverseitig)

Jede Anfrage trägt `Authorization: Bearer <JWT>` – vom Portal signiert (Ed25519), `iss` = `PORTAL_URL`,
`aud` = Plattform-ID, `sub` = `portal`, `zweck` (siehe Tabelle), `exp − iat ≤ 60 s`, `jti` einmalig.
Ohne gültiges Token (auch bei falschem `zweck`): `401`. Antworten sind JSON. `:kursId` ist URL-kodiert (`k%3A17`).

| Methode und Pfad | `zweck` | Pflicht | Zweck |
|---|---|---|---|
| `GET /api/plattform` | – | **MUSS** (öffentlich, ohne Token) | Manifest (§7) |
| `GET /healthz` | – | **MUSS** (öffentlich) | `{"status":"ok","version":"…"}` – Version wie im Manifest |
| `POST /api/verbund/loeschen` `{ "sub": "s:1042" }` oder `{ "kurs": "k:17" }` | `loeschen` | **MUSS** (ab `portal`/`beides`) | alle Daten des Kontos bzw. des Kurses auf der Plattform löschen; idempotent; Antwort `{ "geloescht": n }` |
| `GET /api/verbund/kurse/:kursId/uebersicht` | `kurs-uebersicht` | **SOLL** | Kennzahlen für das Portal (Format unten); unbekannter Kurs: `404`. **Keine** Antworten, Lösungen oder Freitexte |
| `POST /api/verbund/kurse/:kursId` `{ "name"?: "…", "aktiv"?: false }` | `kurs-aendern` | **SOLL** | Kurs umbenannt bzw. Plattform für den Kurs ab-/wieder eingeschaltet → übernehmen bzw. Kurs sperren/entsperren |

Antwort der Kursübersicht (`anteil` = Anteil an den Level-Punkten der freigeschalteten Welten, 0…1):

```json
{ "kurs": "k:17", "stand": "2026-10-11T10:00:00Z",
  "schueler": [{ "sub": "s:1042", "punkte": 120, "geloest": 14, "anteil": 0.31, "zuletzt": "2026-10-10T09:12:00Z" }],
  "welten":   [{ "nr": 0, "titel": "Die Akademie", "anteil": 0.55 }] }
```

Das Portal sendet Löschungen und Kursänderungen nur an Plattformen, deren Manifest `auth.modus` = `beides` oder
`portal` meldet, als Auftrag mit Wiederholung bei Fehlern (1, 5, 30, 120 Minuten … insgesamt etwa 6 Tage).

## §7 Plattform-Manifest (MUSS)

`GET /api/plattform` liefert öffentlich (mit `Access-Control-Allow-Origin: *`) die Selbstauskunft der Plattform.
Das Portal baut daraus seine Übersicht und prüft die Vertragsversion. Beispiel (Algo Quest, gekürzt):

```json
{
  "vertrag": "1.1",
  "id": "algoquest",
  "name": "Algo Quest",
  "titel": "Algo Quest – Das Dungeon der Datenstrukturen",
  "themenfeld": "Algorithmik und Datenstrukturen",
  "kurs": "Informatik eA (LK), Niedersachsen, Abitur ab 2027",
  "beschreibung": "Übungsplattform mit automatisch geprüften Aufgaben im Abitur-Stil …",
  "farbe": "#1F4E79",
  "version": "2.5.0",
  "basis": "https://algoquest.frankjuchim.de",
  "icon": "/static/favicon.svg",
  "urls": { "start": "/", "gast": "/gast", "themen": "/themen", "lehrkraft": "/lehrer",
            "datenschutz": "/datenschutz", "healthz": "/healthz", "ssoStart": "/sso/start", "ssoEnde": "/sso/ende" },
  "auth": { "modus": "beides", "portal": "https://labs.frankjuchim.de", "sso": true },
  "umfang": { "welten": 7, "level": 36, "aufgaben": 388, "bosse": 7 },
  "welten": [{ "nr": 0, "titel": "Die Akademie", "farbe": "#7F6000", "level": 6 }, "…"],
  "faehigkeiten": ["gast", "themen", "lehrkraft-materialien", "boss", "training", "warmup",
                   "scoreboard", "beamer", "urkunden", "fallen-profil"]
}
```

Pflichtfelder prüft `scripts/vertrag_pruefen.js` (§12): `vertrag`, `id`, `name`, `titel`, `themenfeld`, `kurs`,
`beschreibung`, `version`, `basis`, `urls.{start,gast,themen,lehrkraft,datenschutz,healthz}`, `auth.{modus,sso}`
(bei `sso: true` auch `urls.ssoStart`), `umfang`, `faehigkeiten` (mit `gast`).
`urls.ssoEnde` (KANN): Pfad des SSO-Rücksprungs; das Portal schlägt `basis + urls.ssoEnde` als Rücksprung-Adresse vor
(der Superadmin bestätigt sie). Das Portal verlinkt Schüler mit „Weiter zu …“ auf `basis + urls.ssoStart`.
Das Manifest enthält **nie** Kurs-, Schüler- oder Lösungsdaten. Neue Felder sind erlaubt (Nebenversion), Umbenennen
oder Entfernen nur mit neuer Hauptversion. Plattformen nach v1.0 bleiben gültig.

## §8 Konfiguration (MUSS, gleiche Namen auf allen Plattformen)

| Variable | Bedeutung |
|---|---|
| `PLATTFORM_ID` | Plattform-ID (Standard im Code fest, z. B. `algoquest`) |
| `PLATTFORM_URL` | öffentliche Basis-URL, z. B. `https://algoquest.frankjuchim.de` (sonst aus der Anfrage) |
| `PORTAL_URL` | `https://labs.frankjuchim.de`; leer = Plattform läuft allein |
| `PORTAL_PUBLIC_KEY` | öffentlicher Ed25519-Schlüssel des Portals (PEM, auch einzeilig mit `\n`, ggf. mehrere Blöcke) zum Prüfen von SSO- und Verbund-Tokens |
| `AUTH_MODUS` | `lokal` (eigene Anmeldung wie bisher) · `beides` (Übergang: lokal **und** Portal) · `portal` (nur Portal; lokale Registrierung und Anmeldung abgeschaltet) |
| `SESSION_SECRET`, `DATA_DIR`, `PORT`, `TRUST_PROXY` | wie in Algo Quest (README F.1) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | nur in `lokal`/`beides`; in `portal` kommt der Superadmin vom Portal |

Das Portal selbst nutzt `PORTAL_URL`, `PORTAL_PRIVATE_KEY` (Ed25519, PKCS#8 – PEM oder kompakt base64), `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, `SESSION_SECRET`, `DATA_DIR`, `PORT`, `TRUST_PROXY` (siehe README des Portals).

## §9 Gemeinsame Regeln für alle Plattformen (MUSS)

- **Technik:** Node ≥ 20, Express, SQLite (better-sqlite3), Vanilla-JS ohne Build, keine CDNs, strikte CSP ohne
  Inline-Skripte, `X-Robots-Tag: noindex`, Healthcheck, Docker + CapRover, `main` = live (nur nach Freigabe),
  GitHub-Prüfung bei jedem Push.
- **Sicherheit:** Lösungen, Erklärungen und nicht abgerufene Tipps nur serverseitig und erst nach dem Lösen;
  Boss-Aufgaben nur im laufenden Kampf; Lehrkraft-Dateien nur mit Anmeldung und Whitelist; Rate-Limits;
  Eingaben validiert, SQL parametrisiert, Ausgaben als Textknoten.
- **Datenschutz:** nur Anzeigename (Empfehlung „Vorname + Initial“), `sub`, Kurs-IDs und Lernstand auf der Plattform;
  keine Klarnamen in Beispieldaten, Screenshots, Tests, Materialien, Videos; Löschung auf Anforderung des Portals.
- **Didaktik und Begriffe:** Welt → Level (1 je DS) → Arbeitsblatt + Lab + Boss; Fallen-Liste P1–P10 des Themas
  (gleiches Schema: Nummer, Kurztitel, Erläuterung); Gastmodus `/gast` mit eigenen Demo-Aufgaben; Themenseite
  `/themen` ohne Lösungen; Abitur-Stil (Schüler duzen, Prüfungsaufgaben siezen); Begriffe „Kurs“, „Kurscode“,
  „persönlicher Code“, „Lehrkraft“, „Warm-up“, „Team“; Punkte nur automatisch (keine Erfahrungspunkte-Währung).
- **Vergleichbarkeit im Portal:** gleiche Punkteformel `round(punkte × max(0.25, 1 − 0.25·Fehlversuche − 0.2·Tipps))`,
  Standardpunkte 10/20/30 je Stufe, gleiche Rangschwellen (0/10/30/55/80 % der Level-Punkte der freigeschalteten Welten).
- **Inhaltsformat:** Aufgaben im Format von `docs/AUFGABENFORMAT.md` (Algo Quest); neue Blocktypen/Interaktionen sind
  erlaubt, werden im eigenen `AUFGABENFORMAT.md` beschrieben und mit Tests und Beispielwelt abgedeckt.
- **Oberfläche (SOLL):** Hausfarben (#1F4E79, Gold #B8860B, Grün #548235, Rot #C00000), eigene Plattformfarbe, in der
  Kopfzeile ein Link „⌂ Portal“, sobald `PORTAL_URL` gesetzt ist; Tablet-tauglich (Touch-Ziele ≥ 44 px).

## §10 Datenschutz im Verbund

- Das Portal ist die einzige Stelle mit Konten, Codes und Kurszugehörigkeiten; es führt die zentrale
  Datenschutzerklärung (`<PORTAL_URL>/datenschutz`) und das Verzeichnis der Verarbeitungstätigkeiten für den Verbund.
- Plattformen verarbeiten pseudonym (`sub` + Anzeigename) und geben Lernstände nur an das Portal weiter (§6, nur
  Kennzahlen). Zwischen Plattformen fließen keine Daten.
- Löscht das Portal ein Konto oder einen Kurs, ruft es auf allen betroffenen Plattformen `POST /api/verbund/loeschen` auf.
  Die Plattform MUSS das innerhalb der Anfrage erledigen.
- Jeder Kurs hat ein **Ablaufdatum** (Standard 31.07. des Schuljahres, höchstens 24 Monate im Voraus, verlängerbar).
  Danach löscht das Portal den Kurs und alle Schülerkonten ohne weiteren Kurs – mit Löschung auf allen betroffenen
  Plattformen. Schüler ohne Kurs werden auch bei manueller Kurslöschung bzw. beim Entfernen aus dem letzten Kurs gelöscht.

## §11 Übergang einer bestehenden Plattform

Eine Plattform, die schon eigene Konten hat (wie Algo Quest), geht in Phasen über:

| Phase | Plattform | Bemerkung |
|---|---|---|
| 0 | Manifest `/api/plattform`, Vertragsprüfung, `AUTH_MODUS=lokal` | Portal kann sie eintragen und anzeigen |
| 1 | SSO-Empfänger (`/sso/start`, `/sso/ende`), Verbund-API, `AUTH_MODUS=beides`, Link „⌂ Portal“ | Anleitung: `docs/INTEGRATION.md` |
| 2 | Datenübernahme ins Portal (Export → Import → Zuordnung), Plattform schreibt Lernstände auf `sub`/Kurs-ID um | gemeinsam mit dem Portal |
| 3 | `AUTH_MODUS=portal`: lokale Anmeldung und Registrierung aus, Superadmin vom Portal | nach erfolgreicher Übernahme |

**Export** (Plattform → Portal, Superadmin lädt die Datei im Portal hoch): entweder das Backup der Plattform
(Algo Quest: `{"app":"algoquest-lab","format":2,"tables":{…}}` – das Portal liest **nur** `lehrkraefte`, `kurse`,
`schueler`; Lernstände werden weder gelesen noch gespeichert) oder das Verbund-Exportformat:

```json
{ "format": "verbund-export", "version": 1, "quelle": "<plattform-id>",
  "lehrkraefte": [{ "altId": 2, "email": "…", "name": "…", "schule": "…", "pwHash": "scrypt$…", "rolle": "lehrkraft", "status": "aktiv" }],
  "kurse":       [{ "altId": 10, "lehrkraftAltId": 2, "name": "…", "code": "ABCDEF", "beitrittOffen": true }],
  "schueler":    [{ "altId": 100, "kursAltId": 10, "name": "…", "code": "ABC-234" }] }
```

**Zuordnung** (Portal → Plattform, Download im Portal):

```json
{ "format": "verbund-zuordnung", "version": 1, "quelle": "algoquest", "portal": "https://labs.frankjuchim.de", "erstellt": "…",
  "lehrkraefte": [{ "altId": 2, "sub": "l:5", "art": "neu" }],
  "kurse":       [{ "altId": 10, "kursId": "k:3", "kurscode": "ABCDEF", "art": "neu" }],
  "schueler":    [{ "altId": 100, "sub": "s:42", "art": "neu" }, { "altId": 102, "sub": "s:43", "art": "neuerCode", "neuerCode": "KMP-472" }] }
```

`art` ∈ `neu | vorhanden | zusammengefuehrt | superadmin | neuerKurscode | neuerCode`. Regeln:

- Passwort-Hashes (`scrypt$N$r$p$salt$hash`), Kurscodes und persönliche Codes werden **unverändert** übernommen –
  Lehrkräfte und Schüler melden sich danach mit denselben Zugangsdaten am Portal an.
- Kollidiert ein persönlicher Code (Altbestand vor Algo Quest 2.3), behält ihn das zuerst angelegte Konto; weitere
  erhalten einen neuen Code (`neuerCode`, für die Lehrkraft markiert). Ein im Portal schon vergebener Kurscode wird neu
  vergeben (`neuerKurscode`).
- Eine Lehrkraft, deren E-Mail im Portal schon existiert, wird zusammengeführt (Portal-Passwort bleibt).
  Kurse des Superadmins der Plattform gehören danach dem Portal-Superadmin.
- Jedes Schüler-Konto der Plattform wird ein eigenes Portal-Konto (auch wenn dieselbe Person in mehreren Kursen war).
- Der Import ist idempotent (erneuter Lauf legt nichts doppelt an) und hat einen Probelauf.

Stand der Plattformen: Algo Quest – Phase 0 umgesetzt (2.5.0). AutomatenLab – noch ohne Manifest (im Portal als
vorläufiger Eintrag: nur Link, kein SSO).

## §12 Vertragsprüfung

- `node scripts/vertrag_pruefen.js <Basis-URL>` prüft Manifest, Pflicht-URLs und `/healthz` einer laufenden Plattform.
  Maßgeblich ist die Fassung in diesem Repository; sie wird unverändert in jede Plattform kopiert. `pruefeManifest()`
  ist auch als Modul nutzbar.
- Jede Plattform führt die Manifest-Prüfung in ihren Tests aus; das Portal prüft beim Eintragen, auf Knopfdruck und
  alle 6 Stunden.
- Ab Phase 1 kommen SSO- und Verbund-API-Tests hinzu: Token mit falscher Signatur, falschem `aud`, falschem `iss`,
  abgelaufen, `exp − iat` zu groß, wiederverwendet, falscher `state` → abgelehnt; Verbund-API ohne Token, mit falschem
  `zweck` → 401; Löschung idempotent (Liste in `docs/INTEGRATION.md` §5).

## §13 Empfohlenes Vorgehen

1. **Portal zuerst** – Konten, Kurse, Freischaltungen und SSO stehen (InfoLabs); neue Plattformen entwickeln kein
   eigenes Login mehr, sondern starten direkt mit `AUTH_MODUS=portal` bzw. `beides`.
2. **Neue Plattformen** starten als Kopie von Algo Quest (AlgoQuest-README Teil G), setzen sofort Manifest und SSO
   nach `docs/INTEGRATION.md` um und verweisen in README und CLAUDE.md auf diesen Vertrag.
3. **Gemeinsamer Kern:** Sicherheit, Sitzungen, SSO-Client, Prüfer, Renderer, Interaktionen und Aufgabenansicht sind
   auf allen Plattformen gleich. Spätestens mit der zweiten Plattform SOLL dieser Kern in ein eigenes Repository
   (z. B. `lab-kern`, als Git-Abhängigkeit) ausgelagert werden – sonst laufen mehrere Kopien auseinander.
4. **Vertrag zuerst ändern, dann bauen:** Braucht eine Plattform etwas Neues im Zusammenspiel, wird zuerst dieser
   Vertrag angepasst (Version, §14), dann implementiert.

**Startprompt für eine neue Plattform (Vorlage):**

```
Wir bauen <Name>, eine Plattform des Verbunds InfoLabs für <Themenfeld> (Informatik Oberstufe, Niedersachsen).
Verbindlich ist der Vertrag https://github.com/frankjuchim/labs/blob/main/VERTRAG.md (Version 1.1); die
Anschlussanleitung steht in docs/INTEGRATION.md desselben Repos. Muster für Aufbau, Stil und Qualitätssicherung ist
frankjuchim/AlgoQuest (README Teil G, CLAUDE.md). Anmeldung nur über das Portal (AUTH_MODUS=portal, SSO nach §5),
Manifest nach §7, Verbund-API nach §6. Lies zuerst den Vertrag, dann schlage einen Plan vor.
```

## §14 Änderungen am Vertrag

| Version | Datum | Änderung |
|---|---|---|
| 1.0 | 2026-10 | erste Fassung (AlgoQuest-README Teil H): Portal + Plattformen, zentrale Konten (auch Schüler), SSO mit Ed25519-JWT, Verbund-API, Manifest, Konfiguration, gemeinsame Regeln, Übergang Algo Quest |
| 1.1 | 2026-10 | Umzug in das Portal-Repo `frankjuchim/labs` (`VERTRAG.md`); Portal-Adresse festgelegt; `state`-Format, Fehlerseite statt Weiterleitung; `kid` und mehrere öffentliche Schlüssel (Schlüsselwechsel); feste Schlüssel-URLs; Kurse im Token für Superadmin und Mitlehrkräfte; Abmelde-Rücksprung nur zu eingetragenen Plattformen; feste `zweck`-Werte; Format der Kursübersicht; Aufträge nur an `beides`/`portal`; `urls.ssoEnde`; Kurs-Ablaufdatum; Export-/Zuordnungsformat der Datenübernahme (§11 allgemein) |

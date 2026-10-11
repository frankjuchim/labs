# Vorschläge zum Verbund-Vertrag (README Teil H) – Version 1.1

Beim Bau des Portals sind Stellen aufgefallen, die der Vertrag v1.0 offenlässt. Das Portal setzt sie **schon so um,
dass Plattformen nach v1.0 weiter funktionieren** (alle Punkte sind Ergänzungen = Nebenversion). Bitte prüfen; nach
Freigabe werden die Texte unten in README Teil H des AlgoQuest-Repos übernommen.

## Übersicht

| Nr. | Abschnitt | Ergänzung | Warum |
|---|---|---|---|
| 1 | H.5 | `state`: mind. 22 Zeichen aus `A–Z a–z 0–9 - _ . ~`; ungültiges `ziel` → `/`; Fehlerseite statt Weiterleitung bei unbekannter Plattform/Rücksprung | „≥ 128 bit“ prüfbar machen; kein offener Redirect |
| 2 | H.5 | Token-Kopf darf `kid` enthalten; `PORTAL_PUBLIC_KEY` darf mehrere PEM-Blöcke enthalten | Schlüsselwechsel ohne Ausfall |
| 3 | H.5 | Superadmin-Token: `kurse` = alle Kurse mit dieser Plattform (`rolle: "lehrkraft"`); Mitlehrkräfte erhalten ihre Kurse mit `rolle: "lehrkraft"` | bisher offen |
| 4 | H.5 | Öffentlicher Schlüssel fest unter `<PORTAL_URL>/sso/schluessel.pem` und `/api/portal/schluessel` | „feste URL“ benennen |
| 5 | H.5 | `/sso/abmelden`: Rücksprung nur auf den Ursprung einer eingetragenen Plattform, sonst Portal-Startseite | offener Redirect |
| 6 | H.6 | feste `zweck`-Werte: `loeschen`, `kurs-uebersicht`, `kurs-aendern` | „Name des Endpunkts“ war mehrdeutig |
| 7 | H.6 | Antwortformat der Kursübersicht | Portal und Plattformen müssen dasselbe lesen |
| 8 | H.6 | Aufträge nur an Plattformen mit `auth.modus` ∈ {`beides`, `portal`}; Wiederholung bis ca. 6 Tage | Plattformen im Modus `lokal` kennen keine Portal-IDs |
| 9 | H.7 | optionales Feld `urls.ssoEnde` | Vorschlag für die Rücksprung-Whitelist |
| 10 | H.10 | Kurse haben ein Ablaufdatum; danach löscht das Portal (inkl. H.6) | Speicherdauer festlegen |
| 11 | H.11 | Export- und Zuordnungsformat der Datenübernahme | Phase 2 eindeutig machen |
| 12 | Kopf | Umzug des Vertrags ins Portal-Repo | siehe unten |

---

## Textvorschlag (zum Einfügen in README Teil H)

**Kopf:** `Status: Vertrag **v1.1** …`

**H.5, nach „Die Plattform MUSS prüfen …“ ergänzen:**

> - `state` besteht aus mindestens 22 Zeichen aus `A–Z a–z 0–9 - _ . ~` (z. B. 16 Byte Zufall, base64url). Das Portal
>   lehnt kürzere Werte ab. Ein `ziel`, das nicht mit genau einem `/` beginnt, ersetzt das Portal durch `/`.
> - Bei unbekannter oder abgeschalteter Plattform bzw. nicht freigegebener Rücksprung-Adresse leitet das Portal **nicht**
>   weiter, sondern zeigt eine Fehlerseite.
> - Der Token-Kopf DARF `kid` (Kennung des Portal-Schlüssels) enthalten. `PORTAL_PUBLIC_KEY` DARF mehrere PEM-Blöcke
>   enthalten; ein Token ist gültig, wenn ein Schlüssel passt (Schlüsselwechsel: neuen Schlüssel zuerst auf allen
>   Plattformen ergänzen, dann im Portal tauschen, alten nach einem Tag entfernen).
> - Der öffentliche Schlüssel ist abrufbar unter `<PORTAL_URL>/sso/schluessel.pem` (PEM) und
>   `<PORTAL_URL>/api/portal/schluessel` (`{alg, crv, kid, iss, pem}`); Plattformen konfigurieren ihn trotzdem fest.
> - `kurse` bei `rolle: "superadmin"`: alle Kurse, die diese Plattform nutzen, jeweils `rolle: "lehrkraft"`.
>   Mitlehrkräfte eines Kurses erhalten ihn wie die Inhaberin mit `rolle: "lehrkraft"`.
> - `/sso/abmelden` leitet nur auf Adressen zurück, deren Ursprung die Basis einer eingetragenen Plattform ist.

**H.6, Tabelle ersetzen bzw. ergänzen:**

> `zweck` ist `loeschen` (POST `/api/verbund/loeschen`), `kurs-uebersicht` (GET `/api/verbund/kurse/:kursId/uebersicht`)
> bzw. `kurs-aendern` (POST `/api/verbund/kurse/:kursId`). `:kursId` ist URL-kodiert (`k%3A17`).
>
> Antwort der Kursübersicht:
> `{ "kurs": "k:17", "stand": "<ISO-Zeit>", "schueler": [{ "sub", "punkte", "geloest", "anteil" (0…1), "zuletzt" }],
> "welten": [{ "nr", "titel", "anteil" (0…1) }] }` – unbekannter Kurs: 404.
>
> Das Portal sendet Aufträge nur an Plattformen, deren Manifest `auth.modus` = `beides` oder `portal` meldet, und
> wiederholt fehlgeschlagene Aufträge (1, 5, 30, 120 Minuten … insgesamt etwa 6 Tage).

**H.7, Liste der Felder ergänzen:**

> `urls.ssoEnde` (KANN, ab v1.1): Pfad des SSO-Rücksprungs; das Portal schlägt `basis + urls.ssoEnde` als
> Rücksprung-Adresse vor (der Superadmin bestätigt sie).

**H.10 ergänzen:**

> - Jeder Kurs hat ein Ablaufdatum (Standard 31.07. des Schuljahres, höchstens 24 Monate im Voraus, verlängerbar).
>   Danach löscht das Portal den Kurs und alle Schülerkonten ohne weiteren Kurs – mit `POST /api/verbund/loeschen` auf
>   allen betroffenen Plattformen. Schüler ohne Kurs werden auch bei manueller Kurslöschung gelöscht.

**H.11, Phase 2 präzisieren:**

> Export (Plattform → Portal): entweder das Backup der Plattform (Algo Quest: Format 2, das Portal liest nur
> `lehrkraefte`, `kurse`, `schueler`) oder das Verbund-Exportformat
> `{ "format": "verbund-export", "version": 1, "quelle": "<plattform-id>", "lehrkraefte": [{ altId, email, name, schule,
> pwHash, rolle, status }], "kurse": [{ altId, lehrkraftAltId, name, code, beitrittOffen }], "schueler": [{ altId,
> kursAltId, name, code }] }`.
> Zuordnung (Portal → Plattform): `{ "format": "verbund-zuordnung", "version": 1, "quelle", "portal", "erstellt",
> "lehrkraefte": [{ altId, sub, art }], "kurse": [{ altId, kursId, kurscode, art }], "schueler": [{ altId, sub, art,
> neuerCode? }] }`. `art` ∈ `neu | vorhanden | zusammengefuehrt | superadmin | neuerKurscode | neuerCode`.
> Der Import ist idempotent. Kollidiert ein persönlicher Code (Altbestand vor Algo Quest 2.3), behält ihn das zuerst
> angelegte Konto; weitere erhalten einen neuen Code (Liste für die Lehrkraft). Kurse des Algo-Quest-Superadmins gehören
> danach dem Portal-Superadmin. Eine Lehrkraft, deren E-Mail im Portal schon existiert, wird zusammengeführt (Portal-
> Passwort bleibt).

**H.14 ergänzen:**

> | 1.1 | 2026-10 | Ergänzungen aus dem Bau des Portals: state-Format, `kid`/Schlüsselwechsel, Schlüssel-URL, Superadmin- und Mitlehrkraft-Kurse im Token, Abmelde-Rücksprung, `zweck`-Werte, Format der Kursübersicht, `urls.ssoEnde`, Kurs-Ablauf, Export-/Zuordnungsformat; Vertrag zieht ins Portal-Repo (`frankjuchim/labs`, `VERTRAG.md`) |

---

## Umzug des Vertrags ins Portal-Repo

**Wann:** sobald (1) das Portal live ist und (2) Algo Quest Phase 1 (SSO, `AUTH_MODUS=beides`) umgesetzt hat – dann
gibt es zwei echte Parteien, und der Vertrag beschreibt gelebte Praxis. Spätestens bevor eine zweite Plattform
(AutomatenLab) mit dem Anschluss beginnt.

**Wie (ein Schritt, zwei Commits):**

1. Portal-Repo: `VERTRAG.md` = README Teil H v1.1 (H.1–H.10, H.12–H.14), dazu `scripts/vertrag_pruefen.js` als
   maßgebliche Fassung und `src/jwt.js` als empfohlener Baustein. H.11 (Übergang Algo Quest) wird zu einem allgemeinen
   Abschnitt „Übergang einer bestehenden Plattform“; der Algo-Quest-Stand wandert in dessen README.
2. AlgoQuest-README Teil H wird auf einen kurzen Verweis gekürzt („Maßgeblich: `frankjuchim/labs/VERTRAG.md`, Version
   1.1“) plus Algo-Quest-spezifischer Stand (Phasen-Tabelle). CLAUDE.md beider Repos verweisen auf `VERTRAG.md`.
3. Ab dann: Änderungen nur im Portal-Repo, mit Versionsnummer und Eintrag in der Änderungstabelle; Plattformen
   kopieren `vertrag_pruefen.js` und `jwt.js` unverändert (Test vergleicht die Hauptversion).

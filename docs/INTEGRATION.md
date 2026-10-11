# Eine Plattform an InfoLabs anschließen (Phase 1 nach Vertrag H.11)

Diese Anleitung beschreibt Schritt für Schritt, was eine Plattform des Verbunds (z. B. Algo Quest) tun muss, damit
sich Lehrkräfte und Schüler über das Portal **https://labs.frankjuchim.de** anmelden und das Portal Löschungen und
Kursänderungen weitergeben kann. Verbindlich ist der Vertrag (README Teil H in `frankjuchim/AlgoQuest`); diese Datei
setzt ihn um und nennt die Werte des Portals. Eine lauffähige Referenz ist die **Test-Plattform**
`test/testplattform/app.js` (rund 250 Zeilen) – jede Prüfung dort muss auch die echte Plattform machen.

> Reihenfolge: Manifest (gibt es schon) → Konfiguration → SSO-Empfänger → Verbund-API → Tests → im Portal eintragen →
> `AUTH_MODUS=beides`. Erst nach der Datenübernahme (Phase 2) folgt `AUTH_MODUS=portal`.

---

## 1. Konfiguration (H.8)

| Variable | Wert für den Verbund |
|---|---|
| `PLATTFORM_ID` | z. B. `algoquest` (= Subdomain, ändert sich nie) |
| `PLATTFORM_URL` | z. B. `https://algoquest.frankjuchim.de` |
| `PORTAL_URL` | `https://labs.frankjuchim.de` (ohne Schrägstrich am Ende; = erwartetes `iss`) |
| `PORTAL_PUBLIC_KEY` | öffentlicher Ed25519-Schlüssel (PEM). Abrufbar unter `https://labs.frankjuchim.de/sso/schluessel.pem` und im Portal unter *Plattformen → Öffentlicher Schlüssel* („Einzeilig kopieren“ für CapRover, `\n` statt Zeilenumbrüchen – beim Einlesen `.replace(/\\n/g, '\n')`) |
| `AUTH_MODUS` | `beides` (Übergang: lokale Anmeldung **und** Portal) |

Den Schlüssel **nicht** zur Laufzeit vom Portal holen, sondern fest konfigurieren – sonst könnte ein Angreifer, der
DNS oder das Portal stört, einen eigenen Schlüssel unterschieben.

## 2. Manifest ergänzen (H.7)

```js
urls: { …, ssoStart: '/sso/start', ssoEnde: '/sso/ende' },   // ssoEnde: Vorschlag v1.1, siehe VERTRAG_VORSCHLAEGE.md
auth: { modus: 'beides', portal: process.env.PORTAL_URL, sso: true }
```

Das Portal zeigt `basis + urls.ssoStart` als Link „Weiter zu …“ für Schüler; `urls.ssoEnde` schlägt es dem Superadmin
als Rücksprung-Adresse vor.

## 3. SSO-Empfänger (H.5)

Den Baustein `src/jwt.js` aus diesem Repository **unverändert kopieren** (nur `node:crypto`): `pruefe(token, publicKey,
{ iss, aud, maxDauerSek })` prüft Aufbau, `alg = EdDSA`, Signatur, `v = 1`, `iss`, `aud`, `iat`/`exp`
(`exp − iat ≤ maxDauerSek`, abgelaufen) und das Format von `jti`; `JtiSpeicher` merkt verwendete `jti` bis zum Ablauf.

### 3.1 `GET /sso/start?ziel=<pfad>`

1. `state` = 16 Byte Zufall, base64url (22 Zeichen). Das Portal verlangt **mindestens 22 Zeichen** aus `A–Z a–z 0–9 - _ . ~`.
2. Cookie setzen: `aq_sso_state=<state>` – `httpOnly`, `SameSite=Lax`, `secure`, `Max-Age=600`, signiert.
3. `ziel` nur übernehmen, wenn es mit genau einem `/` beginnt (kein `//`, kein `\`), sonst `/`.
4. Weiterleiten (302) auf
   `PORTAL_URL/sso/autorisieren?plattform=<id>&ruecksprung=<PLATTFORM_URL>/sso/ende&state=<state>&ziel=<ziel>`.
   `ruecksprung` muss **zeichengenau** der im Portal hinterlegten Adresse entsprechen.

Wird eine geschützte Seite ohne Sitzung aufgerufen (oder ist die Sitzung abgelaufen), leitet die Plattform still auf
`/sso/start?ziel=<aktueller Pfad>`.

### 3.2 `GET /sso/ende?token=…&state=…&ziel=…` bzw. `?fehler=…&state=…`

Antwort immer mit `Referrer-Policy: no-referrer` und `Cache-Control: no-store`; das Token **nie loggen**
(auch nicht in Zugriffsprotokollen – ggf. Query-String im Log abschneiden).

1. State-Cookie lesen und **sofort löschen**; fehlt er oder ist `state ≠ Cookie` → ablehnen (401, Fehlerseite).
2. `fehler=keine_berechtigung` → Seite „Kein Zugang – deine Lehrkraft hat diese Plattform für deinen Kurs nicht
   freigeschaltet“; `fehler=abgebrochen` → zurück zur Startseite (Gastmodus anbieten).
3. `pruefe(token, PORTAL_PUBLIC_KEY, { iss: PORTAL_URL, aud: PLATTFORM_ID, maxDauerSek: 120 })`; bei `ok: false` → 401.
4. `jti` merken (`JtiSpeicher.merke(jti, exp)`); schon bekannt → 401 („wiederverwendet“).
5. Inhalt prüfen: `sub` passt zu `^[asl]:\d+$`, `rolle ∈ {schueler, lehrkraft, superadmin}`, `kurse` ist eine Liste.
6. **Upsert nach `sub`**: Anzeigename aktualisieren; Kurse aus `kurse` anlegen bzw. umbenennen (unbekannte Kurse mit
   Standard-Einstellungen); Mitgliedschaften abgleichen – fehlt ein Kurs im Token, verliert das Konto den Zugang
   dazu (Lernstand bleibt bis zur Löschung).
7. Eigene Sitzung setzen (Schüler ≤ 30 Tage, Lehrkräfte ≤ 8 h), dann 302 auf `ziel` (nur relative Pfade).

Inhalt eines Tokens (Beispiel, `exp − iat = 90 s`):

```json
{ "iss": "https://labs.frankjuchim.de", "aud": "algoquest", "sub": "s:1042", "rolle": "schueler", "name": "Lena S.",
  "kurse": [{ "id": "k:17", "name": "LK Informatik 13", "rolle": "mitglied" }],
  "iat": 1760000000, "exp": 1760000090, "jti": "9f2c…", "v": 1 }
```

- Lehrkraft: `rolle: "lehrkraft"`, `kurse[].rolle: "lehrkraft"` (eigene Kurse **und** Kurse als Mitlehrkraft, jeweils
  nur Kurse, die diese Plattform nutzen). Eine Lehrkraft ohne Freischaltung bekommt kein Token (`keine_berechtigung`).
- Superadmin: `rolle: "superadmin"`, `sub: "a:<n>"`, `kurse` = alle Kurse mit dieser Plattform (`rolle: "lehrkraft"`).
- Schüler ohne Kurs auf dieser Plattform: kein Token (`keine_berechtigung`).

### 3.3 Abmelden

Knopf „Abmelden“ beendet nur die Plattform-Sitzung. Knopf „Überall abmelden“: Sitzung beenden und weiterleiten auf
`PORTAL_URL/sso/abmelden?ruecksprung=<PLATTFORM_URL>/` (das Portal leitet nur auf eingetragene Plattformen zurück).
In der Kopfzeile ein Link **„⌂ Portal“** auf `PORTAL_URL` (H.9).

## 4. Verbund-API (H.6)

Jede Anfrage trägt `Authorization: Bearer <JWT>` mit `iss = PORTAL_URL`, `aud = PLATTFORM_ID`, `sub = "portal"`,
`exp − iat ≤ 60 s` (das Portal stellt 60 s aus), einmaligem `jti` und `zweck`:

| Endpunkt | `zweck` | Antwort |
|---|---|---|
| `POST /api/verbund/loeschen` `{ "sub": "s:1042" }` oder `{ "kurs": "k:17" }` | `loeschen` | `{ "geloescht": n }` – idempotent, innerhalb der Anfrage erledigt |
| `GET /api/verbund/kurse/:kursId/uebersicht` (`kursId` URL-kodiert, `k%3A17`) | `kurs-uebersicht` | siehe unten; unbekannter Kurs → 404 |
| `POST /api/verbund/kurse/:kursId` `{ "name"?: "…", "aktiv"?: false }` | `kurs-aendern` | `{ "ok": true }`; `aktiv: false` → Kurs sperren, `true` → entsperren |

Prüfung: `pruefe(token, PORTAL_PUBLIC_KEY, { iss: PORTAL_URL, aud: PLATTFORM_ID, maxDauerSek: 60 })`, dann
`sub === 'portal'`, `zweck` passt zum Endpunkt, `jti` einmalig (eigener `JtiSpeicher`). Sonst **401** ohne Details.
Diese Endpunkte brauchen **keine** Origin-Prüfung (kein Browser beteiligt), aber JSON und ein Rate-Limit.

Kursübersicht (Format, Vorschlag v1.1) – **keine** Antworten, Lösungen oder Freitexte:

```json
{ "kurs": "k:17", "stand": "2026-10-11T10:00:00Z",
  "schueler": [{ "sub": "s:1042", "punkte": 120, "geloest": 14, "anteil": 0.31, "zuletzt": "2026-10-10T09:12:00Z" }],
  "welten":   [{ "nr": 0, "titel": "Die Akademie", "anteil": 0.55 }] }
```

`anteil` ist der Anteil an den Level-Punkten der freigeschalteten Welten (0…1, wie die Rangschwellen in H.9).
Das Portal zeigt nur `sub`s, die Mitglied des Kurses sind, und ergänzt die Namen selbst.

Das Portal sendet Aufträge nur an Plattformen, deren Manifest `auth.modus` = `beides` oder `portal` meldet; bei
Fehlern (Netz, 5xx, 401) wiederholt es nach 1, 5, 30 Minuten … bis etwa 6 Tage.

## 5. Testfälle (H.12) – müssen in den Tests der Plattform stehen

| Fall | Erwartung |
|---|---|
| gültiges Token, richtiger state | 302 auf `ziel`, Sitzung gesetzt, Konto nach `sub` angelegt, Kurse übernommen |
| **falsche Signatur** (mit anderem Ed25519-Schlüssel signiert) | 401 |
| **falsches `aud`** (Token für eine andere Plattform) | 401 |
| **abgelaufen** (`exp` in der Vergangenheit) | 401 |
| `exp − iat > 120 s` | 401 |
| falsches `iss` | 401 |
| **wiederverwendet** (gleiches Token ein zweites Mal) | 401 |
| state fehlt oder ≠ Cookie | 401 |
| `fehler=keine_berechtigung` / `abgebrochen` | verständliche Seite, keine Sitzung |
| `ziel=//boese.example` | Weiterleitung auf `/` |
| Verbund-API: ohne Token, falsches `aud`, falscher `zweck`, `exp − iat > 60 s`, wiederverwendet | 401 |
| `loeschen` zweimal mit derselben `sub` | beide 200, zweites Mal `geloescht: 0` |

Vorlage für Tokens in Tests: `signiere(nutzlast, privateKey)` aus `src/jwt.js` mit einem Testschlüssel
(`crypto.generateKeyPairSync('ed25519')`) – siehe `test/sso.test.js` und `test/verbund.test.js` in diesem Repository.

## 6. Im Portal eintragen und Ende-zu-Ende prüfen

1. Portal → *Plattformen* → Basis-URL eintragen. Das Portal prüft das Manifest (`scripts/vertrag_pruefen.js`) und
   `/healthz`; die Ampel muss grün sein.
2. Rücksprung-Adresse bestätigen (Vorschlag aus `urls.ssoEnde` bzw. `/sso/ende`).
3. *Lehrkräfte* → Plattform für die Lehrkräfte freischalten; Kurs anlegen und die Plattform wählen.
4. Als Schüler beitreten und auf „Weiter zu …“ tippen → man landet angemeldet auf der Plattform.
5. Kurs im Portal umbenennen → Name auf der Plattform geändert (*Verbund-Aufträge*: „erledigt“).

Lokal üben: `npm run dev` (Portal auf Port 3100) und `PORTAL_URL=http://localhost:3100 npm run testplattform`
(Testlabor auf Port 4100); im Portal `http://localhost:4100` eintragen.

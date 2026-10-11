'use strict';
// Datenbank (SQLite über better-sqlite3). Schema-Änderungen nur als neue Migration am Ende von MIGRATIONEN.

const Database = require('better-sqlite3');

const APP_KENNUNG = 'infolabs-portal';

/**
 * Migrationen: Index + 1 = Schema-Version. Nie bestehende Einträge ändern, nur neue anhängen.
 * IDs mit AUTOINCREMENT, damit `sub` (l:<n>, s:<n>, a:<n>) und Kurs-IDs (k:<n>) nie neu vergeben werden (Vertrag §2).
 */
const MIGRATIONEN = [
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Lehrkräfte und Superadmin (Superadmin aus ADMIN_EMAIL/ADMIN_PASSWORD, sub a:<id>; Lehrkräfte sub l:<id>)
  CREATE TABLE lehrkraefte (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name            TEXT NOT NULL,
    schule          TEXT NOT NULL DEFAULT '',
    nachricht       TEXT NOT NULL DEFAULT '',
    pw_hash         TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'lehrkraft' CHECK (rolle IN ('lehrkraft', 'superadmin')),
    status          TEXT NOT NULL DEFAULT 'wartet' CHECK (status IN ('wartet', 'aktiv', 'abgelehnt', 'deaktiviert')),
    muss_pw_aendern INTEGER NOT NULL DEFAULT 0,
    session_gen     INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    entschieden_at  TEXT,
    last_login_at   TEXT,
    alt_quelle      TEXT,
    alt_id          INTEGER
  );
  CREATE UNIQUE INDEX idx_lk_alt ON lehrkraefte(alt_quelle, alt_id) WHERE alt_quelle IS NOT NULL;

  -- Schüler: NUR selbst gewählter Name + persönlicher Code (kursübergreifend eindeutig), sub s:<id>
  CREATE TABLE schueler (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    name_key       TEXT NOT NULL,
    code           TEXT NOT NULL UNIQUE,
    session_gen    INTEGER NOT NULL DEFAULT 1,
    code_neu       INTEGER NOT NULL DEFAULT 0,   -- 1 = Code wurde beim Import neu vergeben (Hinweis an die Lehrkraft)
    created_at     TEXT NOT NULL,
    last_active_at TEXT,
    alt_quelle     TEXT,
    alt_id         INTEGER
  );
  CREATE UNIQUE INDEX idx_s_alt ON schueler(alt_quelle, alt_id) WHERE alt_quelle IS NOT NULL;

  -- Kurse (Kurs-ID k:<id>); Inhaberin = Lehrkraft, die den Kurs angelegt hat
  CREATE TABLE kurse (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    code           TEXT NOT NULL UNIQUE,
    inhaber_id     INTEGER NOT NULL REFERENCES lehrkraefte(id),
    beitritt_offen INTEGER NOT NULL DEFAULT 1,
    ablauf         TEXT NOT NULL,              -- JJJJ-MM-TT: danach wird der Kurs gelöscht
    created_at     TEXT NOT NULL,
    alt_quelle     TEXT,
    alt_id         INTEGER
  );
  CREATE UNIQUE INDEX idx_k_alt ON kurse(alt_quelle, alt_id) WHERE alt_quelle IS NOT NULL;

  -- Mitlehrkräfte (die Inhaberin steht nur in kurse.inhaber_id)
  CREATE TABLE kurs_lehrkraefte (
    kurs_id      INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
    lehrkraft_id INTEGER NOT NULL REFERENCES lehrkraefte(id) ON DELETE CASCADE,
    seit         TEXT NOT NULL,
    PRIMARY KEY (kurs_id, lehrkraft_id)
  );

  -- Einladungen als Mitlehrkraft (an eine E-Mail-Adresse; angenommen von der angemeldeten Lehrkraft mit dieser Adresse)
  CREATE TABLE kurs_einladungen (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kurs_id    INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
    email      TEXT NOT NULL COLLATE NOCASE,
    von_id     INTEGER REFERENCES lehrkraefte(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    UNIQUE (kurs_id, email)
  );

  CREATE TABLE kurs_mitglieder (
    kurs_id     INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
    schueler_id INTEGER NOT NULL REFERENCES schueler(id) ON DELETE CASCADE,
    seit        TEXT NOT NULL,
    PRIMARY KEY (kurs_id, schueler_id)
  );
  CREATE INDEX idx_km_s ON kurs_mitglieder(schueler_id);

  -- Plattformen des Verbunds (id = Plattform-ID aus dem Manifest bzw. bei vorläufigen Einträgen von Hand)
  CREATE TABLE plattformen (
    id           TEXT PRIMARY KEY,
    basis        TEXT NOT NULL UNIQUE,
    vorlaeufig   INTEGER NOT NULL DEFAULT 0,  -- 1 = ohne (gültiges) Manifest, nur Link, kein SSO
    aktiv        INTEGER NOT NULL DEFAULT 1,  -- 0 = vom Superadmin abgeschaltet (kein SSO, nicht öffentlich)
    reihenfolge  INTEGER NOT NULL DEFAULT 100,
    ruecksprung  TEXT,                        -- exakte SSO-Rücksprung-Adresse (Whitelist, §5)
    angaben      TEXT NOT NULL,               -- JSON: Anzeige-Angaben (aus dem Manifest oder von Hand)
    manifest     TEXT,                        -- JSON: zuletzt gültiges Manifest
    pruefung     TEXT,                        -- JSON: { ok, fehler[], warnungen[], healthz, at }
    created_at   TEXT NOT NULL,
    geprueft_at  TEXT
  );

  -- Freischaltung Lehrkraft × Plattform (durch den Superadmin)
  CREATE TABLE lehrkraft_plattformen (
    lehrkraft_id INTEGER NOT NULL REFERENCES lehrkraefte(id) ON DELETE CASCADE,
    plattform_id TEXT NOT NULL REFERENCES plattformen(id) ON DELETE CASCADE,
    seit         TEXT NOT NULL,
    PRIMARY KEY (lehrkraft_id, plattform_id)
  );

  -- Plattformen eines Kurses; aktiv = 0 heißt: abgeschaltet (Kurs bleibt auf der Plattform bekannt, §6)
  CREATE TABLE kurs_plattformen (
    kurs_id      INTEGER NOT NULL REFERENCES kurse(id) ON DELETE CASCADE,
    plattform_id TEXT NOT NULL REFERENCES plattformen(id) ON DELETE CASCADE,
    aktiv        INTEGER NOT NULL DEFAULT 1,
    seit         TEXT NOT NULL,
    PRIMARY KEY (kurs_id, plattform_id)
  );

  -- Wer war schon auf welcher Plattform (für Löschungen und Kennzahlen); sub wie im Token
  CREATE TABLE sso_nutzung (
    sub          TEXT NOT NULL,
    plattform_id TEXT NOT NULL,
    erste        TEXT NOT NULL,
    letzte       TEXT NOT NULL,
    anzahl       INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (sub, plattform_id)
  );

  -- Aufträge an Plattformen (Verbund-API, §6) mit Wiederholung bei Ausfall
  CREATE TABLE verbund_auftraege (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    plattform_id      TEXT NOT NULL,
    zweck             TEXT NOT NULL,
    methode           TEXT NOT NULL,
    pfad              TEXT NOT NULL,
    nutzlast          TEXT,
    status            TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'erledigt', 'fehlgeschlagen')),
    versuche          INTEGER NOT NULL DEFAULT 0,
    naechster_versuch TEXT NOT NULL,
    letzter_fehler    TEXT,
    antwort           TEXT,
    created_at        TEXT NOT NULL,
    erledigt_at       TEXT
  );
  CREATE INDEX idx_va_offen ON verbund_auftraege(status, naechster_versuch);

  -- Datenübernahmen (§11): Bericht + Zuordnung alt → neu
  CREATE TABLE importe (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    quelle     TEXT NOT NULL,
    bericht    TEXT NOT NULL,
    zuordnung  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `
];

const SCHEMA_VERSION = MIGRATIONEN.length;

function getMeta(db, key) {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return r ? r.value : null;
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

function openDatabase(file, { log = () => {} } = {}) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const hatMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  let version = hatMeta ? Number(getMeta(db, 'schema_version') || 0) : 0;
  if (hatMeta && getMeta(db, 'app') && getMeta(db, 'app') !== APP_KENNUNG) throw new Error('Die Datenbank gehört nicht zum Portal.');
  if (version > SCHEMA_VERSION) throw new Error(`Datenbank-Schema ${version} ist neuer als diese Version (${SCHEMA_VERSION}).`);
  while (version < SCHEMA_VERSION) {
    const sql = MIGRATIONEN[version];
    db.transaction(() => {
      db.exec(sql);
      setMeta(db, 'schema_version', version + 1);
      setMeta(db, 'app', APP_KENNUNG);
    })();
    version += 1;
    log(`Datenbank: Migration ${version} ausgeführt.`);
  }
  return db;
}

module.exports = { openDatabase, getMeta, setMeta, SCHEMA_VERSION, APP_KENNUNG };

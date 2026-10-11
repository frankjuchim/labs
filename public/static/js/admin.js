/* InfoLabs – Superadmin-Bereiche: Lehrkräfte, Plattformen (inkl. Schlüssel), Verbund-Aufträge, Datenübernahme */
'use strict';

IL.admin = (() => {
  const { h, zeige, api, meldung, fehler, dialog, kopieren, zeit, beimAbsenden } = IL;

  const STATUS = { wartet: ['Wartet', 'gold'], aktiv: ['Aktiv', 'gruen'], abgelehnt: ['Abgelehnt', 'grau'], deaktiviert: ['Deaktiviert', 'rot'] };

  /* ---------- Lehrkräfte ---------- */

  async function lehrkraefte(ziel, { neuLaden }) {
    const [{ lehrkraefte: liste }, { plattformen }] = await Promise.all([api('GET', '/api/admin/lehrkraefte'), api('GET', '/api/admin/plattformen')]);
    const waehlbar = plattformen.filter((p) => !p.vorlaeufig);
    const neu = () => neuLaden();

    function aktionen(l) {
      if (l.rolle === 'superadmin') return h('span', { class: 'leise klein' }, 'Superadmin');
      const k = [];
      const status = (s, text, art = '') => k.push(h('button', { type: 'button', class: 'knopf klein ' + art, onclick: () => api('POST', `/api/admin/lehrkraefte/${l.id}/status`, { status: s }).then(neu, fehler) }, text));
      if (l.status === 'wartet') {
        status('aktiv', 'Freigeben', 'gruen');
        status('abgelehnt', 'Ablehnen', 'hell');
      } else if (l.status === 'aktiv') status('deaktiviert', 'Deaktivieren', 'hell');
      else status('aktiv', 'Aktivieren', 'hell');
      k.push(
        h(
          'button',
          {
            type: 'button',
            class: 'knopf klein hell',
            onclick: async () => {
              if (!(await dialog({ titel: `Einmal-Passwort für ${l.name}?`, text: 'Das bisherige Passwort gilt danach nicht mehr. Das neue wird nur einmal angezeigt.', ok: 'Erzeugen' }))) return;
              const r = await api('POST', `/api/admin/lehrkraefte/${l.id}/einmalpasswort`).catch(fehler);
              if (r) await dialog({ titel: 'Einmal-Passwort', text: `${r.passwort} – bitte sicher übermitteln; es muss bei der nächsten Anmeldung geändert werden.`, ok: 'Notiert', abbrechen: 'Schließen' });
            }
          },
          'Einmal-Passwort'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'knopf klein rot',
            onclick: async () => {
              const b = await dialog({ titel: `${l.name} löschen?`, text: `Löscht das Konto, alle eigenen Kurse (${l.kurse}) und Schülerkonten ohne weiteren Kurs – auch auf den Plattformen. Zur Bestätigung die E-Mail eingeben.`, eingabe: 'E-Mail', ok: 'Endgültig löschen', gefahr: true });
              if (b === null) return;
              if (b.trim().toLowerCase() !== l.email) return meldung('E-Mail stimmt nicht – nichts gelöscht.', 'fehler');
              const r = await api('DELETE', `/api/admin/lehrkraefte/${l.id}`).catch(fehler);
              if (r) {
                meldung(`Gelöscht: ${r.kurse} Kurs(e), ${r.schueler} Schülerkonto/-konten.`, 'gut');
                neu();
              }
            }
          },
          'Löschen'
        )
      );
      return h('div', { class: 'zeile' }, k);
    }

    function freischaltung(l) {
      if (l.rolle === 'superadmin') return h('span', { class: 'leise klein' }, 'alle');
      if (!waehlbar.length) return h('span', { class: 'leise klein' }, '–');
      return h(
        'div',
        null,
        waehlbar.map((p) =>
          h(
            'label',
            { class: 'haken' },
            h('input', {
              type: 'checkbox',
              checked: l.plattformen.includes(p.id),
              onchange: async (e) => {
                const auswahl = new Set(l.plattformen);
                e.target.checked ? auswahl.add(p.id) : auswahl.delete(p.id);
                try {
                  const r = await api('PUT', `/api/admin/lehrkraefte/${l.id}/plattformen`, { plattformen: [...auswahl] });
                  l.plattformen = r.plattformen;
                  meldung(`${p.name}: ${e.target.checked ? 'freigeschaltet' : 'Freischaltung entfernt'}.`, 'gut');
                } catch (err) {
                  e.target.checked = !e.target.checked;
                  fehler(err);
                }
              }
            }),
            p.name
          )
        )
      );
    }

    zeige(
      ziel,
      h('h1', null, 'Lehrkräfte'),
      h('p', { class: 'leise' }, 'Anfragen freigeben und je Lehrkraft die Plattformen freischalten. Ohne Freischaltung gibt es keinen Zugang zur Plattform und keine Kurse dort.'),
      h(
        'div',
        { class: 'karte tabelle-huelle' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, 'Lehrkraft'), h('th', null, 'Status'), h('th', null, 'Plattformen'), h('th', null, 'Kurse'), h('th', null, 'Aktionen'))),
          h(
            'tbody',
            null,
            liste.map((l) =>
              h(
                'tr',
                null,
                h(
                  'td',
                  null,
                  h('strong', null, l.name),
                  h('br'),
                  h('span', { class: 'klein' }, l.email),
                  l.schule ? h('span', { class: 'leise klein' }, ` · ${l.schule}`) : null,
                  l.nachricht ? h('p', { class: 'klein leise', style: { marginTop: '0.3rem' } }, `„${l.nachricht}“`) : null,
                  h('div', { class: 'leise klein' }, `${l.sub} · seit ${zeit(l.erstellt)}`, l.importiert ? ` · übernommen aus ${l.importiert}` : '')
                ),
                h('td', null, h('span', { class: 'chip ' + (STATUS[l.status] || ['', ''])[1] }, (STATUS[l.status] || [l.status])[0])),
                h('td', null, freischaltung(l)),
                h('td', null, `${l.kurse}`, l.mitKurse ? h('span', { class: 'leise klein' }, ` (+${l.mitKurse} als Mitlehrkraft)`) : null),
                h('td', null, aktionen(l))
              )
            )
          )
        )
      )
    );
  }

  /* ---------- Plattformen ---------- */

  const AMPEL = { ok: 'in Ordnung', warnung: 'Hinweise', fehler: 'Fehler', vorlaeufig: 'vorläufig (ohne Manifest)', aus: 'abgeschaltet' };

  async function plattformen(ziel, { neuLaden }) {
    const [{ plattformen: liste }, schluessel] = await Promise.all([api('GET', '/api/admin/plattformen'), api('GET', '/api/admin/schluessel')]);
    const neu = () => neuLaden();

    const schluesselBox = h(
      'section',
      { class: 'karte' },
      h('h2', null, 'Öffentlicher Schlüssel für die Plattformen'),
      schluessel.aktiv
        ? [
            h('p', { class: 'leise' }, 'Jede Plattform erhält diesen Schlüssel als Umgebungsvariable ', h('code', null, 'PORTAL_PUBLIC_KEY'), ' und ', h('code', null, 'PORTAL_URL'), ' = ', h('code', null, schluessel.iss), '.'),
            h('pre', { class: 'pem' }, schluessel.pem),
            h(
              'div',
              { class: 'zeile' },
              h('button', { type: 'button', class: 'knopf hell klein', onclick: () => kopieren(schluessel.pem, 'Schlüssel') }, 'PEM kopieren'),
              h('button', { type: 'button', class: 'knopf hell klein', onclick: () => kopieren(schluessel.pem.trim().replace(/\n/g, '\\n'), 'Einzeilige Fassung') }, 'Einzeilig kopieren (CapRover)'),
              h('span', { class: 'leise klein' }, `Kennung ${schluessel.kid} · fest abrufbar unter `, h('a', { href: schluessel.url }, schluessel.url))
            )
          ]
        : h('p', { class: 'hinweis rot' }, `Kein gültiger Schlüssel: ${schluessel.fehler || 'PORTAL_PRIVATE_KEY fehlt.'} Single Sign-on und Verbund-API sind abgeschaltet. Neues Paar erzeugen mit „npm run schluessel“ und PORTAL_PRIVATE_KEY in CapRover ersetzen.`)
    );

    /* Eintragen */
    const vorlaeufigZiel = h('div');
    const eintragen = h(
      'form',
      { class: 'zeile' },
      h('input', { type: 'url', name: 'basis', required: true, placeholder: 'https://algoquest.frankjuchim.de', 'aria-label': 'Basis-URL', style: { flex: '1 1 300px', width: 'auto' } }),
      h('button', { class: 'knopf', type: 'submit' }, 'Manifest abrufen und eintragen')
    );
    beimAbsenden(eintragen, async (d) => {
      zeige(vorlaeufigZiel);
      try {
        const p = await api('POST', '/api/admin/plattformen', { basis: d.basis });
        meldung(`${p.name} eingetragen. Bitte die Rücksprung-Adresse bestätigen.`, 'gut');
        neu();
      } catch (e) {
        const det = e.daten && e.daten.details;
        if (det && det.pruefung) {
          zeige(
            vorlaeufigZiel,
            h('div', { class: 'hinweis rot abstand' }, h('strong', null, e.message), h('ul', null, det.pruefung.fehler.map((f) => h('li', null, f))))
          );
        }
        if (det && det.vorlaeufigMoeglich) vorlaeufigZiel.appendChild(vorlaeufigFormular(d.basis, neu));
        else if (!det) throw e;
      }
    });

    zeige(
      ziel,
      h('h1', null, 'Plattformen'),
      h('section', { class: 'karte' }, h('h2', null, 'Plattform eintragen'), h('p', { class: 'leise' }, 'Das Portal ruft /api/plattform ab und prüft das Manifest gegen den Vertrag (VERTRAG.md in frankjuchim/labs).'), eintragen, vorlaeufigZiel),
      liste.length ? liste.map((p) => plattformKarte(p, neu)) : h('p', { class: 'leer karte' }, 'Noch keine Plattform eingetragen.'),
      schluesselBox
    );
  }

  function vorlaeufigFormular(basis, neu) {
    const f = h(
      'form',
      { class: 'karte abstand' },
      h('h3', null, 'Als vorläufigen Eintrag anlegen'),
      h('p', { class: 'leise klein' }, 'Ohne Manifest erscheint die Plattform nur als Link auf der Startseite – kein Single Sign-on, nicht für Kurse wählbar. Sobald ein gültiges Manifest vorliegt, stellt „Prüfen“ automatisch um.'),
      h('div', { class: 'feld' }, h('label', null, 'Plattform-ID (= Subdomain)'), h('input', { name: 'id', type: 'text', required: true, pattern: '[a-z][a-z0-9\\-]{1,30}', value: (() => { try { return new URL(basis).hostname.split('.')[0]; } catch { return ''; } })() })),
      h('div', { class: 'feld' }, h('label', null, 'Name'), h('input', { name: 'name', type: 'text', required: true })),
      h('div', { class: 'feld' }, h('label', null, 'Themenfeld'), h('input', { name: 'themenfeld', type: 'text', required: true })),
      h('div', { class: 'feld' }, h('label', null, 'Beschreibung'), h('textarea', { name: 'beschreibung', maxlength: 600 })),
      h('div', { class: 'feld' }, h('label', null, 'Farbe'), h('input', { name: 'farbe', type: 'text', value: '#548235', pattern: '#[0-9A-Fa-f]{6}' })),
      h('button', { class: 'knopf', type: 'submit' }, 'Vorläufig eintragen')
    );
    beimAbsenden(f, async (d) => {
      await api('POST', '/api/admin/plattformen/vorlaeufig', { ...d, basis });
      meldung('Vorläufig eingetragen.', 'gut');
      neu();
    });
    return f;
  }

  function plattformKarte(p, neu) {
    const rs = h('form', { class: 'zeile' }, h('input', { type: 'url', name: 'ruecksprung', value: p.ruecksprung || '', placeholder: p.ruecksprungVorschlag, 'aria-label': 'Rücksprung-Adresse', style: { flex: '1 1 300px', width: 'auto' } }), h('button', { class: 'knopf klein', type: 'submit' }, 'Speichern'));
    beimAbsenden(rs, async (d) => {
      await api('PATCH', `/api/admin/plattformen/${p.id}`, { ruecksprung: d.ruecksprung || null });
      meldung('Rücksprung-Adresse gespeichert.', 'gut');
      neu();
    });
    const pr = p.pruefung;
    return h(
      'section',
      { class: 'karte plattform abstand', style: { '--pf': p.farbe } },
      h('div', { class: 'band' }),
      h(
        'div',
        { class: 'inhalt' },
        h('div', { class: 'zeile' }, h('h2', { style: { margin: 0, marginRight: 'auto' } }, p.name, h('span', { class: 'leise klein' }, ` (${p.id})`)), h('span', { class: 'ampel ' + p.status }, AMPEL[p.status] || p.status)),
        h('p', { class: 'klein' }, h('a', { href: p.basis }, p.basis), p.version ? ` · Version ${p.version}` : '', p.vertrag ? ` · Vertrag ${p.vertrag}` : '', p.auth ? ` · Anmeldung: ${p.auth.modus}${p.auth.sso ? ', SSO' : ''}` : ''),
        p.themenfeld ? h('p', { class: 'leise klein' }, p.themenfeld) : null,
        pr && (pr.fehler.length || pr.warnungen.length)
          ? h('div', { class: 'hinweis ' + (pr.fehler.length ? 'rot' : 'gold') + ' klein' }, h('ul', { style: { margin: 0 } }, [...pr.fehler, ...pr.warnungen].map((x) => h('li', null, x))))
          : null,
        p.geprueft ? h('p', { class: 'leise klein' }, `Zuletzt geprüft: ${zeit(p.geprueft)}`) : null,
        p.vorlaeufig
          ? null
          : h(
              'div',
              { class: 'feld' },
              h('span', { class: 'label' }, 'Rücksprung-Adresse für Single Sign-on (Whitelist, exakt)'),
              rs,
              !p.ruecksprung
                ? h('small', null, 'Noch nicht freigegeben – ohne Adresse ist keine Anmeldung über das Portal möglich. ', h('button', { type: 'button', class: 'textknopf', onclick: () => api('PATCH', `/api/admin/plattformen/${p.id}`, { ruecksprung: p.ruecksprungVorschlag }).then(neu, fehler) }, `Vorschlag ${p.ruecksprungVorschlag} übernehmen`))
                : null
            ),
        h(
          'div',
          { class: 'zeile' },
          h(
            'button',
            {
              type: 'button',
              class: 'knopf klein',
              onclick: async (e) => {
                e.target.disabled = true;
                await api('POST', `/api/admin/plattformen/${p.id}/pruefen`).then(() => meldung('Geprüft.', 'gut'), fehler);
                neu();
              }
            },
            'Jetzt prüfen'
          ),
          h('label', { class: 'haken' }, h('input', { type: 'checkbox', checked: p.aktiv, onchange: (e) => api('PATCH', `/api/admin/plattformen/${p.id}`, { aktiv: e.target.checked }).then(neu, fehler) }), 'aktiv (öffentlich, SSO)'),
          h(
            'label',
            { class: 'haken' },
            'Reihenfolge',
            h('input', { type: 'text', inputmode: 'numeric', value: p.reihenfolge, style: { width: '5em' }, onchange: (e) => api('PATCH', `/api/admin/plattformen/${p.id}`, { reihenfolge: e.target.value }).then(neu, fehler) })
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'knopf klein hell',
              onclick: async () => {
                if (!(await dialog({ titel: `${p.name} austragen?`, text: 'Freischaltungen und Kurs-Zuordnungen zu dieser Plattform werden entfernt. Daten auf der Plattform selbst bleiben unberührt.', ok: 'Austragen', gefahr: true }))) return;
                await api('DELETE', `/api/admin/plattformen/${p.id}`).then(neu, fehler);
              }
            },
            'Austragen'
          )
        )
      )
    );
  }

  /* ---------- Verbund-Aufträge ---------- */

  async function verbund(ziel, { neuLaden }) {
    const { auftraege } = await api('GET', '/api/admin/auftraege');
    const chip = { erledigt: 'gruen', offen: 'gold', fehlgeschlagen: 'rot' };
    zeige(
      ziel,
      h('h1', null, 'Verbund-Aufträge'),
      h('p', { class: 'leise' }, 'Löschungen und Kursänderungen an die Plattformen (Vertrag §6). Nicht erreichbare Plattformen werden automatisch erneut versucht (bis etwa 6 Tage).'),
      h('div', { class: 'zeile' }, h('button', { type: 'button', class: 'knopf klein', onclick: () => api('POST', '/api/admin/auftraege/verarbeiten').then((r) => (meldung(`${r.bearbeitet} Auftrag/Aufträge bearbeitet.`, 'gut'), neuLaden()), fehler) }, 'Fällige jetzt abarbeiten')),
      h(
        'div',
        { class: 'karte tabelle-huelle abstand' },
        auftraege.length
          ? h(
              'table',
              null,
              h('thead', null, h('tr', null, h('th', null, 'Nr.'), h('th', null, 'Plattform'), h('th', null, 'Zweck'), h('th', null, 'Inhalt'), h('th', null, 'Status'), h('th', null, 'Erstellt'), h('th', null, ''))),
              h(
                'tbody',
                null,
                auftraege.map((a) =>
                  h(
                    'tr',
                    null,
                    h('td', null, a.id),
                    h('td', null, a.plattform),
                    h('td', null, a.zweck),
                    h('td', { class: 'mono klein' }, a.nutzlast ? JSON.stringify(a.nutzlast) : a.pfad),
                    h('td', null, h('span', { class: 'chip ' + (chip[a.status] || '') }, a.status), a.versuche ? h('span', { class: 'leise klein' }, ` · ${a.versuche} Versuch(e)`) : null, a.fehler ? h('div', { class: 'klein', style: { color: 'var(--rot)' } }, a.fehler) : null, a.naechsterVersuch ? h('div', { class: 'leise klein' }, `nächster: ${zeit(a.naechsterVersuch)}`) : null),
                    h('td', { class: 'klein' }, zeit(a.erstellt)),
                    h('td', null, a.status !== 'erledigt' ? h('button', { type: 'button', class: 'knopf klein hell', onclick: () => api('POST', `/api/admin/auftraege/${a.id}/wiederholen`).then(neuLaden, fehler) }, 'Wiederholen') : null)
                  )
                )
              )
            )
          : h('p', { class: 'leer' }, 'Noch keine Aufträge.')
      )
    );
  }

  /* ---------- Datenübernahme ---------- */

  function bericht(b) {
    const zeile = (titel, o) => h('tr', null, h('th', null, titel), ...Object.entries(o).map(([k, v]) => h('td', null, `${k}: ${v}`)));
    return h(
      'div',
      { class: 'abstand' },
      h('p', { class: 'hinweis ' + (b.probelauf ? 'gold' : 'gruen') }, b.probelauf ? 'Probelauf – nichts wurde gespeichert.' : 'Übernahme gespeichert.', ` Quelle: ${b.quelle}.`),
      h('div', { class: 'tabelle-huelle' }, h('table', null, h('tbody', null, zeile('Lehrkräfte', b.lehrkraefte), zeile('Kurse', b.kurse), zeile('Schüler', b.schueler)))),
      b.hinweise.length ? h('details', { class: 'abstand', open: b.hinweise.length < 15 }, h('summary', null, `${b.hinweise.length} Hinweis(e)`), h('ul', { class: 'klein' }, b.hinweise.map((x) => h('li', null, x)))) : null
    );
  }

  async function importAnsicht(ziel, { neuLaden }) {
    const { importe } = await api('GET', '/api/admin/importe');
    const ergebnis = h('div');
    const datei = h('input', { type: 'file', accept: 'application/json,.json', required: true, 'aria-label': 'Sicherungsdatei' });
    const probe = h('input', { type: 'checkbox', checked: true });
    const form = h(
      'form',
      { class: 'karte' },
      h('h2', null, 'Daten aus Algo Quest übernehmen'),
      h(
        'ol',
        { class: 'klein' },
        h('li', null, 'Plattform „algoquest“ hier eintragen (Plattformen), damit Lehrkräfte und Kurse automatisch freigeschaltet werden.'),
        h('li', null, 'In Algo Quest als Superadmin die Sicherung (Backup, JSON) herunterladen.'),
        h('li', null, 'Datei hier wählen, zuerst als Probelauf, dann richtig übernehmen. Genutzt werden nur Lehrkräfte (mit Passwort-Hash), Kurse (mit Kurscode) und Schüler (Name + Code) – Lernstände werden nicht gelesen oder gespeichert.'),
        h('li', null, 'Die Zuordnung alt → neu (sub, Kurs-ID) herunterladen und an Algo Quest übergeben (Vertrag §11, Phase 2).')
      ),
      h('div', { class: 'feld' }, h('label', null, 'Sicherungsdatei (JSON)'), datei),
      h('label', { class: 'haken' }, probe, 'Nur Probelauf (nichts speichern)'),
      h('button', { class: 'knopf', type: 'submit' }, 'Übernahme starten'),
      ergebnis
    );
    beimAbsenden(form, async () => {
      const f = datei.files && datei.files[0];
      if (!f) throw new Error('Bitte eine Datei wählen.');
      let daten;
      try {
        daten = JSON.parse(await f.text());
      } catch {
        throw new Error('Die Datei ist kein gültiges JSON.');
      }
      const r = await api('POST', '/api/admin/import', { daten, probelauf: probe.checked });
      zeige(ergebnis, bericht(r.bericht));
      if (!r.bericht.probelauf) setTimeout(neuLaden, 1500);
    });
    zeige(
      ziel,
      h('h1', null, 'Datenübernahme'),
      form,
      h(
        'section',
        { class: 'karte' },
        h('h2', null, 'Bisherige Übernahmen'),
        importe.length
          ? importe.map((i) =>
              h(
                'div',
                { class: 'zeile abstand' },
                h('strong', null, `#${i.id} · ${i.quelle}`),
                h('span', { class: 'leise klein' }, zeit(i.erstellt)),
                h('span', { class: 'klein' }, `Lehrkräfte neu ${i.bericht.lehrkraefte.neu}, Kurse neu ${i.bericht.kurse.neu}, Schüler neu ${i.bericht.schueler.neu} (neuer Code: ${i.bericht.schueler.neuerCode})`),
                h('a', { class: 'knopf klein hell', href: `/api/admin/importe/${i.id}/zuordnung.json`, download: `zuordnung_${i.quelle}_${i.id}.json` }, 'Zuordnung alt → neu')
              )
            )
          : h('p', { class: 'leise' }, 'Noch keine Übernahme.')
      )
    );
  }

  return { lehrkraefte, plattformen, verbund, import: importAnsicht };
})();

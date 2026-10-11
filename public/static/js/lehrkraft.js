/* InfoLabs – Lehrkraft-Bereich: Kurse, Schüler, Mitlehrkräfte, Kennzahlen; für den Superadmin zusätzlich admin.js */
'use strict';

(() => {
  const { h, zeige, api, meldung, fehler, dialog, kopieren, datum, zeit, kuerzel, beimAbsenden } = IL;
  const $ = (id) => document.getElementById(id);
  const ansicht = $('ansicht');
  const st = { ich: null, wahl: [], einladungen: [], admin: null };

  /* ---------- Navigation ---------- */

  function navigation(aktiv) {
    const link = (href, text, zaehler) =>
      h('a', { href, 'aria-current': aktiv === href ? 'page' : null }, text, zaehler ? h('span', { class: 'zaehler' }, zaehler) : null);
    const teile = [link('#/kurse', st.ich.rolle === 'superadmin' ? 'Alle Kurse' : 'Meine Kurse'), link('#/konto', 'Konto', st.einladungen.length || null)];
    if (st.ich.rolle === 'superadmin') {
      teile.push(
        h('span', { class: 'trenner', 'aria-hidden': 'true' }),
        link('#/admin/lehrkraefte', 'Lehrkräfte', st.admin && st.admin.lehrkraefteWartend ? st.admin.lehrkraefteWartend : null),
        link('#/admin/plattformen', 'Plattformen'),
        link('#/admin/verbund', 'Verbund-Aufträge', st.admin && st.admin.auftraegeFehlgeschlagen ? st.admin.auftraegeFehlgeschlagen : null),
        link('#/admin/import', 'Datenübernahme')
      );
    }
    zeige($('bereiche'), teile);
    if (st.admin && !st.admin.schluessel) $('bereiche').appendChild(h('p', { class: 'hinweis rot klein', style: { width: '100%', margin: '0.4rem 0 0' } }, 'Single Sign-on ist abgeschaltet: ', st.admin.schluesselFehler || 'kein Schlüssel.', ' ', h('a', { href: '#/admin/plattformen' }, 'Details')));
  }

  async function route() {
    const hash = location.hash || '#/kurse';
    try {
      if (st.ich.rolle === 'superadmin') st.admin = await api('GET', '/api/admin/uebersicht').catch(() => null);
      st.einladungen = (await api('GET', '/api/lehrkraft/einladungen')).einladungen;
      let m;
      if ((m = /^#\/kurs\/(\d+)$/.exec(hash))) {
        navigation('#/kurse');
        await kursDetail(Number(m[1]));
      } else if (hash === '#/konto') {
        navigation(hash);
        await konto();
      } else if ((m = /^#\/admin\/([a-z]+)$/.exec(hash)) && st.ich.rolle === 'superadmin' && IL.admin[m[1]]) {
        navigation(hash);
        await IL.admin[m[1]](ansicht, { neuLaden: route });
      } else {
        navigation('#/kurse');
        await kursListe();
      }
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.status === 401) return location.replace('/#lehrkraft');
      zeige(ansicht, h('p', { class: 'hinweis rot' }, e.message));
    }
  }

  /* ---------- Kursliste ---------- */

  const rollenChip = (rolle) =>
    rolle === 'inhaber' ? null : h('span', { class: 'chip gold' }, rolle === 'mitlehrkraft' ? 'Mitlehrkraft' : 'als Superadmin');

  function plattformChips(liste) {
    return h(
      'div',
      { class: 'marken' },
      liste.length
        ? liste.map((p) => h('span', { class: 'chip' + (p.aktiv ? '' : ' grau'), style: { '--pf': p.farbe } }, h('span', { class: 'punkt' }), p.name, p.aktiv ? null : ' (aus)'))
        : h('span', { class: 'chip grau' }, 'keine Plattform')
    );
  }

  async function kursListe() {
    const [{ kurse, standardAblauf }, { plattformen }] = await Promise.all([api('GET', '/api/lehrkraft/kurse'), api('GET', '/api/lehrkraft/plattformen')]);
    st.wahl = plattformen;
    const formular = h(
      'form',
      { class: 'karte', id: 'form-neu' },
      h('h2', null, 'Neuer Kurs'),
      h('div', { class: 'feld' }, h('label', { for: 'k-name' }, 'Kursname'), h('input', { id: 'k-name', name: 'name', type: 'text', maxlength: 80, required: true, placeholder: 'z. B. Informatik LK 13 (2026/27)' })),
      plattformen.length
        ? h('fieldset', null, h('legend', null, 'Plattformen'), plattformen.map((p) => h('label', { class: 'haken' }, h('input', { type: 'checkbox', name: 'p', value: p.id, checked: true }), p.name, h('span', { class: 'leise klein' }, ` – ${p.themenfeld}`))))
        : h('p', { class: 'hinweis klein' }, 'Sie sind noch für keine Plattform freigeschaltet. Der Kurs kann trotzdem angelegt werden; Plattformen lassen sich später ergänzen.'),
      h('div', { class: 'feld' }, h('label', { for: 'k-ablauf' }, 'Ablaufdatum'), h('input', { id: 'k-ablauf', name: 'ablauf', type: 'date', value: standardAblauf, required: true }), h('small', null, 'Danach werden Kurs und Schülerkonten ohne weiteren Kurs gelöscht – auf allen Plattformen. Verlängern ist jederzeit möglich.')),
      h('button', { class: 'knopf', type: 'submit' }, 'Kurs anlegen')
    );
    beimAbsenden(formular, async (d, form) => {
      const ps = [...form.querySelectorAll('input[name="p"]:checked')].map((x) => x.value);
      const k = await api('POST', '/api/lehrkraft/kurse', { name: d.name, ablauf: d.ablauf, plattformen: ps });
      meldung('Kurs angelegt.', 'gut');
      location.hash = '#/kurs/' + k.id;
    });

    zeige(
      ansicht,
      h('h1', null, st.ich.rolle === 'superadmin' ? 'Alle Kurse' : 'Meine Kurse'),
      st.einladungen.length ? h('p', { class: 'hinweis gold' }, `Sie haben ${st.einladungen.length} offene Einladung(en) als Mitlehrkraft. `, h('a', { href: '#/konto' }, 'Ansehen')) : null,
      kurse.length
        ? h(
            'div',
            { class: 'raster' },
            kurse.map((k) =>
              h(
                'a',
                { class: 'karte kurskarte', href: '#/kurs/' + k.id },
                h('div', { class: 'zeile' }, h('h3', { style: { margin: 0 } }, k.name), rollenChip(k.rolle)),
                h('p', { class: 'leise klein' }, 'Kurscode ', h('span', { class: 'code' }, k.code), k.inhaber && k.rolle !== 'inhaber' ? ` · ${k.inhaber.name}` : ''),
                h('div', { class: 'zahlen' }, h('div', { class: 'zahl' }, h('b', null, k.kennzahlen.schueler), h('span', null, 'Schüler')), h('div', { class: 'zahl' }, h('b', null, k.kennzahlen.aktiv7), h('span', null, 'aktiv (7 Tage)'))),
                h('div', { class: 'abstand' }, plattformChips(k.plattformen)),
                k.ablaufBald ? h('p', { class: 'hinweis rot klein abstand' }, `Läuft am ${datum(k.ablauf)} ab – danach wird gelöscht.`) : null
              )
            )
          )
        : h('p', { class: 'leer karte' }, 'Noch keine Kurse. Legen Sie unten Ihren ersten Kurs an.'),
      h('div', { class: 'abstand' }, formular)
    );
  }

  /* ---------- Kursdetail ---------- */

  async function kursDetail(id) {
    const [k, { schueler }] = await Promise.all([api('GET', `/api/lehrkraft/kurse/${id}`), api('GET', `/api/lehrkraft/kurse/${id}/schueler`)]);
    const darfAlles = k.rolle !== 'mitlehrkraft';
    const neu = () => kursDetail(id).catch(fehler);
    const aendern = async (body, text) => {
      await api('PATCH', `/api/lehrkraft/kurse/${id}`, body);
      meldung(text, 'gut');
      await neu();
    };

    /* Kopf: Kurscode, Link, QR */
    const kopf = h(
      'section',
      { class: 'karte kurskopf' },
      h(
        'div',
        null,
        h('div', { class: 'zeile' }, h('h1', { style: { margin: 0 } }, k.name), rollenChip(k.rolle)),
        k.inhaber && k.rolle !== 'inhaber' ? h('p', { class: 'leise' }, `Kurs von ${k.inhaber.name}`) : null,
        h('p', { class: 'abstand' }, 'Kurscode: ', h('span', { class: 'code-gross' }, k.code)),
        h('p', { class: 'klein' }, 'Beitritts-Link: ', h('a', { href: k.link }, k.link)),
        h(
          'div',
          { class: 'zeile nicht-drucken' },
          h('button', { type: 'button', class: 'knopf hell klein', onclick: () => kopieren(k.link, 'Link') }, 'Link kopieren'),
          h('a', { class: 'knopf hell klein', href: `/api/lehrkraft/kurse/${id}/qr.svg`, download: `QR_${k.code}.svg` }, 'QR-Code speichern'),
          h(
            'button',
            {
              type: 'button',
              class: 'knopf hell klein',
              onclick: async () => {
                if (!(await dialog({ titel: 'Neuen Kurscode erzeugen?', text: 'Der alte Kurscode und alte QR-Codes funktionieren danach nicht mehr. Wer schon im Kurs ist, bleibt drin.', ok: 'Neuen Code erzeugen' }))) return;
                await api('POST', `/api/lehrkraft/kurse/${id}/neuer-kurscode`);
                meldung('Neuer Kurscode erzeugt.', 'gut');
                await neu();
              }
            },
            'Neuer Kurscode'
          )
        ),
        h(
          'label',
          { class: 'haken abstand nicht-drucken' },
          h('input', { type: 'checkbox', checked: k.beitrittOffen, onchange: (e) => aendern({ beitrittOffen: e.target.checked }, e.target.checked ? 'Beitritt geöffnet.' : 'Beitritt geschlossen.').catch(fehler) }),
          'Neue Schüler dürfen beitreten'
        )
      ),
      h('img', { class: 'qr', src: `/api/lehrkraft/kurse/${id}/qr.svg?c=${k.code}`, alt: `QR-Code zum Beitritt (Kurscode ${k.code})` })
    );

    /* Kennzahlen */
    const nutzung = new Map(k.kennzahlen.nutzung.map((n) => [n.plattform, n]));
    const zahlen = h(
      'section',
      { class: 'karte' },
      h('h2', null, 'Überblick'),
      h(
        'div',
        { class: 'zahlen' },
        h('div', { class: 'zahl' }, h('b', null, k.kennzahlen.schueler), h('span', null, 'Schüler')),
        h('div', { class: 'zahl' }, h('b', null, k.kennzahlen.aktiv7), h('span', null, 'aktiv in den letzten 7 Tagen')),
        k.plattformen.filter((p) => p.aktiv).map((p) => h('div', { class: 'zahl' }, h('b', null, nutzung.has(p.id) ? nutzung.get(p.id).schueler : 0), h('span', null, `schon auf ${p.name}`)))
      ),
      h('p', { class: k.ablaufBald ? 'hinweis rot abstand' : 'leise klein abstand' }, `Ablaufdatum: ${datum(k.ablauf)} (in ${k.ablaufInTagen} Tagen). Danach werden der Kurs und Schülerkonten ohne weiteren Kurs gelöscht – im Portal und auf allen Plattformen.`)
    );

    /* Plattformen */
    const plattformBox = h('section', { class: 'karte' }, h('h2', null, 'Plattformen'));
    if (darfAlles) {
      const wahl = (await api('GET', '/api/lehrkraft/plattformen')).plattformen;
      const ids = new Set([...wahl.map((p) => p.id), ...k.plattformen.map((p) => p.id)]);
      const form = h(
        'form',
        null,
        [...ids].map((pid) => {
          const p = wahl.find((x) => x.id === pid) || k.plattformen.find((x) => x.id === pid);
          const imKurs = k.plattformen.find((x) => x.id === pid);
          const frei = wahl.some((x) => x.id === pid);
          return h('label', { class: 'haken' }, h('input', { type: 'checkbox', name: 'p', value: pid, checked: !!(imKurs && imKurs.aktiv), disabled: !frei }), p.name, frei ? null : h('span', { class: 'leise klein' }, ' (nicht freigeschaltet)'));
        }),
        ids.size ? h('button', { class: 'knopf klein', type: 'submit' }, 'Plattformen speichern') : h('p', { class: 'leise' }, 'Keine Plattform freigeschaltet. Der Administrator schaltet Plattformen frei.')
      );
      beimAbsenden(form, async () => {
        const ps = [...form.querySelectorAll('input[name="p"]:checked')].map((x) => x.value);
        await aendern({ plattformen: ps }, 'Plattformen gespeichert.');
      });
      plattformBox.appendChild(form);
      plattformBox.appendChild(h('p', { class: 'leise klein' }, 'Abschalten sperrt den Kurs auf der Plattform; der Lernstand bleibt erhalten, bis der Kurs gelöscht wird.'));
    } else plattformBox.appendChild(plattformChips(k.plattformen));

    // Kennzahlen je Plattform (Verbund-API)
    for (const p of k.plattformen.filter((x) => x.aktiv)) {
      const ziel = h('div', { class: 'abstand' });
      const knopf = h('button', { type: 'button', class: 'knopf hell klein', style: { '--pf': p.farbe } }, `Lernstand auf ${p.name} laden`);
      knopf.addEventListener('click', async () => {
        knopf.disabled = true;
        try {
          const u = await api('GET', `/api/lehrkraft/kurse/${id}/uebersicht/${p.id}`);
          if (!u.verfuegbar) return zeige(ziel, h('p', { class: 'hinweis klein' }, u.grund));
          zeige(
            ziel,
            u.welten.length ? h('div', { class: 'zahlen' }, u.welten.map((w) => h('div', { class: 'zahl' }, h('b', null, Math.round((w.anteil || 0) * 100) + ' %'), h('span', null, w.titel)))) : null,
            h(
              'div',
              { class: 'tabelle-huelle abstand' },
              h(
                'table',
                null,
                h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Punkte'), h('th', null, 'Gelöst'), h('th', null, 'Anteil'), h('th', null, 'Zuletzt'))),
                h(
                  'tbody',
                  null,
                  u.schueler.length
                    ? u.schueler.map((s) =>
                        h('tr', null, h('td', null, s.name), h('td', null, s.punkte ?? '–'), h('td', null, s.geloest ?? '–'), h('td', null, h('div', { class: 'balken', title: Math.round((s.anteil || 0) * 100) + ' %' }, h('span', { style: { width: Math.round((s.anteil || 0) * 100) + '%' } }))), h('td', null, zeit(s.zuletzt)))
                      )
                    : h('tr', null, h('td', { colspan: 5, class: 'leise' }, 'Noch keine Daten.'))
                )
              )
            ),
            u.stand ? h('p', { class: 'leise klein' }, `Stand: ${zeit(u.stand)}`) : null
          );
        } catch (e) {
          fehler(e);
        } finally {
          knopf.disabled = false;
        }
      });
      plattformBox.appendChild(h('div', { class: 'abstand' }, knopf, ziel));
    }

    /* Schüler */
    const schuelerBox = h(
      'section',
      { class: 'karte' },
      h('div', { class: 'zeile' }, h('h2', { style: { margin: 0, marginRight: 'auto' } }, `Schüler (${schueler.length})`), h('button', { type: 'button', class: 'knopf hell klein', onclick: () => window.print() }, 'Codeliste drucken')),
      h('p', { class: 'nur-druck' }, `${k.name} · Kurscode ${k.code} · Anmeldung: ${location.origin}`),
      schueler.some((s) => s.codeNeu) ? h('p', { class: 'hinweis gold klein abstand' }, 'Markierte Schüler haben bei der Datenübernahme einen neuen Code bekommen – bitte mitteilen.') : null,
      schueler.length
        ? h(
            'div',
            { class: 'tabelle-huelle abstand' },
            h(
              'table',
              null,
              h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Persönlicher Code'), h('th', { class: 'nicht-drucken' }, 'Plattformen'), h('th', { class: 'nicht-drucken' }, 'Zuletzt aktiv'), h('th', { class: 'nicht-drucken' }, 'Aktionen'))),
              h(
                'tbody',
                null,
                schueler.map((s) =>
                  h(
                    'tr',
                    null,
                    h('td', null, s.name, s.weitereKurse ? h('span', { class: 'leise klein' }, ` (+${s.weitereKurse} Kurs${s.weitereKurse > 1 ? 'e' : ''})`) : null),
                    h('td', null, h('span', { class: 'code' }, s.code), s.codeNeu ? h('span', { class: 'chip gold' }, 'neu') : null),
                    h('td', { class: 'nicht-drucken' }, h('div', { class: 'marken' }, s.plattformen.map((p) => h('span', { class: 'chip grau', title: 'zuletzt ' + zeit(p.letzte) }, kuerzel((k.plattformen.find((x) => x.id === p.id) || { name: p.id }).name))))),
                    h('td', { class: 'nicht-drucken' }, zeit(s.zuletzt)),
                    h(
                      'td',
                      { class: 'nicht-drucken' },
                      h(
                        'div',
                        { class: 'zeile' },
                        h(
                          'button',
                          {
                            type: 'button',
                            class: 'knopf hell klein',
                            onclick: async () => {
                              const name = await dialog({ titel: 'Umbenennen', eingabe: 'Neuer Name', wert: s.name, ok: 'Speichern' });
                              if (!name) return;
                              await api('PATCH', `/api/lehrkraft/kurse/${id}/schueler/${s.id}`, { name }).then(neu, fehler);
                            }
                          },
                          'Umbenennen'
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            class: 'knopf hell klein',
                            onclick: async () => {
                              if (!(await dialog({ titel: `Neuer Code für ${s.name}?`, text: 'Der alte Code gilt danach nicht mehr; laufende Anmeldungen im Portal werden beendet.', ok: 'Neuen Code erzeugen' }))) return;
                              const r = await api('POST', `/api/lehrkraft/kurse/${id}/schueler/${s.id}/neuer-code`).catch(fehler);
                              if (r) {
                                await dialog({ titel: `Neuer Code für ${r.name}`, text: r.code, ok: 'Notiert', abbrechen: 'Schließen' });
                                await neu();
                              }
                            }
                          },
                          'Neuer Code'
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            class: 'knopf hell klein',
                            onclick: async () => {
                              const text = s.weitereKurse
                                ? `${s.name} wird aus diesem Kurs entfernt. Das Konto bleibt für die anderen Kurse bestehen.`
                                : `${s.name} ist in keinem weiteren Kurs – das Konto und der Lernstand auf allen Plattformen werden gelöscht.`;
                              if (!(await dialog({ titel: 'Aus dem Kurs entfernen?', text, ok: 'Entfernen', gefahr: true }))) return;
                              await api('DELETE', `/api/lehrkraft/kurse/${id}/schueler/${s.id}`).then(neu, fehler);
                            }
                          },
                          'Entfernen'
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        : h('p', { class: 'leer' }, 'Noch niemand beigetreten. Teilen Sie Kurscode, Link oder QR-Code.')
    );

    /* Einstellungen */
    const einstellungen = h('section', { class: 'karte nicht-drucken' }, h('h2', null, 'Einstellungen'));
    const nameForm = h('form', { class: 'zeile' }, h('input', { type: 'text', name: 'name', value: k.name, maxlength: 80, 'aria-label': 'Kursname', style: { flex: '1 1 240px', width: 'auto' } }), h('button', { class: 'knopf klein', type: 'submit' }, 'Umbenennen'));
    beimAbsenden(nameForm, (d) => aendern({ name: d.name }, 'Kurs umbenannt.'));
    einstellungen.appendChild(h('div', { class: 'feld' }, h('span', { class: 'label' }, 'Kursname'), nameForm));
    if (darfAlles) {
      const ablaufForm = h('form', { class: 'zeile' }, h('input', { type: 'date', name: 'ablauf', value: k.ablauf, 'aria-label': 'Ablaufdatum', style: { flex: '1 1 200px', width: 'auto' } }), h('button', { class: 'knopf klein', type: 'submit' }, 'Ablaufdatum speichern'));
      beimAbsenden(ablaufForm, (d) => aendern({ ablauf: d.ablauf }, 'Ablaufdatum gespeichert.'));
      einstellungen.appendChild(h('div', { class: 'feld' }, h('span', { class: 'label' }, 'Ablaufdatum (höchstens 24 Monate)'), ablaufForm));
    }

    /* Mitlehrkräfte */
    const mit = h(
      'section',
      { class: 'karte nicht-drucken' },
      h('h2', null, 'Lehrkräfte des Kurses'),
      h('p', null, h('strong', null, k.inhaber ? k.inhaber.name : '–'), h('span', { class: 'leise' }, ' (Inhaberin/Inhaber)')),
      k.lehrkraefte.map((l) =>
        h(
          'div',
          { class: 'zeile' },
          h('span', null, `${l.name} · ${l.email}`),
          darfAlles || l.id === st.ich.id
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'textknopf',
                  onclick: async () => {
                    const selbst = l.id === st.ich.id;
                    if (!(await dialog({ titel: selbst ? 'Kurs verlassen?' : `${l.name} entfernen?`, ok: selbst ? 'Verlassen' : 'Entfernen', gefahr: true }))) return;
                    await api('DELETE', `/api/lehrkraft/kurse/${id}/lehrkraefte/${l.id}`).catch(fehler);
                    if (selbst) location.hash = '#/kurse';
                    else await neu();
                  }
                },
                l.id === st.ich.id ? 'Kurs verlassen' : 'entfernen'
              )
            : null
        )
      ),
      k.einladungen.length
        ? h('p', { class: 'leise klein abstand' }, 'Eingeladen: ', k.einladungen.map((e, i) => [i ? ', ' : '', e.email, darfAlles ? h('button', { type: 'button', class: 'textknopf', onclick: () => api('DELETE', `/api/lehrkraft/kurse/${id}/einladungen/${e.id}`).then(neu, fehler) }, 'zurückziehen') : null]))
        : null
    );
    if (darfAlles) {
      const einladen = h('form', { class: 'zeile abstand' }, h('input', { type: 'email', name: 'email', required: true, placeholder: 'E-Mail der Lehrkraft', 'aria-label': 'E-Mail der Lehrkraft', style: { flex: '1 1 240px', width: 'auto' } }), h('button', { class: 'knopf klein', type: 'submit' }, 'Als Mitlehrkraft einladen'));
      beimAbsenden(einladen, async (d) => {
        await api('POST', `/api/lehrkraft/kurse/${id}/einladungen`, { email: d.email });
        meldung('Einladung gespeichert. Die Lehrkraft sieht sie nach der Anmeldung unter „Konto“.', 'gut');
        await neu();
      });
      mit.appendChild(einladen);
      mit.appendChild(h('p', { class: 'leise klein' }, 'Mitlehrkräfte verwalten Schüler und sehen den Lernstand. Plattformen, Ablaufdatum und Löschen bleiben bei Ihnen.'));
    }

    /* Löschen */
    const gefahr = darfAlles
      ? h(
          'section',
          { class: 'karte nicht-drucken', style: { borderTop: '4px solid var(--rot)' } },
          h('h2', null, 'Kurs löschen'),
          h('p', { class: 'leise' }, 'Löscht den Kurs im Portal und auf allen Plattformen. Schüler, die in keinem weiteren Kurs sind, werden mit ihrem Lernstand gelöscht.'),
          h(
            'button',
            {
              type: 'button',
              class: 'knopf rot',
              onclick: async () => {
                const b = await dialog({ titel: 'Kurs endgültig löschen?', text: `Zur Bestätigung den Kursnamen „${k.name}“ eingeben.`, eingabe: 'Kursname', ok: 'Endgültig löschen', gefahr: true });
                if (b === null) return;
                const r = await api('DELETE', `/api/lehrkraft/kurse/${id}`, { bestaetigung: b }).catch(fehler);
                if (r) {
                  meldung(`Kurs gelöscht (${r.schueler} Schülerkonten).`, 'gut');
                  location.hash = '#/kurse';
                }
              }
            },
            'Kurs löschen …'
          )
        )
      : null;

    zeige(ansicht, h('p', { class: 'nicht-drucken' }, h('a', { href: '#/kurse' }, '← Alle Kurse')), kopf, zahlen, schuelerBox, plattformBox, einstellungen, mit, gefahr);
  }

  /* ---------- Konto ---------- */

  async function konto() {
    const ich = await api('GET', '/api/lehrkraft/ich');
    const pw = h(
      'form',
      { class: 'karte' },
      h('h2', null, 'Passwort ändern'),
      h('div', { class: 'feld' }, h('label', { for: 'pw-alt' }, 'Bisheriges Passwort'), h('input', { id: 'pw-alt', name: 'alt', type: 'password', autocomplete: 'current-password', required: true })),
      h('div', { class: 'feld' }, h('label', { for: 'pw-neu' }, 'Neues Passwort (mind. 10 Zeichen)'), h('input', { id: 'pw-neu', name: 'neu', type: 'password', autocomplete: 'new-password', minlength: 10, required: true })),
      h('button', { class: 'knopf', type: 'submit' }, 'Passwort ändern')
    );
    beimAbsenden(pw, async (d, form) => {
      await api('POST', '/api/lehrkraft/passwort', d);
      form.reset();
      meldung('Passwort geändert.', 'gut');
    });
    const einladungen = h(
      'section',
      { class: 'karte' },
      h('h2', null, 'Einladungen als Mitlehrkraft'),
      st.einladungen.length
        ? st.einladungen.map((e) =>
            h(
              'div',
              { class: 'zeile' },
              h('span', { style: { marginRight: 'auto' } }, h('strong', null, e.kurs), e.von ? ` · von ${e.von}` : ''),
              h('button', { type: 'button', class: 'knopf klein gruen', onclick: () => api('POST', `/api/lehrkraft/einladungen/${e.id}`, { annehmen: true }).then(route, fehler) }, 'Annehmen'),
              h('button', { type: 'button', class: 'knopf klein hell', onclick: () => api('POST', `/api/lehrkraft/einladungen/${e.id}`, { annehmen: false }).then(route, fehler) }, 'Ablehnen')
            )
          )
        : h('p', { class: 'leise' }, 'Keine offenen Einladungen.')
    );
    zeige(
      ansicht,
      h('h1', null, 'Konto'),
      h(
        'section',
        { class: 'karte' },
        h('h2', null, ich.name),
        h('p', null, ich.email, ich.schule ? ` · ${ich.schule}` : ''),
        h('p', { class: 'leise klein' }, `Kennung im Verbund: ${ich.sub}`),
        h('h3', null, 'Freigeschaltete Plattformen'),
        ich.plattformen.length ? h('div', { class: 'marken' }, ich.plattformen.map((p) => h('span', { class: 'chip' }, p))) : h('p', { class: 'leise' }, 'Noch keine – der Administrator schaltet Plattformen frei.')
      ),
      einladungen,
      ich.rolle === 'superadmin' ? h('p', { class: 'hinweis klein' }, 'Das Superadmin-Passwort wird über die Umgebungsvariable ADMIN_PASSWORD festgelegt.') : pw
    );
  }

  /* ---------- Start ---------- */
  (async () => {
    const s = await IL.kopfzeile();
    if (!s || s.typ !== 'lehrkraft') return location.replace('/#lehrkraft');
    if (s.mussPasswortAendern) return location.replace('/#lehrkraft');
    st.ich = await api('GET', '/api/lehrkraft/ich');
    window.addEventListener('hashchange', route);
    await route();
  })().catch(fehler);
})();

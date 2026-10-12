/* InfoLabs – Startseite: Plattform-Übersicht, Beitritt, Anmeldung (auch im SSO-Ablauf mit ?weiter=…) */
'use strict';

(() => {
  const { h, s: svg, textFarbe, zeige, api, meldung, fehler, beimAbsenden, kuerzel } = IL;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // SSO: Rücksprung nur auf /sso/autorisieren (gleicher Ursprung)
  const weiterRoh = params.get('weiter') || '';
  const weiter = /^\/sso\/autorisieren\?[^\s\\]*$/.test(weiterRoh) ? weiterRoh : null;
  const ssoParams = weiter ? new URLSearchParams(weiter.split('?')[1]) : null;
  const kursParam = (params.get('kurs') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  let plattformen = [];
  let sitzung = { typ: null };

  function ziel(typ) {
    if (weiter) return weiter;
    return typ === 'schueler' ? '/schueler' : '/lehrkraft';
  }

  /* ---------- Reiter ---------- */
  const reiter = [
    ['tab-beitreten', 'form-beitreten'],
    ['tab-weiter', 'form-weiter'],
    ['tab-lehrkraft', 'bereich-lehrkraft']
  ];
  function waehle(tabId) {
    for (const [t, p] of reiter) {
      $(t).setAttribute('aria-selected', String(t === tabId));
      $(p).hidden = t !== tabId;
    }
  }
  for (const [t] of reiter) $(t).addEventListener('click', () => waehle(t));
  document.querySelector('.reiter').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = reiter.findIndex(([t]) => $(t).getAttribute('aria-selected') === 'true');
    const n = reiter[(i + (e.key === 'ArrowRight' ? 1 : reiter.length - 1)) % reiter.length][0];
    waehle(n);
    $(n).focus();
  });

  /* ---------- Plattform-Übersicht ---------- */
  function karte(p) {
    const knoepfe = [];
    if (p.links.gast) knoepfe.push(h('a', { class: 'knopf gold klein', href: p.links.gast }, 'Gastmodus'));
    if (p.links.themen) knoepfe.push(h('a', { class: 'knopf hell klein', href: p.links.themen }, 'Themen'));
    knoepfe.push(h('a', { class: 'knopf hell klein', href: p.links.start }, p.vorlaeufig ? 'Zur Plattform' : 'Öffnen'));
    const u = p.umfang || {};
    const zahl = (n, wort) => (Number.isInteger(n) && n > 0 ? h('span', null, h('b', null, n), wort) : null);
    return h(
      'article',
      { class: 'karte plattform' + (p.vorlaeufig ? ' vorlaeufig' : ''), style: { '--pf': p.farbe } },
      h(
        'div',
        { class: 'plattform-kopf', style: { '--pf-text': textFarbe(p.farbe) } },
        h('div', { class: 'zeichen', 'aria-hidden': 'true' }, kuerzel(p.name)),
        h('h3', null, p.name),
        h('div', { class: 'feld-thema' }, p.themenfeld),
        h('span', { class: 'status chip glas' }, p.vorlaeufig ? 'demnächst im Verbund' : p.sso ? '✓ Login über InfoLabs' : 'eigene Anmeldung')
      ),
      h(
        'div',
        { class: 'inhalt' },
        p.titel && p.titel !== p.name ? h('p', { class: 'untertitel' }, p.titel) : null,
        h('p', { class: 'beschreibung' }, p.beschreibung || ''),
        h('div', { class: 'umfang' }, zahl(u.welten, ' Welten'), zahl(u.level, ' Level'), zahl(u.aufgaben, ' Aufgaben'), zahl(u.bosse, ' Bosse')),
        p.kurs ? h('p', { class: 'klein leise' }, p.kurs) : null,
        h('div', { class: 'aktionen' }, knoepfe)
      )
    );
  }

  /** Platzhalter für kommende Labs (der Verbund wächst). */
  function baldKarte() {
    return h('div', { class: 'karte plattform bald' }, h('div', null, h('p', { class: 'vorzeile' }, 'Demnächst'), h('h3', null, 'Weitere Labs'), h('p', { class: 'leise klein' }, 'Für jedes Themenfeld der Oberstufe entsteht ein eigenes Lab – mit demselben Login.')));
  }

  /** Netz: InfoLabs in der Mitte, die Plattformen als farbige Knoten im Bogen, freie Plätze gestrichelt. */
  function zeichneNetz(liste) {
    const ziel = $('netz');
    if (!ziel) return;
    const B = 560;
    const H = 220;
    const mx = B / 2;
    const my = 128;
    const plaetze = Math.max(5, liste.length + 2);
    const knoten = [];
    for (let i = 0; i < plaetze; i++) {
      const w = Math.PI * (1.08 + (0.84 * i) / (plaetze - 1)); // Bogen über der Mitte
      knoten.push({ x: mx + Math.cos(w) * 220, y: my + Math.sin(w) * 92 + 6, p: null });
    }
    // Plattformen mittig im Bogen verteilen
    const start = Math.floor((plaetze - liste.length) / 2);
    liste.forEach((p, i) => (knoten[start + i].p = p));
    const kanten = knoten.map((k) => svg('line', { class: 'kante' + (k.p ? '' : ' leer'), x1: mx, y1: my, x2: k.x, y2: k.y }));
    const ringe = [svg('ellipse', { class: 'ring', cx: mx, cy: my + 6, rx: 220, ry: 92 })];
    const punkte = knoten.map((k) => {
      if (!k.p) return svg('circle', { class: 'knoten-leer', cx: k.x, cy: k.y, r: 13 });
      const a = svg('g', null); // nur Bild (aria-hidden) – die Links stehen in den Kacheln darunter
      a.appendChild(svg('circle', { class: 'knoten-kreis', cx: k.x, cy: k.y, r: 23, fill: k.p.farbe }));
      a.appendChild(svg('text', { class: 'knoten-text', x: k.x, y: k.y + 1, fill: textFarbe(k.p.farbe) }, kuerzel(k.p.name)));
      a.appendChild(svg('text', { class: 'knoten-name' + (k.p.vorlaeufig ? ' leise' : ''), x: k.x, y: k.y + 42 }, k.p.name));
      return a;
    });
    const zentrum = [
      svg('circle', { class: 'puls', cx: mx, cy: my, r: 30 }),
      svg('circle', { class: 'zentrum', cx: mx, cy: my, r: 30 }),
      svg('text', { class: 'zentrum-text', x: mx, y: my + 1 }, 'InfoLabs')
    ];
    zeige(ziel, svg('svg', { viewBox: `0 0 ${B} ${H}`, focusable: 'false' }, ringe, kanten, punkte, zentrum));
  }

  async function ladePlattformen() {
    try {
      plattformen = (await api('GET', '/api/plattformen')).plattformen;
      zeichneNetz(plattformen);
      const ziel = $('plattformen');
      if (!plattformen.length) zeige(ziel, h('p', { class: 'leise' }, 'Noch keine Plattformen eingetragen.'), baldKarte());
      else zeige(ziel, plattformen.map(karte), baldKarte());
    } catch (e) {
      zeichneNetz([]);
      zeige($('plattformen'), h('p', { class: 'leise' }, 'Die Übersicht konnte nicht geladen werden.'));
    }
  }

  /* ---------- SSO-Hinweis ---------- */
  function ssoHinweis() {
    if (!ssoParams) return;
    const p = plattformen.find((x) => x.id === ssoParams.get('plattform'));
    $('sso-plattform').textContent = p ? p.name : ssoParams.get('plattform') || 'eine Plattform';
    $('sso-abbrechen').href = '/sso/abbrechen?' + weiter.split('?')[1];
    $('sso-hinweis').hidden = false;
    document.body.classList.add('sso-modus');
    document.title = `Anmelden für ${$('sso-plattform').textContent} – InfoLabs`;
  }

  /* ---------- Beitritt ---------- */
  async function kursInfo(code) {
    const el = $('kurs-info');
    if (code.length !== 6) return (el.hidden = true);
    try {
      const k = await api('GET', '/api/kurs/' + encodeURIComponent(code));
      el.textContent = k.offen ? `Kurs: ${k.name}` : `Kurs: ${k.name} – der Beitritt ist zurzeit geschlossen.`;
      el.hidden = false;
    } catch {
      el.textContent = 'Diesen Kurscode gibt es nicht.';
      el.hidden = false;
    }
  }
  $('b-kurscode').addEventListener('input', (e) => kursInfo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));

  beimAbsenden($('form-beitreten'), async (d) => {
    const r = await api('POST', '/api/schueler/beitreten', { kurscode: d.kurscode, name: d.name });
    $('formulare').hidden = true;
    $('sso-hinweis').hidden = true;
    $('code-name').textContent = r.name;
    $('code-name2').textContent = r.name;
    $('code-kurs').textContent = r.kurs;
    $('code-wert').textContent = r.code;
    $('code-box').hidden = false;
    $('code-ok').focus();
  });
  $('code-ok').addEventListener('change', (e) => ($('code-weiter').disabled = !e.target.checked));
  $('code-weiter').addEventListener('click', () => location.assign(ziel('schueler')));

  /* ---------- Weiterlernen ---------- */
  beimAbsenden($('form-weiter'), async (d) => {
    await api('POST', '/api/schueler/anmelden', { name: d.name, code: d.code });
    location.assign(ziel('schueler'));
  });

  /* ---------- Lehrkraft ---------- */
  beimAbsenden($('form-lehrkraft'), async (d) => {
    const r = await api('POST', '/api/lehrkraft/anmelden', { email: d.email, passwort: d.passwort });
    if (r.mussPasswortAendern) {
      $('form-lehrkraft').hidden = true;
      $('registrieren').hidden = true;
      $('form-passwort').hidden = false;
      $('form-passwort').dataset.alt = d.passwort;
      $('p-neu').focus();
      return;
    }
    location.assign(ziel('lehrkraft'));
  });
  beimAbsenden($('form-passwort'), async (d, form) => {
    await api('POST', '/api/lehrkraft/passwort', { alt: form.dataset.alt, neu: d.neu });
    meldung('Passwort gespeichert.', 'gut');
    location.assign(ziel('lehrkraft'));
  });
  beimAbsenden($('form-registrieren'), async (d, form) => {
    const r = await api('POST', '/api/lehrkraft/registrieren', d);
    form.reset();
    zeige($('registrieren'), h('p', { class: 'hinweis gruen' }, r.meldung));
  });

  /* ---------- angemeldet ---------- */
  function zeigeAngemeldet() {
    $('formulare').hidden = true;
    $('angemeldet').hidden = false;
    $('angemeldet-name').textContent = sitzung.name;
    const schueler = sitzung.typ === 'schueler';
    $('angemeldet-text').textContent = schueler ? 'Du bist angemeldet.' : 'Sie sind angemeldet.';
    $('angemeldet-weiter').href = schueler ? '/schueler' : '/lehrkraft';
    $('angemeldet-weiter').textContent = schueler ? 'Zu meinen Plattformen →' : 'Zur Verwaltung →';
    if (schueler && kursParam.length === 6) {
      $('form-dazu').hidden = false;
      api('GET', '/api/kurs/' + kursParam)
        .then((k) => ($('dazu-kurs').textContent = `${k.name} (${kursParam})`))
        .catch(() => ($('form-dazu').hidden = true));
    }
  }
  beimAbsenden($('form-dazu'), async () => {
    const r = await api('POST', '/api/schueler/kurse', { kurscode: kursParam });
    meldung(`Du bist jetzt im Kurs „${r.kurs}“.`, 'gut');
    location.assign('/schueler');
  });
  // Band „Für Lehrkräfte“: Reiter öffnen (und ggf. die Anfrage aufklappen)
  for (const [id, auf] of [['lk-anmelden', false], ['lk-anfragen', true]]) {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      if (!$('formulare').hidden) {
        waehle('tab-lehrkraft');
        if (auf) $('registrieren').open = true;
      }
      $('anmelden').scrollIntoView({ behavior: 'smooth', block: 'center' });
      (auf ? $('r-name') : $('l-email')).focus({ preventScroll: true });
    });
  }
  $('angemeldet-wechseln').addEventListener('click', async () => {
    await api('POST', '/api/abmelden').catch(() => {});
    location.reload();
  });

  /* ---------- Start ---------- */
  (async () => {
    await ladePlattformen();
    ssoHinweis();
    try {
      sitzung = await api('GET', '/api/sitzung');
    } catch {
      sitzung = { typ: null };
    }
    await IL.kopfzeile(sitzung);
    if (sitzung.typ && !weiter && !(sitzung.typ === 'lehrkraft' && sitzung.mussPasswortAendern)) zeigeAngemeldet();
    else if (sitzung.typ === 'lehrkraft' && sitzung.mussPasswortAendern) {
      waehle('tab-lehrkraft');
    }
    if (kursParam && !sitzung.typ) {
      $('b-kurscode').value = kursParam;
      kursInfo(kursParam);
      $('b-name').focus();
    }
    if (location.hash === '#lehrkraft') waehle('tab-lehrkraft');
  })().catch(fehler);
})();

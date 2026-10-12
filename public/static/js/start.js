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
        h('div', { class: 'aktionen' }, knoepfe),
        niveauLeiste(p)
      )
    );
  }

  /** Niveau-Leiste unten auf der Karte: für welche Anforderungsniveaus das Lab gedacht ist (Vertrag §9). */
  function niveauLeiste(p) {
    const titel = { eA: 'erhöhtes Anforderungsniveau (Leistungskurs)', gA: 'grundlegendes Anforderungsniveau (Grundkurs)' };
    const niveaus = Array.isArray(p.niveaus) && p.niveaus.length ? p.niveaus : ['eA', 'gA'];
    return h(
      'div',
      { class: 'niveau-leiste' },
      h('span', { class: 'niveau-titel' }, 'Niveau'),
      niveaus.map((n) => h('span', { class: 'niveau niveau-' + n.toLowerCase(), title: titel[n] || n }, n)),
      h('span', { class: 'niveau-text' }, niveaus.length > 1 ? 'für Leistungs- und Grundkurs' : niveaus[0] === 'eA' ? 'für den Leistungskurs' : 'für den Grundkurs'),
      p.links && p.links.niveaus ? h('a', { class: 'niveau-link', href: p.links.niveaus }, 'Was ist für welches Niveau? →') : null
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
    const H = 230;
    const zentrum = { x: B / 2, y: 132 };
    const plaetze = Math.max(5, liste.length + 2);
    const knoten = [];
    for (let i = 0; i < plaetze; i++) {
      const w = Math.PI * (1.08 + (0.84 * i) / (plaetze - 1)); // Bogen über der Mitte
      knoten.push({ x: zentrum.x + Math.cos(w) * 220, y: zentrum.y + Math.sin(w) * 92 + 6, p: null });
    }
    const start = Math.floor((plaetze - liste.length) / 2);
    liste.forEach((p, i) => (knoten[start + i].p = p));
    const ring = svg('ellipse', { class: 'ring', cx: zentrum.x, cy: zentrum.y + 6, rx: 220, ry: 92 });
    for (const k of knoten) k.linie = svg('line', { class: 'kante' + (k.p ? '' : ' leer'), x1: zentrum.x, y1: zentrum.y, x2: k.x, y2: k.y });
    for (const k of knoten) {
      k.gruppe = svg('g', null);
      if (!k.p) k.gruppe.appendChild(svg('circle', { class: 'knoten-leer', cx: k.x, cy: k.y, r: 13 }));
      else {
        k.gruppe.appendChild(svg('circle', { class: 'knoten-kreis', cx: k.x, cy: k.y, r: 24, fill: k.p.farbe }));
        k.gruppe.appendChild(svg('text', { class: 'knoten-text', x: k.x, y: k.y + 1, fill: textFarbe(k.p.farbe) }, kuerzel(k.p.name)));
        k.gruppe.appendChild(svg('text', { class: 'knoten-name' + (k.p.vorlaeufig ? ' leise' : ''), x: k.x, y: k.y + 43 }, k.p.name));
      }
    }
    const mitte = svg(
      'g',
      { class: 'zentrum-gruppe' },
      svg('circle', { class: 'puls', cx: zentrum.x, cy: zentrum.y, r: 31 }),
      svg('circle', { class: 'zentrum', cx: zentrum.x, cy: zentrum.y, r: 31 }),
      svg('text', { class: 'zentrum-text', x: zentrum.x, y: zentrum.y + 1 }, 'InfoLabs')
    );
    const bild = svg('svg', { viewBox: `0 0 ${B} ${H}`, focusable: 'false' }, ring, knoten.map((k) => k.linie), knoten.map((k) => k.gruppe), mitte);
    zeige(ziel, bild);
    if (window.IL_EFFEKTE) IL_EFFEKTE.belebeNetz(bild, knoten, zentrum);
  }

  /** Wechselndes Themenfeld im Kopf („Gerade im Verbund: …“). */
  function wechselZeile(liste) {
    const felder = liste.map((p) => p.themenfeld).filter(Boolean);
    if (!felder.length) return;
    const el = $('wechsel');
    let i = 0;
    el.textContent = felder[0];
    $('wechsel-zeile').hidden = false;
    if (felder.length < 2 || !window.IL_EFFEKTE || IL_EFFEKTE.ruhig) return;
    setInterval(() => {
      el.classList.add('weg');
      setTimeout(() => {
        i = (i + 1) % felder.length;
        el.textContent = felder[i];
        el.classList.remove('weg');
      }, 350);
    }, 3200);
  }

  /** Kennzahlen des Verbunds (aus den Manifesten), hochzählend. */
  function kennzahlen(liste) {
    const summe = (k) => liste.reduce((s, p) => s + (p.umfang && Number.isInteger(p.umfang[k]) ? p.umfang[k] : 0), 0);
    const werte = [
      [liste.length, liste.length === 1 ? 'Lab im Verbund' : 'Labs im Verbund'],
      [summe('aufgaben'), 'geprüfte Aufgaben'],
      [summe('welten'), 'Welten'],
      [1, 'Login für alles']
    ].filter(([n]) => n > 0);
    if (werte.length < 3) return;
    const ziel = $('kennzahlen');
    zeige(ziel, werte.map(([n, t]) => h('div', { class: 'kennzahl' }, h('b', { dataset: { ziel: n } }, '0'), h('span', null, t))));
    $('kennband').hidden = false;
    for (const b of ziel.querySelectorAll('b')) {
      const n = Number(b.dataset.ziel);
      if (window.IL_EFFEKTE) IL_EFFEKTE.zaehlen(b, n);
      else b.textContent = n.toLocaleString('de-DE');
    }
  }

  async function ladePlattformen() {
    try {
      plattformen = (await api('GET', '/api/plattformen')).plattformen;
      zeichneNetz(plattformen);
      wechselZeile(plattformen);
      kennzahlen(plattformen);
      const ziel = $('plattformen');
      if (!plattformen.length) zeige(ziel, h('p', { class: 'leise' }, 'Noch keine Plattformen eingetragen.'), baldKarte());
      else zeige(ziel, plattformen.map(karte), baldKarte());
      if (window.IL_EFFEKTE) {
        for (const k of ziel.querySelectorAll('.plattform')) {
          k.classList.add('erscheinen');
          if (!k.classList.contains('bald')) IL_EFFEKTE.neigen(k);
        }
        IL_EFFEKTE.erscheinen();
      }
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
    if (window.IL_EFFEKTE) IL_EFFEKTE.konfetti();
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
  if (window.IL_EFFEKTE) {
    IL_EFFEKTE.lichtkegel(document.querySelector('.buehne'));
    IL_EFFEKTE.erscheinen();
  }
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

/* InfoLabs – Startseite: Plattform-Übersicht, Beitritt, Anmeldung (auch im SSO-Ablauf mit ?weiter=…) */
'use strict';

(() => {
  const { h, zeige, api, meldung, fehler, beimAbsenden, kuerzel } = IL;
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
    return h(
      'article',
      { class: 'karte plattform', style: { '--pf': p.farbe } },
      h('div', { class: 'band' }),
      h(
        'div',
        { class: 'inhalt' },
        h('div', { class: 'titelzeile' }, h('div', { class: 'zeichen', 'aria-hidden': 'true' }, kuerzel(p.name)), h('div', null, h('h3', null, p.name), h('div', { class: 'feld-thema' }, p.themenfeld))),
        p.titel && p.titel !== p.name ? h('p', { class: 'klein leise' }, p.titel) : null,
        h('p', { class: 'beschreibung' }, p.beschreibung || ''),
        h(
          'div',
          { class: 'marken' },
          p.kurs ? h('span', { class: 'chip grau' }, p.kurs) : null,
          p.vorlaeufig ? h('span', { class: 'chip gold' }, 'demnächst im Verbund') : p.sso ? h('span', { class: 'chip gruen' }, 'Anmeldung über InfoLabs') : h('span', { class: 'chip grau' }, 'eigene Anmeldung'),
          p.umfang && Number.isInteger(p.umfang.aufgaben) ? h('span', { class: 'chip' }, `${p.umfang.aufgaben} Aufgaben`) : null
        ),
        h('div', { class: 'aktionen' }, knoepfe)
      )
    );
  }

  async function ladePlattformen() {
    try {
      plattformen = (await api('GET', '/api/plattformen')).plattformen;
      const ziel = $('plattformen');
      if (!plattformen.length) zeige(ziel, h('p', { class: 'leise' }, 'Noch keine Plattformen eingetragen.'));
      else zeige(ziel, plattformen.map(karte));
    } catch (e) {
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

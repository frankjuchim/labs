/* InfoLabs – Schülerseite: Kurse mit ihren Plattformen („Weiter zu …“), persönlicher Code, weiterem Kurs beitreten */
'use strict';

(() => {
  const { h, zeige, api, meldung, fehler, beimAbsenden, kuerzel } = IL;
  const $ = (id) => document.getElementById(id);

  function kachel(p) {
    return h(
      'a',
      { class: 'weiter', href: p.link, style: { '--pf': p.farbe } },
      h('span', { class: 'zeichen', 'aria-hidden': 'true' }, kuerzel(p.name)),
      h('span', null, h('strong', null, `Weiter zu ${p.name}`), h('br'), h('span', { class: 'leise klein' }, p.themenfeld || p.titel || '')),
      h('span', { class: 'pfeil', 'aria-hidden': 'true' }, '→')
    );
  }

  async function laden() {
    let ich;
    try {
      ich = await api('GET', '/api/schueler/ich');
    } catch (e) {
      if (e.status === 401) return location.replace('/');
      throw e;
    }
    $('name').textContent = ich.name;
    $('code').textContent = ich.code;
    if (!ich.kurse.length) {
      zeige($('kurse'), h('p', { class: 'hinweis' }, 'Du bist in keinem Kurs. Tritt unten mit einem Kurscode bei.'));
      return;
    }
    zeige(
      $('kurse'),
      ich.kurse.map((k) =>
        h(
          'section',
          { class: 'abstand', 'aria-label': k.name },
          h('h2', null, k.name, k.lehrkraft ? h('span', { class: 'leise klein' }, ` · ${k.lehrkraft}`) : null),
          k.plattformen.length
            ? h('div', { class: 'raster' }, k.plattformen.map(kachel))
            : h('p', { class: 'hinweis' }, 'Für diesen Kurs ist noch keine Plattform freigeschaltet. Deine Lehrkraft richtet das ein.')
        )
      )
    );
  }

  $('code-zeigen').addEventListener('click', () => {
    const c = $('code');
    c.hidden = !c.hidden;
    $('code-zeigen').textContent = c.hidden ? 'Code anzeigen' : 'Code verbergen';
  });

  beimAbsenden($('form-dazu'), async (d, form) => {
    const r = await api('POST', '/api/schueler/kurse', { kurscode: d.kurscode });
    form.reset();
    meldung(`Du bist jetzt im Kurs „${r.kurs}“.`, 'gut');
    await laden();
  });

  IL.kopfzeile().then(laden).catch(fehler);
})();

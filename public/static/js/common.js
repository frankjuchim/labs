/* InfoLabs – gemeinsame Hilfsfunktionen (kein Build, Vanilla JS, keine Inline-Skripte, Texte nur als Textknoten) */
'use strict';

const IL = (() => {
  /** DOM-Element erzeugen – Texte werden immer als Textknoten eingefügt. */
  function h(tag, attrs, ...kinder) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
        } else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    anhaengen(el, kinder);
    return el;
  }

  function anhaengen(el, kinder) {
    for (const c of kinder.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  function leeren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function zeige(el, ...kinder) {
    leeren(el);
    anhaengen(el, kinder);
    return el;
  }

  async function api(methode, url, body) {
    const opts = { method: methode, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined || (methode !== 'GET' && methode !== 'DELETE')) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body === undefined ? {} : body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw Object.assign(new Error('Keine Verbindung zum Server. Bitte prüfe das Netzwerk.'), { status: 0 });
    }
    const ct = res.headers.get('content-type') || '';
    const daten = ct.includes('application/json') ? await res.json() : null;
    if (!res.ok) throw Object.assign(new Error((daten && daten.error) || `Fehler ${res.status}`), { status: res.status, daten });
    return daten;
  }

  let meldungTimer;
  function meldung(text, art = '') {
    let m = document.getElementById('meldung');
    if (!m) {
      m = h('div', { id: 'meldung', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(m);
    }
    m.textContent = text;
    m.className = art;
    m.hidden = false;
    clearTimeout(meldungTimer);
    meldungTimer = setTimeout(() => (m.hidden = true), art === 'fehler' ? 7000 : 3500);
  }
  const fehler = (e) => meldung(e && e.message ? e.message : String(e), 'fehler');

  /** Dialog: liefert Promise<boolean> bzw. bei Eingabefeld den Text (oder null). */
  function dialog({ titel, text, eingabe, wert = '', ok = 'OK', abbrechen = 'Abbrechen', gefahr = false }) {
    return new Promise((resolve) => {
      const feld = eingabe ? h('input', { type: 'text', value: wert, 'aria-label': eingabe, placeholder: eingabe }) : null;
      const d = h(
        'dialog',
        { 'aria-labelledby': 'dialog-titel' },
        h('h2', { id: 'dialog-titel' }, titel),
        text ? h('p', null, text) : null,
        feld ? h('div', { class: 'feld' }, feld) : null,
        h(
          'div',
          { class: 'zeile rechts' },
          h('button', { type: 'button', class: 'knopf hell', onclick: () => fertig(null) }, abbrechen),
          h('button', { type: 'button', class: 'knopf' + (gefahr ? ' rot' : ''), onclick: () => fertig(feld ? feld.value : true) }, ok)
        )
      );
      function fertig(w) {
        d.close();
        d.remove();
        resolve(w === null ? (feld ? null : false) : w);
      }
      d.addEventListener('cancel', (e) => {
        e.preventDefault();
        fertig(null);
      });
      if (feld) feld.addEventListener('keydown', (e) => e.key === 'Enter' && fertig(feld.value));
      document.body.appendChild(d);
      d.showModal();
      (feld || d.querySelector('.knopf:not(.hell)')).focus();
    });
  }

  async function kopieren(text, was = 'Text') {
    try {
      await navigator.clipboard.writeText(text);
      meldung(`${was} kopiert.`, 'gut');
    } catch {
      meldung('Kopieren nicht möglich – bitte markieren und kopieren.', 'fehler');
    }
  }

  function datum(iso) {
    if (!iso) return '–';
    const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE');
  }

  function zeit(iso) {
    if (!iso) return '–';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  /** Kürzel einer Plattform (z. B. „Algo Quest“ → „AQ“, „AutomatenLab“ → „AL“). */
  function kuerzel(name) {
    const w = String(name || '?').match(/[A-ZÄÖÜ][a-zäöüß]*|[a-zäöüß]+|\d+/g) || ['?'];
    return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
  }

  function formDaten(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  /** Formular absenden mit gesperrtem Knopf. */
  function beimAbsenden(form, fn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const knopf = form.querySelector('[type="submit"]');
      if (knopf) knopf.disabled = true;
      try {
        await fn(formDaten(form), form);
      } catch (err) {
        fehler(err);
      } finally {
        if (knopf) knopf.disabled = false;
      }
    });
  }

  /** Kopfzeile: angemeldet als … / Abmelden. */
  async function kopfzeile(sitzung) {
    const nav = document.getElementById('kopf-nav');
    if (!nav) return;
    const s = sitzung || (await api('GET', '/api/sitzung').catch(() => ({ typ: null })));
    if (!s.typ) return zeige(nav, h('a', { href: '/#anmelden' }, 'Anmelden'));
    zeige(
      nav,
      h('span', { class: 'wer' }, s.name),
      h('a', { href: s.typ === 'schueler' ? '/schueler' : '/lehrkraft' }, s.typ === 'schueler' ? 'Meine Plattformen' : 'Verwaltung'),
      h(
        'button',
        {
          type: 'button',
          onclick: async () => {
            await api('POST', '/api/abmelden').catch(() => {});
            location.href = '/';
          }
        },
        'Abmelden'
      )
    );
    return s;
  }

  return { h, leeren, zeige, api, meldung, fehler, dialog, kopieren, datum, zeit, kuerzel, formDaten, beimAbsenden, kopfzeile };
})();

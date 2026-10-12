/* InfoLabs – Spezialeffekte: belebtes Netz, Einblenden, 3D-Neigung, Lichtkegel, hochzählende Zahlen, Konfetti.
   Alles rein dekorativ: ohne JavaScript oder mit „reduzierter Bewegung“ bleibt die Seite vollständig nutzbar. */
'use strict';

window.IL_EFFEKTE = (() => {
  const ruhig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const zeiger = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!ruhig) document.documentElement.classList.add('effekte');
  // Sicherung: Was nach dem Laden im sichtbaren Bereich liegt, wird spätestens nach 2,5 s gezeigt.
  window.addEventListener('load', () =>
    setTimeout(() => {
      for (const e of document.querySelectorAll('.erscheinen:not(.sichtbar)')) if (e.getBoundingClientRect().top < window.innerHeight) e.classList.add('sichtbar');
    }, 2500)
  );

  /* ---------- Einblenden beim Scrollen ---------- */
  let beobachter = null;
  function erscheinen(wurzel = document) {
    const els = wurzel.querySelectorAll('.erscheinen:not(.sichtbar)');
    if (ruhig || !('IntersectionObserver' in window)) return els.forEach((e) => e.classList.add('sichtbar'));
    beobachter =
      beobachter ||
      new IntersectionObserver(
        (eintraege) => {
          for (const e of eintraege) {
            if (!e.isIntersecting) continue;
            e.target.classList.add('sichtbar');
            beobachter.unobserve(e.target);
          }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
      );
    els.forEach((e, i) => {
      e.style.setProperty('--verzoegerung', `${Math.min(i % 4, 3) * 0.08}s`);
      beobachter.observe(e);
    });
  }

  /* ---------- 3D-Neigung mit Lichtreflex ---------- */
  function neigen(el, staerke = 7) {
    if (ruhig || !zeiger || el.dataset.neigen) return;
    el.dataset.neigen = '1';
    el.classList.add('neigen');
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', `${(x - 0.5) * staerke}deg`);
      el.style.setProperty('--rx', `${(0.5 - y) * staerke}deg`);
      el.style.setProperty('--mx', `${x * 100}%`);
      el.style.setProperty('--my', `${y * 100}%`);
      el.classList.add('aktiv');
    });
    el.addEventListener('pointerleave', () => el.classList.remove('aktiv'));
  }

  /* ---------- Lichtkegel auf der Bühne ---------- */
  function lichtkegel(buehne) {
    if (ruhig || !zeiger || !buehne) return;
    buehne.addEventListener('pointermove', (e) => {
      const r = buehne.getBoundingClientRect();
      buehne.style.setProperty('--gx', `${e.clientX - r.left}px`);
      buehne.style.setProperty('--gy', `${e.clientY - r.top}px`);
    });
  }

  /* ---------- Zahlen hochzählen ---------- */
  function zaehlen(el, ziel, dauer = 1200) {
    if (ruhig) return void (el.textContent = ziel.toLocaleString('de-DE'));
    const t0 = performance.now();
    const schritt = (t) => {
      const p = Math.min(1, (t - t0) / dauer);
      el.textContent = Math.round(ziel * (1 - (1 - p) ** 3)).toLocaleString('de-DE');
      if (p < 1) requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
  }

  /* ---------- belebtes Netz: Knoten schweben, Datenpakete laufen ---------- */
  function belebeNetz(svgEl, knoten, zentrum) {
    if (ruhig || !svgEl) return;
    const NS = 'http://www.w3.org/2000/svg';
    const pakete = [];
    knoten.forEach((k, i) => {
      if (!k.p) return;
      for (let n = 0; n < 2; n++) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('class', 'paket');
        c.setAttribute('r', '3.6');
        c.setAttribute('fill', n ? k.p.farbe : '#E3B341');
        svgEl.insertBefore(c, svgEl.querySelector('.zentrum-gruppe'));
        pakete.push({ c, k, phase: (i * 0.37 + n * 0.5) % 1, hin: n === 0, tempo: 0.00022 + ((i * 7) % 5) * 0.00003 });
      }
    });
    let sichtbar = true;
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => (sichtbar = e.isIntersecting)).observe(svgEl);
    const lauf = (t) => {
      if (sichtbar) {
        for (const [i, k] of knoten.entries()) {
          const dx = Math.sin(t / 1900 + i * 1.7) * 4;
          const dy = Math.cos(t / 2300 + i * 1.3) * 5;
          k.ax = k.x + dx;
          k.ay = k.y + dy;
          k.gruppe.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
          k.linie.setAttribute('x2', k.ax.toFixed(2));
          k.linie.setAttribute('y2', k.ay.toFixed(2));
        }
        for (const p of pakete) {
          const f = (t * p.tempo + p.phase) % 1;
          const a = p.hin ? f : 1 - f;
          p.c.setAttribute('cx', (p.k.ax + (zentrum.x - p.k.ax) * a).toFixed(2));
          p.c.setAttribute('cy', (p.k.ay + (zentrum.y - p.k.ay) * a).toFixed(2));
          p.c.setAttribute('opacity', (Math.sin(Math.PI * f) * 0.95).toFixed(2));
        }
      }
      requestAnimationFrame(lauf);
    };
    requestAnimationFrame(lauf);
  }

  /* ---------- Konfetti ---------- */
  function konfetti(anzahl = 90) {
    if (ruhig) return;
    const farben = ['#1F4E79', '#548235', '#E3B341', '#B8860B', '#C00000', '#3D7AB8'];
    const huelle = document.createElement('div');
    huelle.className = 'konfetti';
    huelle.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < anzahl; i++) {
      const s = document.createElement('i');
      s.style.left = `${Math.random() * 100}%`;
      s.style.background = farben[i % farben.length];
      s.style.setProperty('--dx', `${(Math.random() - 0.5) * 260}px`);
      s.style.setProperty('--dr', `${(Math.random() - 0.5) * 1440}deg`);
      s.style.setProperty('--dauer', `${2.2 + Math.random() * 1.6}s`);
      s.style.setProperty('--start', `${Math.random() * 0.5}s`);
      if (i % 3 === 0) s.style.borderRadius = '50%';
      huelle.appendChild(s);
    }
    document.body.appendChild(huelle);
    setTimeout(() => huelle.remove(), 4800);
  }

  return { ruhig, erscheinen, neigen, lichtkegel, zaehlen, belebeNetz, konfetti };
})();

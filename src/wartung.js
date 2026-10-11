'use strict';
// Regelmäßige Aufgaben: abgelaufene Kurse löschen, Verbund-Aufträge wiederholen, Plattformen prüfen.

const STUNDE = 3600 * 1000;

function createWartung(ctx, svc) {
  let timer = null;
  let letztePruefung = 0;

  async function lauf() {
    const ergebnis = { abgelaufen: null, auftraege: 0, geprueft: 0 };
    try {
      ergebnis.abgelaufen = svc.kurse.abgelaufeneLoeschen();
      if (ergebnis.abgelaufen.kurse) ctx.log(`Wartung: ${ergebnis.abgelaufen.kurse} abgelaufene(r) Kurs(e) gelöscht.`);
    } catch (e) {
      ctx.log('Wartung (Ablauf): ' + e.message);
    }
    try {
      ergebnis.auftraege = await svc.verbund.verarbeite();
    } catch (e) {
      ctx.log('Wartung (Verbund): ' + e.message);
    }
    if (ctx.now() - letztePruefung >= 6 * STUNDE) {
      letztePruefung = ctx.now();
      try {
        ergebnis.geprueft = (await svc.plattformen.allePruefen()).length;
      } catch (e) {
        ctx.log('Wartung (Plattformen): ' + e.message);
      }
    }
    return ergebnis;
  }

  return {
    lauf,
    /** Alle 5 Minuten (Aufträge); Ablauf und Plattformprüfung laufen dabei mit. */
    start(intervallMs = 5 * 60 * 1000) {
      if (timer) return;
      setTimeout(() => lauf().catch(() => {}), 10 * 1000).unref();
      timer = setInterval(() => lauf().catch(() => {}), intervallMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = { createWartung };

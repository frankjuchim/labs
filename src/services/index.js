'use strict';
// Zusammenbau aller Dienste. ctx = { db, now(), log, portalUrl, schluessel, fetch, erlaubeHttp, verbundAutomatisch }

const { createVerbund } = require('./verbund');
const { createPlattformen } = require('./plattformen');
const { createLoeschung } = require('./loeschung');
const { createKonten } = require('./konten');
const { createKurse } = require('./kurse');
const { createSso } = require('./sso');
const { createImport } = require('./import');

function createServices(ctx) {
  const verbund = createVerbund(ctx);
  const plattformen = createPlattformen(ctx);
  const loeschung = createLoeschung(ctx, { verbund });
  const konten = createKonten(ctx, { loeschung });
  const kurse = createKurse(ctx, { konten, plattformen, verbund, loeschung });
  const sso = createSso(ctx, { konten, plattformen });
  const importe = createImport(ctx, { konten, kurse, plattformen });
  return { verbund, plattformen, loeschung, konten, kurse, sso, importe };
}

module.exports = { createServices };

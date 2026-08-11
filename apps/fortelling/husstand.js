/* =============================================================================
   Husstandsgaten.

   Kompis eier innloggingen og utsteder en signert kapsel paa .hallakompis.no.
   Her verifiseres den LOKALT med Node sin egen crypto. Ingen nettverkskall, og
   ingen avhengighet til at Kompis er oppe: er Kompis nede, virker denne appen
   fortsatt for alle som allerede har en gyldig kapsel.

   Fila er med vilje kopiert inn i hver tjeneste i stedet for aa ligge i en
   delt pakke. Tjenestene skal kunne bygges og deployes hver for seg, og dette
   er femti linjer.

   Mangler HALLAKOMPIS_SECRET, slipper alle inn. Det er bevisst: en tjeneste
   skal ikke bli utilgjengelig fordi en env-var er glemt, og det gjoer at
   lokal utvikling virker uten oppsett.
   ============================================================================= */
'use strict';

const crypto = require('crypto');

const KAPSEL = 'hallakompis_hvem';

function b64urlTilBuffer(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function lesKapsler(req) {
  const rå = req.headers.cookie || '';
  const ut = {};
  rå.split(';').forEach(function (bit) {
    const i = bit.indexOf('=');
    if (i > 0) ut[bit.slice(0, i).trim()] = decodeURIComponent(bit.slice(i + 1).trim());
  });
  return ut;
}

/** Returnerer {husstand, person, navn, rolle} eller null. */
function hvem(req) {
  const hemmelighet = process.env.HALLAKOMPIS_SECRET;
  if (!hemmelighet) return { husstand: null, person: null, navn: '', rolle: 'adult', apen: true };

  const verdi = lesKapsler(req)[KAPSEL];
  if (!verdi) return null;

  const delt = verdi.split('.');
  if (delt.length !== 2) return null;

  const forventet = crypto.createHmac('sha256', hemmelighet).update(delt[0]).digest();
  const gitt = b64urlTilBuffer(delt[1]);
  // lik lengde foerst: timingSafeEqual kaster paa ulik lengde
  if (gitt.length !== forventet.length || !crypto.timingSafeEqual(gitt, forventet)) return null;

  let data;
  try { data = JSON.parse(b64urlTilBuffer(delt[0]).toString('utf8')); } catch (e) { return null; }
  if (!data || !data.husstand || !data.utloper || data.utloper < Date.now()) return null;
  return data;
}

/**
 * Gate for en HTTP-forespoersel. Returnerer true naar den er sluppet gjennom,
 * og har da allerede svart med en henvisning til innlogging hvis ikke.
 */
function krevHusstand(req, res) {
  const d = hvem(req);
  if (d) return true;

  // Nettleseren skal til innloggingen, alt annet skal ha et aerlig 401
  const vilHaHtml = (req.headers.accept || '').indexOf('text/html') >= 0;
  if (vilHaHtml) {
    const hit = 'https://' + (req.headers.host || 'hallakompis.no') + (req.url || '/');
    res.writeHead(302, { Location: 'https://kompis.hallakompis.no/?retur=' + encodeURIComponent(hit) });
    return res.end(), false;
  }
  const kropp = JSON.stringify({ feil: 'Logg inn på hallakompis først' });
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(kropp) });
  return res.end(kropp), false;
}

module.exports = { hvem: hvem, krevHusstand: krevHusstand, KAPSEL: KAPSEL };

/* =============================================================================
   10'ern - kortspill med historikk, statistikk og faste deltakere.

   Samme form som tidtakingsappen: ingen avhengigheter, all state i én JSON-fil.
   Spillet spilles rundt ett bord, saa vi trenger ingen konfliktloesning: den
   som trykker sist vinner, og det er riktig oppfoersel naar alle sitter samme
   sted og ser samme skjerm.

   Data:
     deltakere    faste spillere, med farge som foelger dem mellom spill
     aktivtSpill  spillet som paagaar, eller null
     historikk    ferdigspilte kamper, nyeste foerst
   ============================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* Claude skriver karakterboka. Lastes defensivt: mangler pakken eller
   noekkelen, faller appen tilbake paa de haandskrevne reglene i klienten og
   fungerer akkurat som foer. Spillet skal aldri staa paa at en API henger. */
let AnthropicKlasse = null;
try {
  const mod = require('@anthropic-ai/sdk');
  AnthropicKlasse = mod.default || mod.Anthropic || mod;
} catch (e) {
  console.log('[10ern] @anthropic-ai/sdk mangler, karakterboka bruker de faste reglene');
}

const PORT = Number(process.env.PORT) || 4710;
const DATA_DIR = process.env.TIERN_DATA || path.join(__dirname, 'data');
const FIL = path.join(DATA_DIR, 'tiern.json');
const KOPI_DIR = path.join(DATA_DIR, 'kopier');
const ROT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon'
};

function tomState() {
  return {
    deltakere: [],
    aktivtSpill: null,
    historikk: [],
    innstillinger: { base: 10, zero: 5, miss: 0, slam: 50, kommentator: true },
    // {signatur, linjer:[{navn,linje}], laget} - signaturen er et avtrykk av
    // tallene, saa vi vet naar kommentarene er utdaterte
    karakterbok: null,
    // siste forkastede kamp, slik at et feiltrykk kan angres
    forkastet: null,
    versjon: 0
  };
}

let state = tomState();

function sikreMapper() {
  for (const m of [DATA_DIR, KOPI_DIR]) {
    try {
      if (!fs.existsSync(m)) fs.mkdirSync(m, { recursive: true });
    } catch (e) {
      console.error('[10ern] FEIL: får ikke opprettet datamappa ' + m + ': ' + e.message);
      process.exit(1);
    }
  }
}

function les() {
  try {
    if (fs.existsSync(FIL)) {
      const d = JSON.parse(fs.readFileSync(FIL, 'utf8'));
      if (d && Array.isArray(d.deltakere)) {
        const mal = tomState();
        for (const k of Object.keys(mal)) if (d[k] === undefined) d[k] = mal[k];
        return d;
      }
    }
  } catch (e) {
    console.error('[10ern] kunne ikke lese ' + FIL + ': ' + e.message);
  }
  return tomState();
}

/* Atomisk skriving: skriv til side, bytt inn. Da kan fila aldri bli halvveis
   skrevet om strømmen gaar midt i en runde. */
function lagre() {
  state.versjon = (state.versjon || 0) + 1;
  const midlertidig = FIL + '.tmp';
  fs.writeFileSync(midlertidig, JSON.stringify(state));
  fs.renameSync(midlertidig, FIL);
}

function taKopi() {
  try {
    const navn = 'tiern-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    fs.writeFileSync(path.join(KOPI_DIR, navn), JSON.stringify(state));
    const filer = fs.readdirSync(KOPI_DIR).filter(f => f.startsWith('tiern-')).sort();
    while (filer.length > 40) fs.unlinkSync(path.join(KOPI_DIR, filer.shift()));
  } catch (e) {}
}

function svar(res, kode, data) {
  const kropp = JSON.stringify(data);
  res.writeHead(kode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(kropp),
    'Cache-Control': 'no-store'
  });
  res.end(kropp);
}

function lesKropp(req) {
  return new Promise((ok, feil) => {
    let d = '';
    req.on('data', b => { d += b; if (d.length > 2e6) { feil(new Error('for stor')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { feil(e); } });
    req.on('error', feil);
  });
}

function serverFil(res, filnavn) {
  const full = path.join(ROT, filnavn);
  if (!full.startsWith(ROT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Fant ikke siden');
  }
  const kropp = fs.readFileSync(full);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Content-Length': kropp.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(kropp);
}

/* =============================================================================
   Karakterboka

   Én setning per spiller, med et glimt i øyet. Strukturert output brukes med
   vilje: da kan svaret ikke komme tilbake som prosa vi maa gjette oss gjennom.
   Lav effort fordi dette er korte, morsomme linjer og ikke et resonnement.
   ============================================================================= */
const KARAKTER_SCHEMA = {
  type: 'object',
  properties: {
    linjer: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          navn: { type: 'string' },
          linje: { type: 'string' }
        },
        required: ['navn', 'linje'],
        additionalProperties: false
      }
    }
  },
  required: ['linjer'],
  additionalProperties: false
};

const KARAKTER_SYSTEM = [
  'Du skriver karakterboka for et kortspill en familie spiller sammen.',
  'For hver spiller skriver du én setning på norsk bokmål, med et glimt i øyet.',
  '',
  'Du får tre slags stoff, og det beste kommer av å sy dem sammen:',
  '1. Statistikken over alle kamper.',
  '2. Hvordan siste kamp gikk.',
  '3. Kveldsnotatet: hvor de var, hva de spiste, været, humøret før og etter',
  '   målt i terningkast fra 1 til 6, og kanskje et sitat fra kvelden.',
  'Se etter forbindelsen mellom dem. Falt humøret til den som tapte? Vant noen',
  'rett etter en dårlig middag? Slikt er gull, bruk det.',
  '',
  'Regler:',
  '- Den som leder skal få høre det, med en spydighet som er varm, ikke slem.',
  '- Den som sliter skal få en ekte oppmuntring. Aldri en spydighet til den som ligger sist.',
  '- Bruk tallene og detaljene du får. Ikke finn på noe som ikke står der.',
  '- Setningen er en fortsettelse rett etter navnet. Ikke skriv navnet først.',
  '- Du kan gjerne bruke navnet inni setningen når det kler poenget.',
  '- Maks 30 ord. Ingen emoji. Ingen tankestrek, bruk komma eller punktum.',
  '- Har spilleren null kamper, si noe lunt om at han ikke har satt seg til bordet ennå.',
  '- Skriv ulike setninger. Ikke gjenta samme vits eller detalj på flere spillere.',
  '',
  'Eksempel på tonen, for en spiller som heter Jack og vinner alt:',
  '"er kongen, men selv konger kan falle. Klarer Jack å holde på tronen?"'
].join('\n');

/* Kommentatoren foelger kampen mens den paagaar. Én kort setning om det som
   nettopp skjedde, ikke en oppsummering av stillingen. */
const KOMMENTATOR_SYSTEM = [
  'Du er kommentator for et kortspill en familie spiller rundt bordet.',
  'Du får vite hva som nettopp skjedde i runden som ble ferdig.',
  '',
  'Skriv ÉN setning på norsk bokmål om akkurat den runden.',
  '',
  'Regler:',
  '- Kommenter det som nettopp skjedde, ikke stillingen generelt.',
  '- Se etter det morsomme: en som meldte høyt og bommet, en som satt musestille',
  '  på null og traff, en som tok alle stikkene, en ledelse som snudde.',
  '- Spydig er lov, men alltid varmt. Dette er familie, ikke fiender.',
  '- Bruk navn. Bruk tallene du får, ikke finn på nye.',
  '- Maks 20 ord. Ingen emoji. Ingen tankestrek.',
  '- Ikke start med "Runde X". Gå rett på det som skjedde.'
].join('\n');

async function skrivKommentar(situasjon) {
  const klient = new AnthropicKlasse();
  const m = await klient.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    system: KOMMENTATOR_SYSTEM,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { kommentar: { type: 'string' } },
          required: ['kommentar'],
          additionalProperties: false
        }
      }
    },
    messages: [{ role: 'user', content: JSON.stringify(situasjon, null, 1) }]
  });
  if (m.stop_reason === 'refusal') throw new Error('avslått');
  const tekst = m.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const data = JSON.parse(tekst);
  return String(data.kommentar || '').trim().slice(0, 200);
}

async function skrivKarakterbok(stat, sisteKamp, kveldsnotat) {
  const klient = new AnthropicKlasse();
  const svarMelding = await klient.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    system: KARAKTER_SYSTEM,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: KARAKTER_SCHEMA }
    },
    messages: [{
      role: 'user',
      content: 'Skriv én linje per spiller.\n\n' + JSON.stringify({
        statistikkOverAlleKamper: stat.map(s => ({
          navn: s.navn,
          kamper: s.kamper,
          seire: s.seire,
          seiersprosent: s.seiersProsent,
          snittpoeng: s.snitt,
          besteKamp: s.beste,
          treffprosentPaaMelding: s.treffProsent,
          riktigeNullmeldinger: s.nuller,
          slam: s.slam
        })),
        sisteKamp: sisteKamp || null,
        kveldsnotat: kveldsnotat || null
      }, null, 1)
    }]
  });

  if (svarMelding.stop_reason === 'refusal') throw new Error('avslått');

  const tekst = svarMelding.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const data = JSON.parse(tekst);
  if (!data || !Array.isArray(data.linjer)) throw new Error('uventet svarform');

  // ta bare med spillere vi faktisk spurte om, og kutt lengden
  const kjente = new Set(stat.map(s => String(s.navn)));
  return data.linjer
    .filter(l => l && kjente.has(String(l.navn)) && typeof l.linje === 'string')
    .map(l => ({ navn: String(l.navn), linje: String(l.linje).trim().slice(0, 240) }));
}

const FARGER = ['#B23A2E', '#2E6B8F', '#C0883A', '#3F6B4C', '#7A4A86', '#3A3A3A', '#8F5B2E', '#2E8F7B'];

function nyId() { return crypto.randomBytes(6).toString('hex'); }

const tjener = http.createServer(async (req, res) => {
  const sti = decodeURIComponent((req.url || '/').split('?')[0]);

  if (sti === '/health') {
    let skrivbar = false;
    try {
      const p = path.join(DATA_DIR, '.skrivetest');
      fs.writeFileSync(p, '1'); fs.unlinkSync(p); skrivbar = true;
    } catch (e) {}
    return svar(res, skrivbar ? 200 : 503, {
      ok: skrivbar, deltakere: state.deltakere.length,
      historikk: state.historikk.length, aktivtSpill: !!state.aktivtSpill,
      uptime: Math.round(process.uptime()), ts: Date.now()
    });
  }

  if (sti === '/api/tilstand') return svar(res, 200, state);

  if (req.method === 'POST') {
    let kropp;
    try { kropp = await lesKropp(req); } catch (e) { return svar(res, 400, { feil: 'ugyldig' }); }

    /* --- faste deltakere --- */
    if (sti === '/api/deltaker') {
      const navn = String(kropp.navn || '').trim().slice(0, 20);
      if (!navn) return svar(res, 400, { feil: 'Navnet mangler' });
      if (state.deltakere.some(d => d.navn.toLowerCase() === navn.toLowerCase())) {
        return svar(res, 409, { feil: navn + ' står i lista fra før' });
      }
      const brukte = state.deltakere.map(d => d.farge);
      const farge = FARGER.find(f => !brukte.includes(f)) || FARGER[state.deltakere.length % FARGER.length];
      state.deltakere.push({ id: nyId(), navn, farge, opprettet: Date.now() });
      lagre();
      return svar(res, 200, state);
    }

    if (sti === '/api/deltaker/endre') {
      const d = state.deltakere.find(x => x.id === kropp.id);
      if (!d) return svar(res, 404, { feil: 'Fant ikke deltakeren' });
      if (kropp.navn != null) d.navn = String(kropp.navn).trim().slice(0, 20) || d.navn;
      if (kropp.farge) d.farge = String(kropp.farge);
      lagre();
      return svar(res, 200, state);
    }

    if (sti === '/api/deltaker/slett') {
      const foer = state.deltakere.length;
      state.deltakere = state.deltakere.filter(x => x.id !== kropp.id);
      if (state.deltakere.length === foer) return svar(res, 404, { feil: 'Fant ikke deltakeren' });
      lagre();
      return svar(res, 200, state);
    }

    /* --- spill --- */
    if (sti === '/api/spill') {
      // hele det aktive spillet lagres som ett objekt: alle sitter rundt samme
      // bord, saa siste trykk skal vinne
      state.aktivtSpill = kropp.spill || null;
      lagre();
      return svar(res, 200, state);
    }

    if (sti === '/api/innstillinger') {
      const i = kropp.innstillinger || {};
      ['base', 'zero', 'miss', 'slam'].forEach(k => {
        if (i[k] !== undefined) state.innstillinger[k] = Number(i[k]) || 0;
      });
      if (i.kommentator !== undefined) state.innstillinger.kommentator = !!i.kommentator;
      if (state.aktivtSpill) state.aktivtSpill.scoring = Object.assign({}, state.innstillinger);
      lagre();
      return svar(res, 200, state);
    }

    /* --- kommentatoren, mens kampen pågår --- */
    if (sti === '/api/kommentator') {
      if (!AnthropicKlasse || !process.env.ANTHROPIC_API_KEY) {
        return svar(res, 503, { feil: 'Claude er ikke koblet til her.' });
      }
      if (!kropp.situasjon) return svar(res, 400, { feil: 'Ingenting å kommentere' });
      try {
        const kommentar = await skrivKommentar(kropp.situasjon);
        // Kommentaren lagres på runden av klienten, ikke her: den eier spillet.
        return svar(res, 200, { kommentar });
      } catch (e) {
        console.error('[10ern] kommentator feilet: ' + e.message);
        return svar(res, 502, { feil: 'Kommentatoren tok en pause.' });
      }
    }

    /* --- karakterboka, skrevet av Claude --- */
    if (sti === '/api/karakterbok') {
      if (!AnthropicKlasse || !process.env.ANTHROPIC_API_KEY) {
        return svar(res, 503, {
          feil: 'Claude er ikke koblet til her. Karakterboka bruker de faste kommentarene.'
        });
      }
      const stat = Array.isArray(kropp.statistikk) ? kropp.statistikk : [];
      if (!stat.length) return svar(res, 400, { feil: 'Ingen spillere å skrive om' });

      // Klienten regner ut tallene (den eier poengreglene); serveren signerer
      // dem, slik at signaturen blir den samme for de samme tallene.
      const signatur = crypto.createHash('sha256')
        .update(JSON.stringify([
          stat.map(s => [s.navn, s.kamper, s.seire, s.snitt, s.treffProsent, s.beste, s.nuller, s.slam]),
          kropp.sisteKamp || null,
          kropp.kveldsnotat || null
        ]))
        .digest('hex').slice(0, 16);

      if (!kropp.tving && state.karakterbok && state.karakterbok.signatur === signatur) {
        return svar(res, 200, state);
      }

      try {
        const linjer = await skrivKarakterbok(stat, kropp.sisteKamp, kropp.kveldsnotat);
        state.karakterbok = { signatur, linjer, laget: Date.now() };
        lagre();
        return svar(res, 200, state);
      } catch (e) {
        console.error('[10ern] karakterbok feilet: ' + e.message);
        return svar(res, 502, {
          feil: 'Claude svarte ikke denne gangen. Prøv igjen, eller bruk de faste kommentarene.'
        });
      }
    }

    if (sti === '/api/avslutt') {
      if (!state.aktivtSpill) return svar(res, 400, { feil: 'Ingen kamp å avslutte' });
      const spill = state.aktivtSpill;
      spill.avsluttet = Date.now();
      state.historikk.unshift(spill);
      if (state.historikk.length > 300) state.historikk.length = 300;
      state.aktivtSpill = null;
      taKopi();
      lagre();
      return svar(res, 200, state);
    }

    /* Forkasting legger kampen til side i stedet for å slette den, slik at et
       feiltrykk kan angres. Bare den siste beholdes. */
    if (sti === '/api/forkast') {
      if (state.aktivtSpill) {
        state.forkastet = { spill: state.aktivtSpill, tid: Date.now() };
        state.aktivtSpill = null;
        lagre();
      }
      return svar(res, 200, state);
    }

    if (sti === '/api/angre-forkast') {
      if (!state.forkastet) return svar(res, 404, { feil: 'Ingenting å angre' });
      if (state.aktivtSpill) {
        return svar(res, 409, { feil: 'En annen kamp er startet i mellomtiden' });
      }
      state.aktivtSpill = state.forkastet.spill;
      state.forkastet = null;
      lagre();
      return svar(res, 200, state);
    }

    if (sti === '/api/historikk/slett') {
      const foer = state.historikk.length;
      state.historikk = state.historikk.filter(s => String(s.created) !== String(kropp.created));
      if (state.historikk.length === foer) return svar(res, 404, { feil: 'Fant ikke kampen' });
      taKopi();
      lagre();
      return svar(res, 200, state);
    }
  }

  if (sti === '/' || sti === '/index.html') return serverFil(res, 'index.html');
  if (/^\/[\w.-]+$/.test(sti)) return serverFil(res, sti.slice(1));
  return serverFil(res, 'index.html');
});

sikreMapper();
state = les();
tjener.listen(PORT, () => {
  console.log("[10ern] kjører på http://localhost:" + PORT);
  console.log('[10ern] data: ' + FIL);
});

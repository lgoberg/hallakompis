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
    innstillinger: { base: 10, zero: 5, miss: 0, slam: 50 },
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
      if (state.aktivtSpill) state.aktivtSpill.scoring = Object.assign({}, state.innstillinger);
      lagre();
      return svar(res, 200, state);
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

    if (sti === '/api/forkast') {
      state.aktivtSpill = null;
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

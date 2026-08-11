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
const HUS = require('./husstand.js');

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
    // kamper som er lagt til side halvspilt. Treffer dere samme gjeng igjen,
    // hentes kampen fram og fortsetter der den slapp.
    parkerte: [],
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
  'Du får fire slags stoff, og det beste kommer av å sy dem sammen:',
  '1. Statistikken over alle kamper.',
  '2. Hvordan siste kamp gikk, og hva kommentatoren sa underveis.',
  '3. Kveldsnotatet: hvor de var, hva de spiste, været, humøret før og etter',
  '   målt i terningkast fra 1 til 6, og kanskje et sitat fra kvelden.',
  '4. tidligereKvelder: de forrige kveldene, hver med sitt notat og resultat.',
  'Se etter forbindelsen mellom dem. Falt humøret til den som tapte? Vant noen',
  'rett etter en dårlig middag? Slikt er gull, bruk det.',
  '',
  'LET ETTER MØNSTRE PÅ TVERS AV KVELDER. Vinner Jack hver gang det er taco,',
  'er det den morsomste linja du kan skrive. Men bare når tallene faktisk viser',
  'det: to sammentreff er tilfeldig, tre eller flere er et mønster.',
  '',
  'Du velger selv hva som er verdt å si om hver spiller, og du får overraske oss.',
  'Er det åpenbare kjedelig, ta noe annet. Finn gjerne din egen vri.',
  '',
  'Noen spillere har alder oppgitt. Alder er gøy stoff, bruk det:',
  '- Er spilleren 18 eller eldre, hører vin til bordet.',
  '- Er spilleren under 18, vanker det i beste fall en brus.',
  '- Tull med alderen når det kler poenget, både oppover og nedover.',
  '- Aldersforskjellen mellom den yngste og den eldste ved bordet er alltid verdt en spiss.',
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
  'Du kalles på to tidspunkt, og feltet "fase" sier hvilket:',
  '- meldingene er inne, stikkene er ikke spilt: ingen vet ennå hvem som får rett.',
  '  Kommenter meldingene. Er de ivrige? Feige? Melder noen null igjen?',
  '  Du skal IKKE spå fasiten som om du vet den. Du kan gjerne gjette høyt.',
  '- runden er ferdig: kommenter det som nettopp skjedde.',
  '',
  'Skriv ÉN setning på norsk bokmål.',
  '',
  'Stoffet du får, og hva det er godt for:',
  '- Runden selv: meldinger, stikk, poeng, hvem som leder.',
  '- statistikkOverAlleKamper: hvem de er over tid. Bruk dette til å sette',
  '  runden i sammenheng. "Han som aldri bommer bommet nå" er bedre enn "han bommet".',
  '- tidligereKvelder: hva som skjedde de forrige gangene, med notat om hva de',
  '  spiste, været, stedet. LET ETTER MØNSTRE PÅ TVERS AV KVELDER. Vinner Jack',
  '  hver gang det er taco, så si det. Men bare når tallene faktisk viser det:',
  '  to tilfeldige sammentreff er ikke et mønster, tre eller flere er.',
  '- notatOmDagen: hvor de er akkurat i kveld, hva de spiser, humøret.',
  '- alder: er spilleren 18 eller eldre hører vin til bordet, er spilleren under',
  '  18 vanker det i beste fall en brus.',
  '',
  'Variasjon er det viktigste kravet:',
  '- alleredeSagt er alt du har sagt før. Ikke gjenta en formulering, en vits',
  '  eller en vinkling som står der. Ikke gjenbruk åpningsordet ditt heller.',
  '- Bytt register fra gang til gang. Du kan være tørr sportskommentator, du kan',
  '  snakke direkte til én spiller, du kan trekke fram noe fra en tidligere kveld,',
  '  du kan la deg rive med, du kan si noe stillferdig.',
  '',
  'Du velger selv. Du får overraske oss:',
  '- Du bestemmer hva som er verdt å si. Er det åpenbare kjedelig, ta noe annet:',
  '  en detalj fra notatet, et mønster ingen har lagt merke til, en spissformulering',
  '  om en som har vært stille lenge.',
  '- Finn gjerne på din egen vri. Det er lov å være rar en gang iblant.',
  '',
  'Regler:',
  '- Spydig er lov, men alltid varmt. Dette er familie, ikke fiender.',
  '- Bruk navn. Bruk tallene du får, ikke finn på nye.',
  '- Maks 25 ord. Ingen emoji. Ingen tankestrek.',
  '- Ikke start med "Runde X". Gå rett på saken.'
].join('\n');

async function skrivKommentar(situasjon) {
  const klient = new AnthropicKlasse();
  const m = await klient.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    system: KOMMENTATOR_SYSTEM,
    output_config: {
      // medium, ikke low: han skal lete etter en vinkling og et moenster paa
      // tvers av kvelder, ikke ta den foerste setningen som melder seg
      effort: 'medium',
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

async function skrivKarakterbok(stat, sisteKamp, kveldsnotat, tidligereKvelder) {
  const klient = new AnthropicKlasse();
  const svarMelding = await klient.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    system: KARAKTER_SYSTEM,
    output_config: {
      // moenstre paa tvers av kvelder krever at han faktisk leter
      effort: 'medium',
      format: { type: 'json_schema', schema: KARAKTER_SCHEMA }
    },
    messages: [{
      role: 'user',
      content: 'Skriv én linje per spiller.\n\n' + JSON.stringify({
        statistikkOverAlleKamper: stat.map(s => ({
          navn: s.navn,
          alder: s.alder != null ? s.alder : undefined,
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
        kveldsnotat: kveldsnotat || null,
        tidligereKvelder: tidligereKvelder || []
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

/* Fodselsaar er frivillig: tomt felt betyr «ikke oppgitt», ikke aar null.
   Alt utenfor et troverdig spenn kastes, saa en slurvefeil ikke gir Claude
   en 400 aar gammel spiller aa tulle med. */
function reinFodselsaar(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Math.round(Number(v));
  const iAar = new Date().getFullYear();
  if (!Number.isFinite(n) || n < 1900 || n > iAar) return null;
  return n;
}

const tjener = http.createServer(async (req, res) => {
  const sti = decodeURIComponent((req.url || '/').split('?')[0]);

  // /health maa svare uten innlogging, ellers tror Northflank at appen er nede
  if (sti !== '/health' && !HUS.krevHusstand(req, res)) return;

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
      state.deltakere.push({
        id: nyId(), navn, farge,
        fodselsaar: reinFodselsaar(kropp.fodselsaar),
        opprettet: Date.now()
      });
      lagre();
      return svar(res, 200, state);
    }

    if (sti === '/api/deltaker/endre') {
      const d = state.deltakere.find(x => x.id === kropp.id);
      if (!d) return svar(res, 404, { feil: 'Fant ikke deltakeren' });
      if (kropp.navn != null) d.navn = String(kropp.navn).trim().slice(0, 20) || d.navn;
      if (kropp.farge) d.farge = String(kropp.farge);
      if ('fodselsaar' in kropp) d.fodselsaar = reinFodselsaar(kropp.fodselsaar);
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

    /* --- les opp ---
       Samme form som TTS-proxyen i api-appen: ElevenLabs, mp3 tilbake, og 501
       naar noekkelen mangler saa klienten kan falle tilbake paa nettleserens
       egen stemme i stedet for aa staa der stum. */
    if (sti === '/api/les-opp') {
      const noekkel = process.env.ELEVENLABS_API_KEY;
      const stemme = process.env.ELEVENLABS_VOICE_ID;
      const modell = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
      if (!noekkel || !stemme) {
        return svar(res, 501, { feil: 'Stemmen er ikke satt opp her', fallback: 'nettleser' });
      }
      const tekst = String(kropp.tekst || '').trim().slice(0, 4000);
      if (!tekst) return svar(res, 400, { feil: 'Ingen tekst å lese' });

      try {
        const opp = await fetch(
          'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(stemme) + '/stream',
          {
            method: 'POST',
            headers: { 'xi-api-key': noekkel, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify({
              text: tekst,
              model_id: modell,
              output_format: 'mp3_44100_128',
              // lav stabilitet gir mer liv i stemmen: den faar lov til aa
              // smile og legge trykk der teksten inviterer til det
              voice_settings: {
                stability: 0.38,
                similarity_boost: 0.75,
                style: 0.55,
                use_speaker_boost: true
              }
            })
          }
        );
        if (!opp.ok) {
          const detalj = await opp.text().catch(() => '');
          console.error('[10ern] elevenlabs ' + opp.status + ': ' + detalj.slice(0, 300));
          return svar(res, 502, { feil: 'Stemmen svarte ikke', fallback: 'nettleser' });
        }
        const lyd = Buffer.from(await opp.arrayBuffer());
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': lyd.length,
          'Cache-Control': 'no-store'
        });
        return res.end(lyd);
      } catch (e) {
        console.error('[10ern] les-opp feilet: ' + e.message);
        return svar(res, 502, { feil: 'Stemmen svarte ikke', fallback: 'nettleser' });
      }
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
          stat.map(s => [s.navn, s.alder, s.kamper, s.seire, s.snitt, s.treffProsent, s.beste, s.nuller, s.slam]),
          kropp.sisteKamp || null,
          kropp.kveldsnotat || null
        ]))
        .digest('hex').slice(0, 16);

      if (!kropp.tving && state.karakterbok && state.karakterbok.signatur === signatur) {
        return svar(res, 200, state);
      }

      try {
        const linjer = await skrivKarakterbok(
          stat, kropp.sisteKamp, kropp.kveldsnotat, kropp.tidligereKvelder);
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

    /* --- parkerte kamper ---
       Én kamp kan være aktiv om gangen, men flere kan ligge halvspilte. Derfor
       parkeres den som står i veien automatisk naar en annen hentes fram: da
       kan man aldri miste en kamp ved aa aapne en annen. */
    if (sti === '/api/parker') {
      if (!state.aktivtSpill) return svar(res, 400, { feil: 'Ingen kamp å legge til side' });
      state.aktivtSpill.parkert = Date.now();
      state.parkerte.unshift(state.aktivtSpill);
      if (state.parkerte.length > 30) state.parkerte.length = 30;
      state.aktivtSpill = null;
      lagre();
      return svar(res, 200, state);
    }

    if (sti === '/api/hent-fram') {
      const i = state.parkerte.findIndex(s => String(s.created) === String(kropp.created));
      if (i < 0) return svar(res, 404, { feil: 'Fant ikke den parkerte kampen' });
      if (state.aktivtSpill) {
        state.aktivtSpill.parkert = Date.now();
        state.parkerte.push(state.aktivtSpill);
      }
      const spill = state.parkerte.splice(i, 1)[0];
      delete spill.parkert;
      state.aktivtSpill = spill;
      lagre();
      return svar(res, 200, state);
    }

    if (sti === '/api/parkert/slett') {
      const foer = state.parkerte.length;
      state.parkerte = state.parkerte.filter(s => String(s.created) !== String(kropp.created));
      if (state.parkerte.length === foer) return svar(res, 404, { feil: 'Fant ikke kampen' });
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

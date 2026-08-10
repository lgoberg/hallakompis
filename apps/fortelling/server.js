/* =============================================================================
   Fortellingen - hallakompis.

   Du skriver inn noe som har skjedd, og Claude spinner en historie ut av det.
   Historien leses opp av en stemme som passer sjangeren.

   To ting styrer arkitekturen:

   1. Lyd koster penger per tegn. Derfor lagres hver opplesning som fil paa
      volumet, noekkelen er fortelling + stemme. AA hoere den samme historien
      om igjen koster ingenting, og det er hele poenget med historikken.

   2. Stemmene ligger i DATA, ikke i koden. Lars lager egne stemmer i
      ElevenLabs, og da skal de kunne kobles inn uten en deploy.
   ============================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 4720;
const ROT = __dirname;
const DATA_DIR = process.env.FORTELLING_DATA || path.join(__dirname, 'data');
const FIL = path.join(DATA_DIR, 'fortelling.json');
const LYD_DIR = path.join(DATA_DIR, 'lyd');

let AnthropicKlasse = null;
try {
  const mod = require('@anthropic-ai/sdk');
  AnthropicKlasse = mod.default || mod.Anthropic || mod;
} catch (e) {
  console.log('[fortelling] @anthropic-ai/sdk mangler, historiene kan ikke skrives');
}

/* =============================================================================
   Sjangrene

   Hver sjanger er en egen fortellerstemme, ikke bare en etikett. Teksten under
   "veiledning" gaar rett inn i systemprompten, saa den skal si noe om HVORDAN
   historien skal fortelles, ikke bare hva den skal handle om.

   "stemmer" er de fire ElevenLabs-stemmene som kler sjangeren. Alle er testet
   mot noekkelen vi bruker.
   ============================================================================= */
const SJANGRE = [
  {
    id: 'godnatt', navn: 'Godnatt', emoji: '🌙',
    kort: 'Rolig, mykt, noe å sovne til',
    veiledning: [
      'Dette er en godnatthistorie. Den skal senke pulsen, ikke heve den.',
      'Ingen fare som ikke løser seg. Ingenting som skremmer i mørket etterpå.',
      'Bruk lange, rolige setninger og myke lyder: regn, pust, noe som lukker seg.',
      'Slutten skal være en dør som lukkes forsiktig, ikke et smell.',
      'Den siste setningen skal kunne leses mens noen allerede sover.'
    ].join('\n'),
    stemmer: ['XrExE9yKIg1WjnnlVkGX', '21m00Tcm4TlvDq8ikWAM', 'JBFqnCBsd6RMkjVDRZzb', 'pFZP5JQG7iQjIQuC4Bku']
  },
  {
    id: 'spennende', navn: 'Spennende', emoji: '⚡',
    kort: 'Driv, fare og en løsning',
    veiledning: [
      'Dette er en spenningshistorie. Noe står på spill fra første avsnitt.',
      'Korte setninger når det brenner. Lengre når de puster ut.',
      'Bygg mot ett vendepunkt der det ser svartest ut, og la løsningen komme',
      'av noe som allerede er nevnt, aldri av en tilfeldighet fra ingensteds.',
      'Det skal gå bra til slutt, men det skal koste noe.'
    ].join('\n'),
    stemmer: ['TxGEqnHWrfWFTfGW9XjX', 'nPczCjzI2devNBz1zQrb', 'AZnzlk1XvdvUeBnXmlld', 'cgSgspJ2msm6clMCkdW9']
  },
  {
    id: 'skummel', navn: 'Skummel', emoji: '🕯️',
    kort: 'Grøss, men til å leve med',
    veiledning: [
      'Dette er en grøsser. Den skal krype, ikke sjokkere.',
      'Det skumleste er det du ikke beskriver: lyden i etasjen over, døra som',
      'sto åpen, noe som er flyttet litt på siden i går.',
      'Ingen blod, ingen vold, ingen dør. Dette skal kunne leses høyt i en familie.',
      'Avslutt med noe uforklart som blir hengende, men ikke med en trussel',
      'mot noen som lytter.'
    ].join('\n'),
    stemmer: ['N2lVS1w4EtoT3dr4eOWO', 'pqHfZKP75CvOlQylNhV4', 'XB0fDUnXU5powFXDhCwa', 'pNInz6obpgDQGcFmaJgB']
  },
  {
    id: 'fantasi', navn: 'Fantasi', emoji: '✨',
    kort: 'Det hverdagslige har et hemmelig liv',
    veiledning: [
      'Dette er en fantasihistorie. Ta det som faktisk skjedde og la det ha en',
      'hemmelig underside: katter med krefter, en kjeller som er større inni,',
      'en nabo som ikke er en nabo.',
      'Regelen er at magien skal ha sine egne regler, og de skal holde hele veien.',
      'Vær villig til å gå langt. Det er her du får lov til å finne på mest.',
      'La det hverdagslige stå igjen litt forandret til slutt.'
    ].join('\n'),
    stemmer: ['pqHfZKP75CvOlQylNhV4', 'XB0fDUnXU5powFXDhCwa', 'XrExE9yKIg1WjnnlVkGX', 'ErXwobaYiN019PkySvjV']
  },
  {
    id: 'morsom', navn: 'Morsom', emoji: '🎈',
    kort: 'Tull, tøys og en som tar seg vann over hodet',
    veiledning: [
      'Dette er en morsom historie. Humoren ligger i at noen tar en liten ting',
      'altfor alvorlig, og at det eskalerer med full logikk hele veien.',
      'Overdriv gjerne, men vær aldri slem mot noen som finnes på ekte.',
      'En god vits til slutt er bedre enn fem underveis.'
    ].join('\n'),
    stemmer: ['IKne3meq5aSn9XLyUdCD', 'cgSgspJ2msm6clMCkdW9', 'bIHbv24MWmeRgasZH58o', 'AZnzlk1XvdvUeBnXmlld']
  },
  {
    id: 'varm', navn: 'Varm', emoji: '🫖',
    kort: 'Nær, ekte og god å sitte i',
    veiledning: [
      'Dette er en varm historie. Ingen fare, ingen magi, ingen vits på slutten.',
      'Den skal handle om noe lite som betyr mer enn det ser ut til.',
      'Bruk sanser: lukten på kjøkkenet, lyden av noen som kommer hjem.',
      'Den skal gjøre godt uten å bli søtladen. Vær konkret, ikke rørende.'
    ].join('\n'),
    stemmer: ['XrExE9yKIg1WjnnlVkGX', 'JBFqnCBsd6RMkjVDRZzb', 'pFZP5JQG7iQjIQuC4Bku', 'cjVigY5qzO86Huf0OWal']
  },
  {
    id: 'mysterium', navn: 'Mysterium', emoji: '🔍',
    kort: 'Noe stemmer ikke, og det skal oppklares',
    veiledning: [
      'Dette er en gåte. Noe er borte, eller noe er der som ikke burde vært det.',
      'Legg ut minst tre spor underveis, og la ett av dem virke uviktig.',
      'Løsningen skal være mulig å komme fram til selv, og den skal komme',
      'av sporene du allerede har lagt ut. Aldri en løsning ut av lufta.',
      'Fortell nøkternt. Gåten er spennende nok uten hjelp.'
    ].join('\n'),
    stemmer: ['onwK4e9ZLuTAKqWW03F9', 'Xb7hH8MSUJpSbSDYk0k2', 'nPczCjzI2devNBz1zQrb', 'yoZ06aMxZJJ28mfd3POQ']
  },
  {
    id: 'eventyr', navn: 'Folkeeventyr', emoji: '🌲',
    kort: 'Norsk eventyrtone, med troll og tretall',
    veiledning: [
      'Dette er et folkeeventyr i norsk tradisjon. Tonen er Asbjørnsen og Moe:',
      'muntlig, jordnær, med tørr humor under.',
      'Bruk eventyrets former: ting skjer tre ganger, den yngste og minst lovende',
      'vinner fram, og den som skryter taper.',
      'Gjerne skog, seter, kvernkall, troll eller noe under vann.',
      'Du kan begynne med "Det var en gang", og du kan avslutte med en snurr.'
    ].join('\n'),
    stemmer: ['pqHfZKP75CvOlQylNhV4', 'XB0fDUnXU5powFXDhCwa', 'pNInz6obpgDQGcFmaJgB', '21m00Tcm4TlvDq8ikWAM']
  }
];

/* Alle stemmene vi kjenner, med et norsk kjennemerke. Lars kan legge til sine
   egne i appen; de havner i data og blir med i lista. */
const STEMMER = {
  'XrExE9yKIg1WjnnlVkGX': { navn: 'Matilda', preg: 'varm, vennlig forteller' },
  '21m00Tcm4TlvDq8ikWAM': { navn: 'Rachel', preg: 'rolig og tydelig' },
  'JBFqnCBsd6RMkjVDRZzb': { navn: 'George', preg: 'lun mannsstemme' },
  'pFZP5JQG7iQjIQuC4Bku': { navn: 'Lily', preg: 'mild og nær' },
  'TxGEqnHWrfWFTfGW9XjX': { navn: 'Josh', preg: 'ung og driftig' },
  'nPczCjzI2devNBz1zQrb': { navn: 'Brian', preg: 'dyp fortellerstemme' },
  'AZnzlk1XvdvUeBnXmlld': { navn: 'Domi', preg: 'kraftfull og bestemt' },
  'cgSgspJ2msm6clMCkdW9': { navn: 'Jessica', preg: 'livlig og uttrykksfull' },
  'N2lVS1w4EtoT3dr4eOWO': { navn: 'Callum', preg: 'hes og urovekkende' },
  'pqHfZKP75CvOlQylNhV4': { navn: 'Bill', preg: 'gammel og vis' },
  'XB0fDUnXU5powFXDhCwa': { navn: 'Charlotte', preg: 'svensk klang, myk' },
  'pNInz6obpgDQGcFmaJgB': { navn: 'Adam', preg: 'mørk og alvorlig' },
  'IKne3meq5aSn9XLyUdCD': { navn: 'Charlie', preg: 'avslappet og ledig' },
  'bIHbv24MWmeRgasZH58o': { navn: 'Will', preg: 'ung og rolig' },
  'cjVigY5qzO86Huf0OWal': { navn: 'Eric', preg: 'jevn og trygg' },
  'onwK4e9ZLuTAKqWW03F9': { navn: 'Daniel', preg: 'saklig, nesten nyhetsopplest' },
  'Xb7hH8MSUJpSbSDYk0k2': { navn: 'Alice', preg: 'klar og presis' },
  'yoZ06aMxZJJ28mfd3POQ': { navn: 'Sam', preg: 'røff i kantene' },
  'ErXwobaYiN019PkySvjV': { navn: 'Antoni', preg: 'jevn og fortellende' },
  'ikwOHnCcqQJgOoz5Wxex': { navn: 'Husstemmen', preg: 'den vi bruker ellers på hallakompis' }
};

/* Lengde i ord. Minuttanslaget er maalt, ikke gjettet: 886 ord ble 332 sekunder
   opplest, altsaa rundt 160 ord i minuttet. */
const LENGDER = [
  { id: 'kort',   navn: 'Kort',       ord: 260,  minutter: 2 },
  { id: 'middels',navn: 'Middels',    ord: 520,  minutter: 3 },
  { id: 'lang',   navn: 'Lang',       ord: 900,  minutter: 6 },
  { id: 'ekstra', navn: 'Ekstra lang',ord: 1400, minutter: 9 }
];

/* =============================================================================
   Fortelleren
   ============================================================================= */
const FORTELLER_SYSTEM = [
  'Du er en fortryllende god historieforteller. Du skriver på norsk bokmål,',
  'for en familie som skal lese historien høyt for hverandre.',
  '',
  'Du får et innspill: noe som faktisk har skjedd hos dem. Det kan være smått',
  'og hverdagslig. Jobben din er ikke å gjenfortelle det, men å spinne en',
  'historie ut av det.',
  '',
  'Slik behandler du innspillet:',
  '- Bruk de virkelige detaljene. Navn, dyr, steder, tall. De er gullet.',
  '- Men la dem bli til noe annet. "Vi har fått to kattunger" er ikke en',
  '  historie om to kattunger som spiser og sover. Det er en historie om hva',
  '  de gjør når ingen ser dem.',
  '- Er innspillet tynt, finn på desto mer. Er det rikt, følg det tettere.',
  '',
  'Håndverket, og dette er det viktigste:',
  '- Historien skal LESES HØYT. Skriv for øret. Varier setningslengden.',
  '  Lange setninger som ruller, og så en kort. Slik.',
  '- Vær konkret. "Det luktet vått ull og kaffe" slår "det var koselig".',
  '- Én ting skal snu underveis. Uten en vending er det en beskrivelse,',
  '  ikke en historie.',
  '- Ingen klisjeer. Ikke "hjertet hamret", ikke "tiden stod stille",',
  '  ikke "lite visste de".',
  '- Ikke forklar poenget til slutt. Stol på leseren.',
  '- Ingen moral på slutten. Historien er ikke en leksjon.',
  '',
  'Form:',
  '- Skriv i avsnitt, med blank linje mellom. Ingen overskrifter inni teksten.',
  '- Ingen emoji. Ingen tankestrek, bruk komma eller punktum.',
  '- Direkte tale står med anførselstegn inne i avsnittet, sammen med setningen',
  '  den hører til. Ikke bryt en setning i tre bare fordi den inneholder en replikk.',
  '- Tittelen skal være kort og lokke, ikke oppsummere.',
  '',
  'Du bestemmer selv hva historien skal handle om, hvem den følger og hvordan',
  'den ender. Overrask oss. Det er lov å være rar, og det er lov å være vakker.'
].join('\n');

const FORTELLING_SCHEMA = {
  type: 'object',
  properties: {
    tittel: { type: 'string' },
    historie: { type: 'string' }
  },
  required: ['tittel', 'historie'],
  additionalProperties: false
};

async function skrivFortelling(innspill, sjanger, lengde) {
  const klient = new AnthropicKlasse();
  const melding = [
    'Skriv én historie.',
    '',
    'SJANGER: ' + sjanger.navn,
    sjanger.veiledning,
    '',
    'LENGDE: omtrent ' + lengde.ord + ' ord. Hold deg nær dette, både over og under',
    'merkes når den leses høyt.',
    '',
    'DETTE HAR SKJEDD HOS OSS:',
    innspill
  ].join('\n');

  // strøm, ikke create: med et så høyt takt for max_tokens nekter SDK-en å
  // sende en vanlig forespørsel, fordi den kan overstige ti minutter
  const strom = klient.messages.stream({
    model: 'claude-opus-5',
    max_tokens: 32000,
    system: FORTELLER_SYSTEM,
    output_config: {
      // hoey innsats: dette er den ene tingen i appen der kvaliteten er alt
      effort: 'high',
      format: { type: 'json_schema', schema: FORTELLING_SCHEMA }
    },
    messages: [{ role: 'user', content: melding }]
  });
  const svar = await strom.finalMessage();

  if (svar.stop_reason === 'refusal') throw new Error('avslått');
  const tekst = svar.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const data = JSON.parse(tekst);
  if (!data || !data.historie) throw new Error('uventet svarform');
  return {
    tittel: String(data.tittel || 'Uten tittel').trim().slice(0, 120),
    historie: String(data.historie).trim()
  };
}

/* =============================================================================
   Opplesning

   ElevenLabs tar ikke ubegrenset tekst i én forespoersel, saa lange historier
   deles paa avsnitt. previous_text og next_text gir modellen konteksten rundt
   biten den leser, slik at tonefallet henger sammen over skjoeten.
   ============================================================================= */
const BIT_MAKS = 2200;

function delOpp(tekst) {
  const avsnitt = tekst.split(/\n\s*\n/).map(a => a.trim()).filter(Boolean);
  const biter = [];
  let naa = '';
  for (const a of avsnitt) {
    if (a.length > BIT_MAKS) {
      // et enkelt avsnitt som er for langt: del det paa setningsslutt
      if (naa) { biter.push(naa); naa = ''; }
      let rest = a;
      while (rest.length > BIT_MAKS) {
        let kutt = rest.lastIndexOf('. ', BIT_MAKS);
        if (kutt < BIT_MAKS / 2) kutt = BIT_MAKS;
        else kutt += 1;
        biter.push(rest.slice(0, kutt).trim());
        rest = rest.slice(kutt);
      }
      if (rest.trim()) naa = rest.trim();
      continue;
    }
    if ((naa + '\n\n' + a).length > BIT_MAKS) { biter.push(naa); naa = a; }
    else naa = naa ? naa + '\n\n' + a : a;
  }
  if (naa) biter.push(naa);
  return biter;
}

/* Skjøtene i lydfila, og hvorfor de må ryddes.

   Hver bit fra ElevenLabs er en komplett MP3-fil: ID3-hode først, og deretter
   en Info-ramme som sier hvor mange rammer fila har. Limer vi bitene sammen
   raa, arver den ferdige fila den FØRSTE bitens rammetall, og en sju minutters
   historie melder seg som tre. Lyden spiller hele veien, men søkelinja lyver,
   og da kan man ikke hoppe tilbake i en historie man vil høre om igjen.

   Derfor: ID3 av alle bitene unntatt den første, og Info-ramma av alle. Uten
   Info regner avspilleren lengden av filstørrelse delt på bitrate, og siden
   dette er konstant bitrate blir det riktig. */
function fjernId3(buf) {
  let start = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    // størrelsen ligger i fire synksikre byte: sju bit i hver
    const n = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    start = 10 + n;
  }
  let slutt = buf.length;
  if (slutt - start > 128 && buf.toString('latin1', slutt - 128, slutt - 125) === 'TAG') slutt -= 128;
  return buf.subarray(start, slutt);
}

/* Kaster den første ramma hvis den bare bærer et Xing/Info-hode. Den inneholder
   ingen lyd, bare telleverket vi ikke vil ha. */
function fjernInforamme(buf) {
  const vindu = buf.subarray(0, Math.min(1200, buf.length)).toString('latin1');
  let i = vindu.indexOf('Xing');
  if (i < 0) i = vindu.indexOf('Info');
  if (i < 0) return buf;
  // neste rammesynk etter taggen er starten på den første ramma med lyd i
  for (let p = i; p < buf.length - 1; p++) {
    if (buf[p] === 0xff && (buf[p + 1] & 0xe0) === 0xe0) return buf.subarray(p);
  }
  return buf;
}

async function lagLyd(tekst, stemmeId, modell) {
  const noekkel = process.env.ELEVENLABS_API_KEY;
  if (!noekkel) throw new Error('ingen ElevenLabs-nøkkel');
  const biter = delOpp(tekst);
  const deler = [];

  for (let i = 0; i < biter.length; i++) {
    const r = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(stemmeId),
      {
        method: 'POST',
        headers: { 'xi-api-key': noekkel, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: biter[i],
          model_id: modell || 'eleven_multilingual_v2',
          output_format: 'mp3_44100_128',
          previous_text: i > 0 ? biter[i - 1].slice(-500) : undefined,
          next_text: i < biter.length - 1 ? biter[i + 1].slice(0, 500) : undefined,
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true }
        })
      }
    );
    if (!r.ok) {
      const detalj = await r.text().catch(() => '');
      throw new Error('elevenlabs ' + r.status + ': ' + detalj.slice(0, 200));
    }
    const bit = Buffer.from(await r.arrayBuffer());
    deler.push(fjernInforamme(fjernId3(bit)));
  }
  return Buffer.concat(deler);
}

/* =============================================================================
   Lagring
   ============================================================================= */
let state = { fortellinger: [], egneStemmer: [], versjon: 1 };

function lesData() {
  try {
    if (fs.existsSync(FIL)) {
      const d = JSON.parse(fs.readFileSync(FIL, 'utf8'));
      if (d && Array.isArray(d.fortellinger)) state = Object.assign(state, d);
    }
  } catch (e) {
    console.error('[fortelling] klarte ikke lese data: ' + e.message);
  }
}

function lagre() {
  // skriv til side og bytt: en halvskrevet fil skal aldri kunne bli fasit
  const tmp = FIL + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FIL);
}

function nyId() { return crypto.randomBytes(6).toString('hex'); }

function klargjor() {
  for (const m of [DATA_DIR, LYD_DIR]) {
    if (!fs.existsSync(m)) fs.mkdirSync(m, { recursive: true });
  }
  fs.writeFileSync(path.join(DATA_DIR, '.skrivetest'), 'ok');
  fs.unlinkSync(path.join(DATA_DIR, '.skrivetest'));
}

/* =============================================================================
   HTTP
   ============================================================================= */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon'
};

function svar(res, kode, data) {
  const kropp = JSON.stringify(data);
  res.writeHead(kode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(kropp),
    'Cache-Control': 'no-store'
  });
  res.end(kropp);
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
    'Cache-Control': /\.html$/.test(filnavn) ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(kropp);
}

function lesKropp(req) {
  return new Promise((ok, nei) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 200000) nei(new Error('for stor')); });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { nei(e); } });
    req.on('error', nei);
  });
}

/* Alle stemmene appen kjenner: de faste, pluss Lars sine egne. */
function alleStemmer() {
  const ut = {};
  Object.keys(STEMMER).forEach(id => { ut[id] = Object.assign({ egen: false }, STEMMER[id]); });
  state.egneStemmer.forEach(s => {
    ut[s.stemmeId] = { navn: s.navn, preg: s.preg || '', egen: true, id: s.id, modell: s.modell || null };
  });
  return ut;
}

/* Sjangerens fire stemmer, med Lars sine egne foran hvis han har knyttet dem
   til sjangeren. Han skal alltid kunne overstyre vårt valg. */
function stemmerForSjanger(sjangerId) {
  const sj = SJANGRE.find(s => s.id === sjangerId);
  if (!sj) return [];
  const egne = state.egneStemmer.filter(s => (s.sjangre || []).includes(sjangerId)).map(s => s.stemmeId);
  const rest = sj.stemmer.filter(id => !egne.includes(id));
  return egne.concat(rest).slice(0, 4);
}

const tjener = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const sti = decodeURIComponent(url.pathname);

  if (sti === '/health') {
    let skrivbar = false;
    try { klargjor(); skrivbar = true; } catch (e) { /* svaret sier fra */ }
    return svar(res, skrivbar ? 200 : 503, {
      ok: skrivbar, fortellinger: state.fortellinger.length,
      claude: !!(AnthropicKlasse && process.env.ANTHROPIC_API_KEY),
      stemme: !!process.env.ELEVENLABS_API_KEY,
      uptime: Math.round(process.uptime()), ts: Date.now()
    });
  }

  // ferdig opplest lyd. Filnavnet inneholder allerede fortelling og stemme,
  // så den kan caches hardt i nettleseren.
  if (sti.startsWith('/lyd/')) {
    const navn = path.basename(sti);
    const full = path.join(LYD_DIR, navn);
    if (!/^[\w.-]+\.mp3$/.test(navn) || !fs.existsSync(full)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Fant ikke lyden');
    }
    const stat = fs.statSync(full);
    const omraade = req.headers.range;
    if (omraade) {
      // Safari ber om et byteområde før den spiller. Uten dette svaret
      // starter ikke avspillingen på iPhone.
      const m = /bytes=(\d*)-(\d*)/.exec(omraade);
      const fra = m && m[1] ? Number(m[1]) : 0;
      const til = m && m[2] ? Number(m[2]) : stat.size - 1;
      res.writeHead(206, {
        'Content-Type': 'audio/mpeg',
        'Content-Range': 'bytes ' + fra + '-' + til + '/' + stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Length': til - fra + 1,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      return fs.createReadStream(full, { start: fra, end: til }).pipe(res);
    }
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg', 'Content-Length': stat.size,
      'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable'
    });
    return fs.createReadStream(full).pipe(res);
  }

  if (sti === '/api/tilstand') {
    return svar(res, 200, {
      fortellinger: state.fortellinger,
      sjangre: SJANGRE.map(s => ({
        id: s.id, navn: s.navn, emoji: s.emoji, kort: s.kort,
        stemmer: stemmerForSjanger(s.id)
      })),
      lengder: LENGDER,
      stemmer: alleStemmer(),
      egneStemmer: state.egneStemmer,
      claude: !!(AnthropicKlasse && process.env.ANTHROPIC_API_KEY),
      stemmeKlar: !!process.env.ELEVENLABS_API_KEY
    });
  }

  if (req.method === 'POST') {
    let kropp;
    try { kropp = await lesKropp(req); } catch (e) { return svar(res, 400, { feil: 'ugyldig' }); }

    /* --- skriv en fortelling --- */
    if (sti === '/api/fortell') {
      if (!AnthropicKlasse || !process.env.ANTHROPIC_API_KEY) {
        return svar(res, 503, { feil: 'Claude er ikke koblet til her.' });
      }
      const innspill = String(kropp.innspill || '').trim().slice(0, 4000);
      if (innspill.length < 3) return svar(res, 400, { feil: 'Skriv litt om hva som har skjedd først.' });
      const sjanger = SJANGRE.find(s => s.id === kropp.sjanger) || SJANGRE[0];
      const lengde = LENGDER.find(l => l.id === kropp.lengde) || LENGDER[1];

      try {
        const f = await skrivFortelling(innspill, sjanger, lengde);
        const post = {
          id: nyId(), tittel: f.tittel, historie: f.historie,
          sjanger: sjanger.id, lengde: lengde.id, innspill,
          ord: f.historie.split(/\s+/).filter(Boolean).length,
          laget: Date.now(), lyd: {}
        };
        state.fortellinger.unshift(post);
        if (state.fortellinger.length > 400) state.fortellinger.length = 400;
        lagre();
        return svar(res, 200, { fortelling: post });
      } catch (e) {
        console.error('[fortelling] skriving feilet: ' + e.message);
        return svar(res, 502, { feil: 'Fortelleren mistet tråden. Prøv en gang til.' });
      }
    }

    /* --- les den opp ---
       Finnes lyden fra før, koster det ingenting å høre den igjen. Det er
       hele grunnen til at historikken er verdt å ha. */
    if (sti === '/api/lyd') {
      const f = state.fortellinger.find(x => x.id === kropp.id);
      if (!f) return svar(res, 404, { feil: 'Fant ikke fortellingen' });
      const stemmeId = String(kropp.stemme || '');
      const kjente = alleStemmer();
      if (!kjente[stemmeId]) return svar(res, 400, { feil: 'Ukjent stemme' });
      if (!process.env.ELEVENLABS_API_KEY) return svar(res, 501, { feil: 'Stemmen er ikke satt opp her' });

      if (f.lyd && f.lyd[stemmeId] && fs.existsSync(path.join(LYD_DIR, f.lyd[stemmeId]))) {
        return svar(res, 200, { url: '/lyd/' + f.lyd[stemmeId], fra: 'lager' });
      }
      try {
        const lyd = await lagLyd(f.tittel + '.\n\n' + f.historie, stemmeId, kjente[stemmeId].modell);
        const navn = f.id + '-' + stemmeId + '.mp3';
        fs.writeFileSync(path.join(LYD_DIR, navn), lyd);
        if (!f.lyd) f.lyd = {};
        f.lyd[stemmeId] = navn;
        lagre();
        return svar(res, 200, { url: '/lyd/' + navn, fra: 'ny' });
      } catch (e) {
        console.error('[fortelling] opplesning feilet: ' + e.message);
        return svar(res, 502, { feil: 'Stemmen svarte ikke. Prøv igjen.' });
      }
    }

    /* --- egne stemmer --- */
    if (sti === '/api/stemme') {
      const stemmeId = String(kropp.stemmeId || '').trim();
      const navn = String(kropp.navn || '').trim().slice(0, 30);
      if (!stemmeId || !navn) return svar(res, 400, { feil: 'Både navn og stemme-ID må fylles ut' });
      const finnes = state.egneStemmer.find(s => s.id === kropp.id);
      const post = finnes || { id: nyId() };
      Object.assign(post, {
        navn, stemmeId,
        preg: String(kropp.preg || '').trim().slice(0, 80),
        sjangre: Array.isArray(kropp.sjangre) ? kropp.sjangre.filter(s => SJANGRE.some(x => x.id === s)) : [],
        modell: kropp.modell ? String(kropp.modell) : null
      });
      if (!finnes) state.egneStemmer.push(post);
      lagre();
      return svar(res, 200, { ok: true });
    }

    if (sti === '/api/stemme/slett') {
      state.egneStemmer = state.egneStemmer.filter(s => s.id !== kropp.id);
      lagre();
      return svar(res, 200, { ok: true });
    }

    /* Kort prøve, så en ny stemme kan høres før den tas i bruk. */
    if (sti === '/api/stemme/prov') {
      if (!process.env.ELEVENLABS_API_KEY) return svar(res, 501, { feil: 'Stemmen er ikke satt opp her' });
      const stemmeId = String(kropp.stemmeId || '').trim();
      if (!stemmeId) return svar(res, 400, { feil: 'Mangler stemme-ID' });
      try {
        const lyd = await lagLyd(
          String(kropp.tekst || 'Det var en kveld i november, og noe rørte seg ute i hagen.').slice(0, 300),
          stemmeId, kropp.modell);
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': lyd.length, 'Cache-Control': 'no-store' });
        return res.end(lyd);
      } catch (e) {
        return svar(res, 502, { feil: 'Fikk ikke prøvd stemmen: ' + e.message.slice(0, 120) });
      }
    }

    if (sti === '/api/slett') {
      const f = state.fortellinger.find(x => x.id === kropp.id);
      if (f && f.lyd) {
        Object.values(f.lyd).forEach(navn => {
          try { fs.unlinkSync(path.join(LYD_DIR, navn)); } catch (e) { /* borte er borte */ }
        });
      }
      state.fortellinger = state.fortellinger.filter(x => x.id !== kropp.id);
      lagre();
      return svar(res, 200, { ok: true });
    }

    return svar(res, 404, { feil: 'ukjent' });
  }

  if (sti === '/' || sti === '/index.html') return serverFil(res, 'index.html');
  if (/^\/[\w.-]+$/.test(sti)) return serverFil(res, sti.slice(1));
  return serverFil(res, 'index.html');
});

try {
  klargjor();
} catch (e) {
  console.error('[fortelling] får ikke skrevet til ' + DATA_DIR + ': ' + e.message);
  console.error('[fortelling] sjekk at volumet er montert der. Avslutter.');
  process.exit(1);
}
lesData();
tjener.listen(PORT, () => {
  console.log('[fortelling] kjører på http://localhost:' + PORT);
  console.log('[fortelling] data: ' + FIL);
});

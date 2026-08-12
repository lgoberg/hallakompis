/* =============================================================================
   sykkeltid/server.js - liten server for tidtaking paa idealtid.

   Bevisste valg:
   - Ingen avhengigheter. Kun Node-innebygde moduler, slik at den starter uten
     npm install og kan kjoeres paa hva som helst med Node 18+.
   - Ett loep om gangen. Skal du kjoere to loep parallelt, kjoer to instanser
     med hver sin SYKKELTID_DATA-mappe.
   - Klienten eier tidsstemplene. Serveren stempler ALDRI selv, for da ville
     nettverkstreghet blitt en del av rundetiden. Serveren tilbyr i stedet
     /api/tid slik at postene kan stille klokkene sine mot samme tidslinje.
   - Tilstanden er liten (100 ryttere gir under 100 kB), saa hele loepet
     kringkastes ved hver endring. Enkelt slaar smart her.
   ============================================================================= */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Felles = require('./felles.js');

const PORT = Number(process.env.PORT || 4600);
const KODE = process.env.SYKKELTID_KODE || 'sykkel';
const DATA_DIR = process.env.SYKKELTID_DATA || path.join(__dirname, 'data');
const LOP_FIL = path.join(DATA_DIR, 'lop.json');
const OKT_FIL = path.join(DATA_DIR, 'okter.json');
const KOPI_DIR = path.join(DATA_DIR, 'kopier');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/* --------------------------------------------------------------- tilstand */

let lop = null;
let okter = {};              // token -> {navn, rolle, sist}
const stroemmer = new Set(); // aapne SSE-tilkoblinger

/* Uten en skrivbar datamappe kan ingenting lagres, saa vi stopper med en gang
   og sier hvorfor. Et feilmontert volum er den vanligste feilen ved utrulling,
   og en raa stacktrace i loggen hjelper ingen paa loepsdagen. */
function sikreMapper() {
  for (const m of [DATA_DIR, KOPI_DIR]) {
    try {
      if (!fs.existsSync(m)) fs.mkdirSync(m, { recursive: true });
    } catch (e) {
      console.error('[sykkeltid] FEIL: får ikke opprettet datamappa ' + m);
      console.error('[sykkeltid] ' + e.message);
      console.error('[sykkeltid] Sett SYKKELTID_DATA til en skrivbar mappe, '
        + 'eller sjekk at volumet er montert der.');
      process.exit(1);
    }
  }
  try {
    const proev = path.join(DATA_DIR, '.skrivetest');
    fs.writeFileSync(proev, 'ok');
    fs.unlinkSync(proev);
  } catch (e) {
    console.error('[sykkeltid] FEIL: datamappa ' + DATA_DIR + ' finnes, men kan ikke skrives til.');
    console.error('[sykkeltid] ' + e.message);
    process.exit(1);
  }
}

function lesLop() {
  try {
    if (fs.existsSync(LOP_FIL)) {
      const d = JSON.parse(fs.readFileSync(LOP_FIL, 'utf8'));
      if (d && Array.isArray(d.deltakere)) {
        const mal = Felles.nyttLop();
        for (const k of Object.keys(mal)) if (d[k] === undefined) d[k] = mal[k];
        return d;
      }
    }
  } catch (e) {
    console.error('[sykkeltid] klarte ikke lese lop.json:', e.message);
    // Ta vare paa den uleselige fila slik at ingenting gaar tapt for godt
    try { fs.renameSync(LOP_FIL, LOP_FIL + '.ulesbar-' + Date.now()); } catch (e2) {}
  }
  return Felles.nyttLop();
}

/* Atomisk skriving: skriv til temp og bytt inn. Da kan ikke et strømbrudd
   midt i skrivingen etterlate en halv fil. */
let skriveTimer = null;
let sisteKopi = 0;
function lagre() {
  if (skriveTimer) return;
  skriveTimer = setTimeout(() => {
    skriveTimer = null;
    skrivNa();
  }, 150);
}

function skrivNa() {
  try {
    const tekst = JSON.stringify(lop);
    const tmp = LOP_FIL + '.tmp';
    fs.writeFileSync(tmp, tekst);
    fs.renameSync(tmp, LOP_FIL);

    // rullerende kopi hvert 5. minutt, som sikkerhetsnett under loepet
    const na = Date.now();
    if (na - sisteKopi > 5 * 60 * 1000) {
      sisteKopi = na;
      const stempel = new Date(na).toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.writeFileSync(path.join(KOPI_DIR, 'lop-' + stempel + '.json'), tekst);
      ryddKopier();
    }
  } catch (e) {
    console.error('[sykkeltid] lagring feilet:', e.message);
  }
}

function ryddKopier() {
  try {
    const filer = fs.readdirSync(KOPI_DIR).filter(f => f.startsWith('lop-')).sort();
    while (filer.length > 60) fs.unlinkSync(path.join(KOPI_DIR, filer.shift()));
  } catch (e) {}
}

/* Oektene slettes for godt naar koden endres, ikke bare avvises ved
   sammenligning. Sammenligning alene er ikke nok: gaar du tilbake til en kode
   du har brukt foer, ville signaturen stemt igjen og gamle token vaaknet til
   live. Her er de borte fra fila. */
function lesOkter() {
  try {
    if (fs.existsSync(OKT_FIL)) {
      const d = JSON.parse(fs.readFileSync(OKT_FIL, 'utf8'));
      if (d && d.okter && d.signatur === kodeSignatur()) return d.okter;
    }
  } catch (e) {}
  return {};
}

function lagreOkter() {
  try {
    fs.writeFileSync(OKT_FIL, JSON.stringify({ signatur: kodeSignatur(), okter: okter }));
  } catch (e) {}
}

/* ------------------------------------------------------- sladding av tider

   Hele konkurranseformatet hviler paa at ingen kjenner sin egen runde 1-tid
   mens de sykler: vet du at foerste runde tok 5:12, sikter du deg inn paa
   5:12 i stedet for aa sykle jevnt, og idealtid er ikke lenger idealtid.

   Grensesnittet har alltid skjult tallet for utloggede, men /api/tilstand ga
   det ut raatt til hvem som helst. Det var levelig saa lenge adressen bare
   sirkulerte blant postene. Naa henger vi opp en QR som sender hvert eneste
   publikum, og dermed hver eneste rytter, til nettopp den adressen.

   Derfor: for den som ikke er logget inn, faar ryttere som ENNAA ER UTE alle
   tidsstempler satt til samme verdi. Antallet passeringer og det at de har
   startet er beholdt, saa fargene i rutenettet og tellerne stemmer. De som er
   i maal beholder tidene sine, for da er resultatet uansett offentlig og
   kunnskapen kan ikke lenger utnyttes.

   medianRunde() filtrerer paa r > 10000, saa nullrundene her forurenser ikke
   feltets median. */
function offentligLop(l) {
  const behov = Felles.passeringsBehov(l);
  const ferdig = {};
  l.deltakere.forEach(d => {
    ferdig[d.nr] = l.passeringer.filter(p => p.nr === d.nr).length >= behov;
  });
  return Object.assign({}, l, {
    deltakere: l.deltakere.map(d => ferdig[d.nr]
      ? d
      : Object.assign({}, d, { faktiskStart: d.faktiskStart == null ? null : 1 })),
    // en tid uten nummer roeper ingenting om noen enkelt rytter, men den blir
    // ogsaa vist i rutenettet, saa den beholdes
    passeringer: l.passeringer.map(p => (p.nr != null && !ferdig[p.nr])
      ? Object.assign({}, p, { tid: 1 })
      : p)
  });
}

/* ------------------------------------------------------------ kringkasting */

function kringkast() {
  const helt = 'data: ' + JSON.stringify({ type: 'tilstand', lop: lop }) + '\n\n';
  const sladdet = 'data: ' + JSON.stringify({ type: 'tilstand', lop: offentligLop(lop) }) + '\n\n';
  for (const svar of stroemmer) {
    try { svar.write(svar.sladd ? sladdet : helt); } catch (e) { stroemmer.delete(svar); }
  }
}

/* ------------------------------------------------------------------- http */

function svarJson(res, kode, data) {
  const kropp = JSON.stringify(data);
  res.writeHead(kode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(kropp),
    'Cache-Control': 'no-store'
  });
  res.end(kropp);
}

function lesKropp(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', biter => {
      data += biter;
      if (data.length > 2e6) { reject(new Error('for stor')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* Oekter bindes til koden de ble opprettet med. Da blir "bytt kode" samtidig en
   utloggingsknapp for alle enheter, som er det du trenger hvis en telefon blir
   borte paa loepsdagen. Uten dette ville et gammelt token levd videre for
   alltid, siden det valideres uavhengig av koden. */
function kodeSignatur() {
  return crypto.createHash('sha256').update(String(KODE)).digest('hex').slice(0, 16);
}

function okt(req) {
  const token = req.headers['x-okt'];
  if (!token) return null;
  const o = okter[token];
  if (!o) return null;
  if (o.kode !== kodeSignatur()) {
    delete okter[token];
    lagreOkter();
    return null;
  }
  o.sist = Date.now();
  return o;
}

function serverStatisk(req, res, filsti) {
  const full = path.join(__dirname, filsti);
  if (!full.startsWith(__dirname)) { res.writeHead(403); return res.end('nei'); }
  fs.readFile(full, (feil, data) => {
    if (feil) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Fant ikke fila'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const tjener = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const sti = url.pathname;

  // Klokkesynk. Med vilje det enkleste og raskeste endepunktet i systemet:
  // jo mindre variasjon i svartid, jo bedre blir synken.
  if (sti === '/api/tid') {
    return svarJson(res, 200, { t: Date.now() });
  }

  // Helsesjekk for plattformen. Sjekker ogsaa at datamappa faktisk lar seg
  // skrive til: et volum som er montert feil ville ellers gitt en tjeneste som
  // ser frisk ut helt til foerste rytter blir registrert.
  if (sti === '/health') {
    let skrivbar = false;
    try {
      const proev = path.join(DATA_DIR, '.skrivetest');
      fs.writeFileSync(proev, String(Date.now()));
      fs.unlinkSync(proev);
      skrivbar = true;
    } catch (e) {}
    return svarJson(res, skrivbar ? 200 : 503, {
      ok: skrivbar,
      datamappe: DATA_DIR,
      skrivbar: skrivbar,
      deltakere: lop.deltakere.length,
      passeringer: lop.passeringer.length,
      uptime: Math.round(process.uptime()),
      ts: Date.now()
    });
  }

  if (sti === '/api/logg-inn' && req.method === 'POST') {
    let kropp;
    try { kropp = await lesKropp(req); } catch (e) { return svarJson(res, 400, { feil: 'ugyldig' }); }
    const oppgitt = String(kropp.kode || '');
    // konstant tid, slik at koden ikke kan gjettes ved aa maale svartid
    const a = Buffer.from(oppgitt.padEnd(64).slice(0, 64));
    const b = Buffer.from(String(KODE).padEnd(64).slice(0, 64));
    if (!crypto.timingSafeEqual(a, b)) {
      return svarJson(res, 401, { feil: 'Feil kode' });
    }
    const token = crypto.randomBytes(18).toString('base64url');
    okter[token] = {
      navn: String(kropp.navn || 'Post').slice(0, 40),
      rolle: ['start', 'mal', 'arrangor'].includes(kropp.rolle) ? kropp.rolle : 'arrangor',
      kode: kodeSignatur(),
      sist: Date.now()
    };
    lagreOkter();
    return svarJson(res, 200, { token, okt: okter[token], serverTid: Date.now() });
  }

  // Tilstanden er lesbar uten innlogging, slik at resultatskjerm og
  // publikumslenke virker uten at noen maa dele koden. Men da maa den vaere
  // sladdet, se offentligLop().
  if (sti === '/api/tilstand') {
    return svarJson(res, 200, { lop: okt(req) ? lop : offentligLop(lop), serverTid: Date.now() });
  }

  if (sti === '/api/strom') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    const innlogget = !!okt(req);
    res.write('data: ' + JSON.stringify({
      type: 'tilstand', lop: innlogget ? lop : offentligLop(lop)
    }) + '\n\n');
    res.sladd = !innlogget;   // kringkastingen leser denne, se sendTilAlle()
    stroemmer.add(res);
    const puls = setInterval(() => {
      try { res.write(': puls\n\n'); } catch (e) {}
    }, 20000);
    req.on('close', () => { clearInterval(puls); stroemmer.delete(res); });
    return;
  }

  if (sti === '/api/hendelser' && req.method === 'POST') {
    const o = okt(req);
    if (!o) return svarJson(res, 401, { feil: 'Ikke innlogget' });

    let kropp;
    try { kropp = await lesKropp(req); } catch (e) { return svarJson(res, 400, { feil: 'ugyldig' }); }
    const inn = Array.isArray(kropp.hendelser) ? kropp.hendelser : [];

    let endret = false;
    const brukte = [];
    for (const h of inn) {
      if (!h || !h.type || !h.hid) continue;
      h.av = o.navn;
      try {
        if (Felles.brukHendelse(lop, h)) endret = true;
      } catch (e) {
        console.error('[sykkeltid] hendelse feilet:', h.type, e.message);
      }
      brukte.push(h.hid);
    }

    if (endret) {
      lop.versjon = (lop.versjon || 0) + 1;
      lagre();
      kringkast();
    }
    return svarJson(res, 200, { versjon: lop.versjon, brukte, serverTid: Date.now() });
  }

  if (sti === '/' || sti === '/index.html') return serverStatisk(req, res, 'index.html');
  if (sti === '/resultat') return serverStatisk(req, res, 'index.html');
  if (sti === '/tv') return serverStatisk(req, res, 'tv.html');
  // plakaten til aa henge opp ved maalstreken, med QR til /tv
  if (sti === '/plakat') return serverStatisk(req, res, 'plakat.html');
  if (/^\/[\w.-]+$/.test(sti)) return serverStatisk(req, res, sti.slice(1));

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Fant ikke');
});

/* ------------------------------------------------------------------ start */

sikreMapper();
lop = lesLop();
okter = lesOkter();
lagreOkter();   // stempler fila med gjeldende kode, så en kodeendring er endelig

tjener.listen(PORT, () => {
  console.log('[sykkeltid] kjører på http://localhost:' + PORT);
  console.log('[sykkeltid] innloggingskode: ' + KODE + (process.env.SYKKELTID_KODE ? '' : '  (sett SYKKELTID_KODE for å endre)'));
  console.log('[sykkeltid] data: ' + LOP_FIL);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n[sykkeltid] lagrer og avslutter');
    if (skriveTimer) clearTimeout(skriveTimer);
    skrivNa();
    process.exit(0);
  });
}

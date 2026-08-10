/* =============================================================================
   hallakompis.no - portalen.

   Med vilje like enkel som den ser ut: en statisk side servert av Node uten
   en eneste avhengighet. Den skal aldri vaere grunnen til at noe annet er
   nede, og den skal kunne staa urort i aarevis.

   Ny tjeneste legges til i TJENESTER-lista oeverst i index.html.
   ============================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4700;
const ROT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function serverFil(res, filnavn) {
  // ingen katalogtraversering: bare filer som faktisk ligger i denne mappa
  const full = path.join(ROT, filnavn);
  if (!full.startsWith(ROT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Fant ikke siden');
  }
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  // Sida endrer seg sjelden, men skal ikke ligge fast naar den foerst endres.
  const cache = filnavn === 'index.html' ? 'no-cache' : 'public, max-age=3600';
  const kropp = fs.readFileSync(full);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': kropp.length,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  res.end(kropp);
}

const tjener = http.createServer((req, res) => {
  const sti = decodeURIComponent((req.url || '/').split('?')[0]);

  if (sti === '/health') {
    const kropp = JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), ts: Date.now() });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(kropp) });
    return res.end(kropp);
  }

  if (sti === '/' || sti === '/index.html') return serverFil(res, 'index.html');
  if (/^\/[\w.-]+$/.test(sti)) return serverFil(res, sti.slice(1));

  // alt annet faller tilbake til forsida, saa en feilskrevet adresse
  // lander et fornuftig sted i stedet for paa en blank feilmelding
  return serverFil(res, 'index.html');
});

tjener.listen(PORT, () => {
  console.log('[portal] kjører på http://localhost:' + PORT);
});

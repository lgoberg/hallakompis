/* =============================================================================
   felles.js - modell, regelmotor og utregninger delt mellom server og klient.

   Hele systemet er hendelsesbasert: postene sender smaa hendelser ("start",
   "passering"), og BADE serveren og nettleseren kjoerer dem gjennom samme
   brukHendelse(). Det er grunnen til at en post kan jobbe videre uten nett:
   klienten legger hendelsen i ko, bruker den lokalt med samme regler som
   serveren ville brukt, og synkroniserer naar linja er tilbake.

   Alle hendelser er idempotente. Blir en hendelse sendt to ganger (retry etter
   daarlig dekning), gir andre gangen ingen endring.
   ============================================================================= */
(function (global, fabrikk) {
  if (typeof module === 'object' && module.exports) module.exports = fabrikk();
  else global.Felles = fabrikk();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- modell */

  function toSiffer(n) { return (n < 10 ? '0' : '') + n; }

  function iDag() {
    var d = new Date();
    return d.getFullYear() + '-' + toSiffer(d.getMonth() + 1) + '-' + toSiffer(d.getDate());
  }

  function nyttLop() {
    return {
      versjon: 0,
      navn: 'Godlia Rundt - 2026',
      dato: iDag(),
      intervallSek: 30,
      antallRunder: 2,
      antattRundeMin: 5,
      aldersgrupper: '6-9, 10-12, 13-15, 16-99',
      // 'startsted' = klokka gaar naar startposten sender rytteren ut
      // 'malstrek'  = klokka gaar fra foerste passering av tidtakerstreken
      tidtakingModus: 'startsted',
      // Tidspunktet loepet ble erklaert ferdig, eller null. Da laases rutenettet,
      // slik at et feiltrykk etter siste maalgang ikke kan endre et resultat
      // som allerede er lest opp.
      fullfort: null,
      deltakere: [],    // {nr, navn, alder, klasse, startPos, faktiskStart, status}
      passeringer: [],  // {id, tid, nr, kilde, av}
      slettede: [],     // id-er som er slettet, hindrer at retry gjenoppliver dem
      logg: []          // {tid, tekst, av}
    };
  }

  /* ------------------------------------------------------------ regelmotor */

  function finnDeltaker(lop, nr) {
    for (var i = 0; i < lop.deltakere.length; i++) if (lop.deltakere[i].nr === nr) return lop.deltakere[i];
    return null;
  }

  function finnPassering(lop, id) {
    for (var i = 0; i < lop.passeringer.length; i++) if (lop.passeringer[i].id === id) return lop.passeringer[i];
    return null;
  }

  function nesteLedigeNr(lop) {
    var n = 1;
    lop.deltakere.forEach(function (d) { if (d.nr >= n) n = d.nr + 1; });
    return n;
  }

  function renummererStartPos(lop) {
    lop.deltakere.slice()
      .sort(function (a, b) { return (a.startPos || 0) - (b.startPos || 0); })
      .forEach(function (d, i) { d.startPos = i + 1; });
  }

  function nyDeltaker(x, pos) {
    return {
      nr: Number(x.nr),
      navn: x.navn || '',
      alder: (x.alder === '' || x.alder == null) ? null : Number(x.alder),
      klasse: x.klasse || '',
      startPos: x.startPos || pos,
      faktiskStart: x.faktiskStart != null ? x.faktiskStart : null,
      status: x.status || 'OK'
    };
  }

  /* Bruker en hendelse paa lop-objektet. Muterer og returnerer true hvis noe
     faktisk endret seg (brukes til aa unngaa unoedvendige kringkastinger). */
  function brukHendelse(lop, h) {
    var d, p;

    switch (h.type) {
      case 'oppsett':
        if (lop[h.felt] === h.verdi) return false;
        lop[h.felt] = h.verdi;
        break;

      case 'settDeltakere':
        lop.deltakere = (h.liste || []).map(function (x, i) { return nyDeltaker(x, i + 1); });
        renummererStartPos(lop);
        break;

      case 'leggTilDeltakere':
        (h.liste || []).forEach(function (x) {
          var nr = Number(x.nr) || nesteLedigeNr(lop);
          while (finnDeltaker(lop, nr)) nr++;
          var kopi = {};
          for (var k in x) kopi[k] = x[k];
          kopi.nr = nr;
          lop.deltakere.push(nyDeltaker(kopi, lop.deltakere.length + 1));
        });
        renummererStartPos(lop);
        break;

      case 'endreDeltaker':
        d = finnDeltaker(lop, h.nr);
        if (!d) return false;
        if (h.felt === 'nr') {
          var nytt = Number(h.verdi);
          if (!nytt || (nytt !== h.nr && finnDeltaker(lop, nytt))) return false;
          lop.passeringer.forEach(function (x) { if (x.nr === h.nr) x.nr = nytt; });
          d.nr = nytt;
        } else {
          var verdi = h.felt === 'alder'
            ? ((h.verdi === '' || h.verdi == null) ? null : Number(h.verdi))
            : h.verdi;
          if (d[h.felt] === verdi) return false;
          d[h.felt] = verdi;
        }
        break;

      case 'slettDeltaker':
        if (!finnDeltaker(lop, h.nr)) return false;
        lop.deltakere = lop.deltakere.filter(function (x) { return x.nr !== h.nr; });
        lop.passeringer.forEach(function (x) { if (x.nr === h.nr) x.nr = null; });
        renummererStartPos(lop);
        break;

      case 'start':
        d = finnDeltaker(lop, h.nr);
        if (!d || d.faktiskStart === h.tid) return false;
        d.faktiskStart = h.tid;
        break;

      case 'angreStart':
        d = finnDeltaker(lop, h.nr);
        if (!d || d.faktiskStart == null) return false;
        d.faktiskStart = null;
        break;

      case 'passering':
        // idempotent: id-en kommer fra hendelsen, og slettede gjenopplives ikke
        if (finnPassering(lop, h.id)) return false;
        if (lop.slettede.indexOf(h.id) >= 0) return false;
        lop.passeringer.push({
          id: h.id, tid: h.tid,
          nr: (h.nr == null ? null : Number(h.nr)),
          kilde: h.kilde || 'stempel', av: h.av || ''
        });
        break;

      case 'tildel':
        p = finnPassering(lop, h.pid);
        if (!p) return false;
        var nyNr = (h.nr == null ? null : Number(h.nr));
        if (p.nr === nyNr) return false;
        p.nr = nyNr;
        break;

      case 'settTid':
        p = finnPassering(lop, h.pid);
        if (!p || p.tid === h.tid) return false;
        p.tid = h.tid;
        break;

      case 'slettPassering':
        if (lop.slettede.indexOf(h.pid) < 0) lop.slettede.push(h.pid);
        if (lop.slettede.length > 400) lop.slettede.splice(0, lop.slettede.length - 400);
        if (!finnPassering(lop, h.pid)) return false;
        lop.passeringer = lop.passeringer.filter(function (x) { return x.id !== h.pid; });
        break;

      case 'nullstill':
        var beholdt = h.beholdDeltakere ? lop.deltakere.map(function (x) {
          return {
            nr: x.nr, navn: x.navn, alder: x.alder, klasse: x.klasse,
            startPos: x.startPos, faktiskStart: null, status: 'OK'
          };
        }) : [];
        var mal = nyttLop();
        Object.keys(mal).forEach(function (k) { if (k !== 'versjon') lop[k] = mal[k]; });
        lop.navn = h.navn || lop.navn;
        lop.deltakere = beholdt;
        break;

      /* Fullfoert loep laaser rutenettet. Ikke fordi noen skal hindres, men
         fordi et uhell etter siste maalgang ellers kan endre et resultat som
         allerede er lest opp. Den kan aapnes igjen naar som helst. */
      case 'fullfor':
        lop.fullfort = h.tid || Date.now();
        break;

      case 'apne':
        lop.fullfort = null;
        break;

      default:
        return false;
    }

    lop.logg.push({ tid: h.tid || h.opprettet || 0, tekst: beskriv(h), av: h.av || '' });
    if (lop.logg.length > 400) lop.logg.splice(0, lop.logg.length - 400);
    return true;
  }

  function beskriv(h) {
    switch (h.type) {
      case 'oppsett': return 'Endret ' + h.felt + ' til ' + h.verdi;
      case 'settDeltakere': return 'Satte startliste (' + (h.liste || []).length + ' ryttere)';
      case 'leggTilDeltakere': return 'La til ' + (h.liste || []).length + ' ryttere';
      case 'endreDeltaker': return 'Endret ' + h.felt + ' for nr ' + h.nr;
      case 'slettDeltaker': return 'Slettet nr ' + h.nr;
      case 'start': return 'Start nr ' + h.nr;
      case 'angreStart': return 'Angret start nr ' + h.nr;
      case 'passering': return h.nr == null ? 'Tid uten nummer' : 'Passering nr ' + h.nr;
      case 'tildel': return h.nr == null ? 'Fjernet nummer' : 'Ga tiden til nr ' + h.nr;
      case 'settTid': return 'Justerte en tid';
      case 'slettPassering': return 'Slettet en passering';
      case 'nullstill': return h.beholdDeltakere ? 'Nullstilte tidene, beholdt startlista' : 'Nullstilte hele løpet';
      case 'fullfor': return 'Erklærte løpet fullført';
      case 'apne': return 'Åpnet løpet igjen';
      default: return h.type;
    }
  }

  /* --------------------------------------------------------------- avledet */

  function passeringerFor(lop, nr) {
    return lop.passeringer
      .filter(function (p) { return p.nr === nr; })
      .sort(function (a, b) { return a.tid - b.tid; });
  }

  function utildelte(lop) {
    return lop.passeringer
      .filter(function (p) { return p.nr == null; })
      .sort(function (a, b) { return a.tid - b.tid; });
  }

  function aktive(lop) {
    return lop.deltakere.filter(function (d) { return d.status !== 'DNS'; })
      .sort(function (a, b) { return a.startPos - b.startPos; });
  }

  /* Hvor mange passeringer trengs for aa vaere ferdig? I 'malstrek'-modus
     starter klokka paa foerste passering, saa det trengs en ekstra. */
  function passeringsBehov(lop) {
    return lop.tidtakingModus === 'malstrek' ? Number(lop.antallRunder) + 1 : Number(lop.antallRunder);
  }

  function startFor(lop, d) {
    if (lop.tidtakingModus === 'malstrek') {
      var ps = passeringerFor(lop, d.nr);
      return ps.length ? ps[0].tid : null;
    }
    return d.faktiskStart;
  }

  /* Rundetidene til en rytter, i rekkefoelge. */
  function runderFor(lop, d) {
    var ps = passeringerFor(lop, d.nr);
    var runder = [];
    if (lop.tidtakingModus === 'malstrek') {
      for (var i = 1; i < ps.length; i++) runder.push(ps[i].tid - ps[i - 1].tid);
    } else {
      if (d.faktiskStart == null) return runder;
      var forrige = d.faktiskStart;
      for (var j = 0; j < ps.length; j++) { runder.push(ps[j].tid - forrige); forrige = ps[j].tid; }
    }
    return runder;
  }

  /* Tilstanden til en rytter, som er det rutenettet farger etter.
     hvit = ikke startet, oransje = ute paa runde, lilla = ute paa siste runde,
     gronn = i maal. Ett trykk flytter rytteren ett hakk. */
  function tilstandFor(lop, d) {
    var behov = passeringsBehov(lop);
    var ps = passeringerFor(lop, d.nr);
    var malstrek = lop.tidtakingModus === 'malstrek';
    var startet = malstrek ? ps.length > 0 : d.faktiskStart != null;
    var runderTatt = malstrek ? Math.max(0, ps.length - 1) : ps.length;
    var sisteTid = ps.length ? ps[ps.length - 1].tid : (malstrek ? null : d.faktiskStart);
    var ferdig = ps.length >= behov;

    var kode;
    if (d.status === 'DNS') kode = 'dns';
    else if (d.status === 'DNF') kode = 'dnf';
    else if (!startet) kode = 'hvit';
    else if (ferdig) kode = 'gronn';
    else if (runderTatt >= Number(lop.antallRunder) - 1) kode = 'lilla';
    else kode = 'oransje';

    var nesteType = null;
    if (d.status === 'OK' && !ferdig) nesteType = (!startet && !malstrek) ? 'start' : 'passering';

    return {
      kode: kode, startet: startet, ferdig: ferdig, runderTatt: runderTatt,
      paaRunde: runderTatt + 1, sisteTid: sisteTid, nesteType: nesteType, ps: ps
    };
  }

  /* Median rundetid i feltet. Brukes til aa anslaa naar en rytter kommer
     tilbake foer vi har egne tall paa nettopp ham. Krever tre maalinger. */
  function medianRunde(lop) {
    var tider = [];
    lop.deltakere.forEach(function (d) {
      runderFor(lop, d).forEach(function (r) { if (r > 10000) tider.push(r); });
    });
    if (tider.length < 3) return null;
    tider.sort(function (a, b) { return a - b; });
    return tider[Math.floor(tider.length / 2)];
  }

  /* Naar ventes neste passering fra denne rytteren?
     Er rytteren paa siste runde, vet vi det ganske presist: hele poenget med
     idealtid er at han proever aa gjenta sin egen forrige runde. */
  function forventetNeste(lop, d, median) {
    var t = tilstandFor(lop, d);
    if (!t.nesteType || t.nesteType === 'start' || t.sisteTid == null) return null;
    var runder = runderFor(lop, d);
    var ref = runder.length ? runder[0] : (median !== undefined ? median : medianRunde(lop));
    if (ref == null) ref = Number(lop.antattRundeMin || 5) * 60000;
    return t.sisteTid + ref;
  }

  /* -------------------------------------------------------- aldersgrupper */

  /* Tolker "6-9, 10-12, 16+" til grupper. Tomt felt gir ingen grupper. */
  function alderGrupper(lop) {
    var raa = String(lop.aldersgrupper || '').split(',');
    var ut = [];
    raa.forEach(function (bit) {
      var s = bit.trim();
      if (!s) return;
      var m = s.match(/^(\d{1,3})\s*-\s*(\d{1,3})$/);
      if (m) { ut.push({ navn: m[1] + '-' + m[2] + ' år', fra: Number(m[1]), til: Number(m[2]) }); return; }
      m = s.match(/^(\d{1,3})\s*\+$/);
      if (m) { ut.push({ navn: m[1] + ' år og eldre', fra: Number(m[1]), til: 999 }); return; }
      m = s.match(/^(\d{1,3})$/);
      if (m) { ut.push({ navn: m[1] + ' år', fra: Number(m[1]), til: Number(m[1]) }); }
    });
    return ut;
  }

  function aldersgruppeFor(lop, d) {
    if (d.alder == null || isNaN(d.alder)) return '';
    var grupper = alderGrupper(lop);
    for (var i = 0; i < grupper.length; i++) {
      if (d.alder >= grupper[i].fra && d.alder <= grupper[i].til) return grupper[i].navn;
    }
    return '';
  }

  /* ------------------------------------------------------------- resultat */

  /* Resultatliste. Vinner = minst forskjell mellom rundene. Ved flere enn to
     runder summeres avviket fra runde 1. predikat filtrerer til en gruppe,
     og plasseringene regnes innenfor det utvalget. */
  function beregnResultater(lop, predikat) {
    var behov = passeringsBehov(lop);
    var antall = Number(lop.antallRunder);

    var deltakere = predikat ? lop.deltakere.filter(predikat) : lop.deltakere;

    var rader = deltakere.map(function (d) {
      var ps = passeringerFor(lop, d.nr);
      var runder = runderFor(lop, d);
      var feil = runder.some(function (r) { return r <= 0; });
      var komplett = d.status === 'OK' && ps.length >= behov && runder.length >= antall && !feil;
      var avvik = null;
      if (komplett) {
        avvik = 0;
        for (var i = 1; i < antall; i++) avvik += Math.abs(runder[i] - runder[0]);
      }
      return {
        d: d, ps: ps, runder: runder, komplett: komplett, feil: feil, avvik: avvik,
        total: runder.reduce(function (a, b) { return a + b; }, 0)
      };
    });

    var ferdige = rader.filter(function (r) { return r.komplett; })
      .sort(function (a, b) { return (a.avvik - b.avvik) || (a.total - b.total); });
    ferdige.forEach(function (r, i) { r.plass = i + 1; });

    var andre = rader.filter(function (r) { return !r.komplett; })
      .sort(function (a, b) { return a.d.nr - b.d.nr; });

    return { ferdige: ferdige, andre: andre };
  }

  /* ------------------------------------------------------------ formatering */

  function klokkeslett(ms, medTiendel) {
    if (ms == null || isNaN(ms)) return '';
    var d = new Date(ms);
    var s = toSiffer(d.getHours()) + ':' + toSiffer(d.getMinutes()) + ':' + toSiffer(d.getSeconds());
    if (medTiendel) s += '.' + Math.floor(d.getMilliseconds() / 100);
    return s;
  }

  function varighet(ms, utenTiendel) {
    if (ms == null || isNaN(ms)) return '';
    var neg = ms < 0; ms = Math.abs(ms);
    var t = Math.floor(ms / 100) % 10;
    var sek = Math.floor(ms / 1000);
    var timer = Math.floor(sek / 3600);
    var min = Math.floor((sek % 3600) / 60);
    var s = sek % 60;
    var ut = timer > 0 ? timer + ':' + toSiffer(min) + ':' + toSiffer(s) : min + ':' + toSiffer(s);
    if (!utenTiendel) ut += '.' + t;
    return (neg ? '-' : '') + ut;
  }

  function avviksTekst(ms) {
    if (ms == null || isNaN(ms)) return '';
    var fortegn = ms > 0 ? '+' : (ms < 0 ? '-' : '');
    var abs = Math.abs(ms);
    if (abs >= 60000) return fortegn + varighet(abs);
    return fortegn + (abs / 1000).toFixed(1).replace('.', ',') + ' s';
  }

  /* Kort tid til rutenettet. Underveis: runde 1, altsaa det rytteren skal
     forsoeke aa gjenta. I maal: hvor naer han kom, som er selve resultatet.
     Teksten maa vaere kort, for ruta er under seksti piksler bred.

     Verdien er STATISK: den endrer seg bare naar en passering registreres,
     aldri fra sekund til sekund. Det er grunnen til at den trygt kan staa i
     rutenettets HTML. Hadde den tikket, matte den vaert skrevet av tikk(),
     ellers ville hele rutenettet blitt bygget om under fingeren til den som
     trykker. */
  function ruteTid(lop, d) {
    if (d.status !== 'OK') return '';
    var runder = runderFor(lop, d);
    if (!runder.length) return '';
    var antall = Number(lop.antallRunder);
    if (runder.length < antall) return varighet(runder[0], true);

    if (antall === 2) return avviksTekst(runder[1] - runder[0]);
    // flere enn to runder: samlet avvik fra runde 1, uten fortegn
    var sum = 0;
    for (var i = 1; i < antall; i++) sum += Math.abs(runder[i] - runder[0]);
    return sekTekst(sum) + ' s';
  }

  function sekTekst(ms) {
    if (ms == null || isNaN(ms)) return '';
    return (ms / 1000).toFixed(1).replace('.', ',');
  }

  return {
    nyttLop: nyttLop,
    brukHendelse: brukHendelse,
    finnDeltaker: finnDeltaker,
    finnPassering: finnPassering,
    nesteLedigeNr: nesteLedigeNr,
    startFor: startFor,
    passeringerFor: passeringerFor,
    utildelte: utildelte,
    aktive: aktive,
    passeringsBehov: passeringsBehov,
    runderFor: runderFor,
    tilstandFor: tilstandFor,
    medianRunde: medianRunde,
    forventetNeste: forventetNeste,
    alderGrupper: alderGrupper,
    aldersgruppeFor: aldersgruppeFor,
    beregnResultater: beregnResultater,
    klokkeslett: klokkeslett,
    varighet: varighet,
    avviksTekst: avviksTekst,
    ruteTid: ruteTid,
    sekTekst: sekTekst,
    iDag: iDag,
    toSiffer: toSiffer
  };
});

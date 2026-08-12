/* =============================================================================
   qr.js - QR-kodegenerator uten avhengigheter.

   Appen kjoerer vanilla JS uten byggsteg og uten npm-pakker i drift, saa hele
   generatoren maa vaere ren JS som virker likt i nettleser og node.

   Begrensninger med vilje: bare byte-modus (UTF-8) og bare feilkorreksjonsnivaa
   M. Vi koder URL-er, og da gir de andre modusene ingenting: alfanumerisk
   modus tillater ikke smaa bokstaver, saa "https://sykkeltid..." maatte uansett
   ha vaert byte. Nivaa M (~15 % gjenoppretting) er balansen skannere flest er
   tunet for.

   API:
     QR.matrise(tekst)          -> 2D array [rad][kolonne] med true = moerk modul
     QR.svg(tekst, opsjoner)    -> SVG-streng
       opsjoner: {storrelse, marg, moerk, lys}

   Matrisen inneholder BARE symbolet. Den stille sonen (margen) legges paa i
   svg(); tegner du matrisen selv, maa du legge paa minst 4 moduler luft rundt,
   ellers finner ikke skanneren symbolgrensene.
   ============================================================================= */
(function (global, fabrikk) {
  if (typeof module === 'object' && module.exports) module.exports = fabrikk();
  else global.QR = fabrikk();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================================================================ tabeller

     Tallene under er fra ISO/IEC 18004. De lar seg ikke regne ut, de maa slaas
     opp. Alle tre er indeksert paa versjonsnummer (1-40), indeks 0 er ubrukt. */

  // Totalt antall kodeord (data + feilkorreksjon) i symbolet.
  var TOTALT_KODEORD = [0,
      26,   44,   70,  100,  134,  172,  196,  242,  292,  346,
     404,  466,  532,  581,  655,  733,  815,  901,  991, 1085,
    1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
    2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706];

  // Antall feilkorreksjonskodeord per blokk, nivaa M.
  var EC_PER_BLOKK = [0,
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26,
    30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28];

  // Antall feilkorreksjonsblokker, nivaa M. Store symboler deles i mange
  // blokker slik at en sammenhengende skade (fingeravtrykk, rift) rammer litt
  // av hver blokk i stedet for aa sprenge feilbudsjettet i en enkelt blokk.
  var ANTALL_BLOKKER = [0,
     1,  1,  1,  2,  2,  4,  4,  4,  5,  5,
     5,  8,  9,  9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29,
    31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  // Senterkoordinater for justeringsmoenstrene. Kryssproduktet av lista med seg
  // selv gir posisjonene; kombinasjonene som kolliderer med soekemoenstrene i
  // hjoernene hoppes over.
  var JUSTERING = [[], [],
    [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
    [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
    [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]];

  function antallDataKodeord(versjon) {
    return TOTALT_KODEORD[versjon] - EC_PER_BLOKK[versjon] * ANTALL_BLOKKER[versjon];
  }

  /* ============================================================ galois-felt

     Feilkorreksjonen er Reed-Solomon over GF(256). Multiplikasjon der er ikke
     vanlig ganging: den gjoeres via logaritmetabeller i feltet, som bygges ved
     aa gange seg oppover med 2 og redusere modulo QR-standardens primitive
     polynom x^8 + x^4 + x^3 + x^2 + 1 (0x11D) hver gang vi renner over 8 bit. */

  var EKSP = new Array(512);
  var LOGG = new Array(256);

  (function byggFelttabeller() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EKSP[i] = x;
      LOGG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    // Dobbel lengde slik at logg-summer opp til 508 kan slaas opp uten modulo.
    for (var j = 255; j < 512; j++) EKSP[j] = EKSP[j - 255];
  })();

  function gang(a, b) {
    if (a === 0 || b === 0) return 0;
    return EKSP[LOGG[a] + LOGG[b]];
  }

  // Generatorpolynomet (x - a^0)(x - a^1)...(x - a^(n-1)). Koeffisientene ligger
  // med hoeyeste grad foerst. Minus er det samme som pluss i GF(2^8).
  function generatorPolynom(antall) {
    var g = [1];
    for (var i = 0; i < antall; i++) {
      var ny = [];
      for (var k = 0; k <= g.length; k++) ny.push(0);
      for (var j = 0; j < g.length; j++) {
        ny[j] ^= g[j];                        // ledd ganget med x
        ny[j + 1] ^= gang(g[j], EKSP[i]);     // ledd ganget med a^i
      }
      g = ny;
    }
    return g;
  }

  var generatorBuffer = {};

  // Feilkorreksjonskodeordene er resten etter polynomdivisjon av datablokka
  // (loeftet n grader opp) med generatorpolynomet. Vi kjoerer det som en
  // rullende rest i stedet for aa bygge hele dividenden.
  function feilkorreksjon(data, antall) {
    var g = generatorBuffer[antall] || (generatorBuffer[antall] = generatorPolynom(antall));
    var rest = [];
    var i, j;
    for (i = 0; i < antall; i++) rest.push(0);

    for (i = 0; i < data.length; i++) {
      var faktor = data[i] ^ rest[0];
      rest.shift();
      rest.push(0);
      if (faktor !== 0) {
        for (j = 0; j < antall; j++) rest[j] ^= gang(g[j + 1], faktor);
      }
    }
    return rest;
  }

  /* ================================================================= koding */

  // Egen UTF-8-koder i stedet for TextEncoder: eldre WebView-er (kiosk-nettbrett
  // i maalomraadet) mangler den, og vi vil ikke ha en polyfill-avhengighet.
  function tilUtf8(tekst) {
    var ut = [];
    for (var i = 0; i < tekst.length; i++) {
      var c = tekst.charCodeAt(i);

      // Surrogatpar (emoji o.l.) maa settes sammen til ett kodepunkt foerst,
      // ellers blir hver halvdel kodet for seg og teksten uleselig.
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < tekst.length) {
        var lav = tekst.charCodeAt(i + 1);
        if (lav >= 0xDC00 && lav <= 0xDFFF) {
          c = 0x10000 + ((c - 0xD800) << 10) + (lav - 0xDC00);
          i++;
        }
      }

      if (c < 0x80) {
        ut.push(c);
      } else if (c < 0x800) {
        ut.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c < 0x10000) {
        ut.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      } else {
        ut.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return ut;
  }

  // Tegntelleren i byte-modus er 8 bit til og med versjon 9, deretter 16.
  function tellerBredde(versjon) {
    return versjon < 10 ? 8 : 16;
  }

  function velgVersjon(antallBytes) {
    for (var v = 1; v <= 40; v++) {
      var trengs = 4 + tellerBredde(v) + antallBytes * 8;
      if (trengs <= antallDataKodeord(v) * 8) return v;
    }
    throw new Error('QR: teksten er for lang (' + antallBytes + ' byte, maks er versjon 40 nivaa M)');
  }

  function byggDataKodeord(bytes, versjon) {
    var kapasitet = antallDataKodeord(versjon);
    var bits = [];
    var i;

    function leggTil(verdi, bredde) {
      for (var b = bredde - 1; b >= 0; b--) bits.push((verdi >> b) & 1);
    }

    leggTil(0x4, 4);                       // modusindikator for byte
    leggTil(bytes.length, tellerBredde(versjon));
    for (i = 0; i < bytes.length; i++) leggTil(bytes[i], 8);

    // Avslutter med inntil fire nuller, men bare saa mange det er plass til.
    var maksBits = kapasitet * 8;
    var terminator = Math.min(4, maksBits - bits.length);
    for (i = 0; i < terminator; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    var kodeord = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      kodeord.push(b);
    }

    // Resten fylles med de faste fyllkodeordene 236/17 annenhver gang. De er
    // valgt i standarden fordi bitmoensteret deres er "uroelig" og hjelper
    // skanneren med aa holde synk gjennom tomme omraader.
    var fyll = [0xEC, 0x11];
    var teller = 0;
    while (kodeord.length < kapasitet) kodeord.push(fyll[teller++ % 2]);

    return kodeord;
  }

  // Blokkoppdelingen: naar datamengden ikke gaar opp i antall blokker, faar de
  // siste blokkene ett kodeord ekstra. Til slutt flettes blokkene kolonnevis
  // (foerste kodeord fra hver blokk, saa andre, ...) slik at en skade i et
  // omraade fordeles utover blokkene i stedet for aa knuse en av dem.
  function byggEndeligeKodeord(data, versjon) {
    var antallBlokker = ANTALL_BLOKKER[versjon];
    var ecPerBlokk = EC_PER_BLOKK[versjon];
    var korteBlokker = antallBlokker - (data.length % antallBlokker);
    var kortLengde = Math.floor(data.length / antallBlokker);

    var dataBlokker = [];
    var ecBlokker = [];
    var pos = 0;
    var i, b;

    for (b = 0; b < antallBlokker; b++) {
      var lengde = kortLengde + (b < korteBlokker ? 0 : 1);
      var blokk = data.slice(pos, pos + lengde);
      pos += lengde;
      dataBlokker.push(blokk);
      ecBlokker.push(feilkorreksjon(blokk, ecPerBlokk));
    }

    var ut = [];
    for (i = 0; i < kortLengde + 1; i++) {
      for (b = 0; b < antallBlokker; b++) {
        if (i < dataBlokker[b].length) ut.push(dataBlokker[b][i]);
      }
    }
    for (i = 0; i < ecPerBlokk; i++) {
      for (b = 0; b < antallBlokker; b++) ut.push(ecBlokker[b][i]);
    }
    return ut;
  }

  /* =============================================== funksjonsmoenstre i rutenettet

     "Reservert" betyr modul som hoerer til et funksjonsmoenster (soekemoenster,
     tidsmoenster, justering, format- og versjonsfelt). Databitene hopper over
     dem, og masken skal ikke roere dem. */

  function nyttRutenett(storrelse) {
    var m = [];
    for (var r = 0; r < storrelse; r++) {
      var rad = [];
      for (var c = 0; c < storrelse; c++) rad.push(false);
      m.push(rad);
    }
    return m;
  }

  function settSoekemoenster(mod, res, rad, kol) {
    // 7x7 soekemoenster pluss separator: vi gaar over et 9x9-vindu og
    // klipper mot kanten, saa samme kode duger i alle tre hjoerner.
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var y = rad + r;
        var x = kol + c;
        if (y < 0 || y >= mod.length || x < 0 || x >= mod.length) continue;
        var iRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                    (c >= 0 && c <= 6 && (r === 0 || r === 6));
        var iKjerne = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        mod[y][x] = iRing || iKjerne;
        res[y][x] = true;
      }
    }
  }

  function settFunksjonsmoenstre(mod, res, versjon) {
    var storrelse = mod.length;
    var i, j;

    settSoekemoenster(mod, res, 0, 0);
    settSoekemoenster(mod, res, 0, storrelse - 7);
    settSoekemoenster(mod, res, storrelse - 7, 0);

    // Tidsmoenstre: annenhver modul langs rad 6 og kolonne 6. De gir skanneren
    // et referanserutenett saa den kan telle moduler i et skjevt bilde.
    for (i = 8; i < storrelse - 8; i++) {
      var moerk = i % 2 === 0;
      mod[6][i] = moerk; res[6][i] = true;
      mod[i][6] = moerk; res[i][6] = true;
    }

    // Justeringsmoenstre, 5x5. Hopper over de tre kombinasjonene som ville
    // ligget oppaa soekemoenstrene.
    var sentre = JUSTERING[versjon];
    for (i = 0; i < sentre.length; i++) {
      for (j = 0; j < sentre.length; j++) {
        var sy = sentre[i];
        var sx = sentre[j];
        var iHjorne = (i === 0 && j === 0) ||
                      (i === 0 && j === sentre.length - 1) ||
                      (i === sentre.length - 1 && j === 0);
        if (iHjorne) continue;
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            mod[sy + r][sx + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            res[sy + r][sx + c] = true;
          }
        }
      }
    }

    // Formatfeltet reserveres naa og fylles etter at masken er valgt.
    for (i = 0; i < 9; i++) {
      if (!res[8][i]) { res[8][i] = true; }
      if (!res[i][8]) { res[i][8] = true; }
    }
    for (i = 0; i < 8; i++) {
      res[8][storrelse - 1 - i] = true;
      res[storrelse - 1 - i][8] = true;
    }

    // Den faste moerke modulen. Den er alltid moerk, uansett data og maske.
    mod[storrelse - 8][8] = true;
    res[storrelse - 8][8] = true;

    if (versjon >= 7) settVersjonsfelt(mod, res, versjon);
  }

  // BCH(18,6): 6 versjonsbit + 12 kontrollbit, generator 0x1F25. Feltet finnes i
  // to kopier slik at versjonen kan leses selv om det ene hjoernet er skadet.
  function settVersjonsfelt(mod, res, versjon) {
    var storrelse = mod.length;
    var rest = versjon;
    for (var i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >> 11) * 0x1F25);
    var bits = (versjon << 12) | rest;

    for (var k = 0; k < 18; k++) {
      var bit = ((bits >> k) & 1) === 1;
      var a = storrelse - 11 + (k % 3);
      var b = Math.floor(k / 3);
      mod[b][a] = bit; res[b][a] = true;
      mod[a][b] = bit; res[a][b] = true;
    }
  }

  // BCH(15,5): 2 bit nivaa + 3 bit maske + 10 kontrollbit, generator 0x537.
  // Til slutt XOR-es hele med 0x5412 slik at et helt tomt format ikke blir 15
  // nuller - et helt hvitt formatfelt ville sett ut som "ingen kode her".
  function settFormatfelt(mod, maske) {
    var storrelse = mod.length;
    var nivaa = 0x00;                         // nivaa M
    var verdi = (nivaa << 3) | maske;
    var rest = verdi;
    for (var i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >> 9) * 0x537);
    var bits = ((verdi << 10) | rest) ^ 0x5412;

    function bit(n) { return ((bits >> n) & 1) === 1; }

    // Foerste kopi, rundt soekemoensteret oeverst til venstre.
    for (i = 0; i <= 5; i++) mod[i][8] = bit(i);
    mod[7][8] = bit(6);
    mod[8][8] = bit(7);
    mod[8][7] = bit(8);
    for (i = 9; i < 15; i++) mod[8][14 - i] = bit(i);

    // Andre kopi, delt mellom de to andre hjoernene.
    for (i = 0; i < 8; i++) mod[8][storrelse - 1 - i] = bit(i);
    for (i = 8; i < 15; i++) mod[storrelse - 15 + i][8] = bit(i);

    mod[storrelse - 8][8] = true;             // moerk modul, alltid
  }

  /* ============================================================ dataplassering

     Bitene legges i kolonnepar fra hoeyre mot venstre, sikksakk opp og ned.
     Kolonne 6 hoppes over i sin helhet fordi den er det vertikale tidsmoensteret
     - uten det hoppet forskyves alt til venstre for den. */
  function plasserData(mod, res, kodeord) {
    var storrelse = mod.length;
    var bitNr = 0;
    var totaltBits = kodeord.length * 8;

    for (var hoyre = storrelse - 1; hoyre >= 1; hoyre -= 2) {
      if (hoyre === 6) hoyre = 5;
      for (var steg = 0; steg < storrelse; steg++) {
        for (var j = 0; j < 2; j++) {
          var x = hoyre - j;
          var oppover = ((hoyre + 1) & 2) === 0;
          var y = oppover ? storrelse - 1 - steg : steg;
          if (res[y][x] || bitNr >= totaltBits) continue;
          mod[y][x] = ((kodeord[bitNr >> 3] >> (7 - (bitNr & 7))) & 1) === 1;
          bitNr++;
        }
      }
    }
  }

  /* ================================================================== maskering

     Maskering XOR-er databitene med et av aatte faste moenstre. Poenget er ikke
     sikkerhet, men lesbarhet: uten maske kan data gi store ensfargede flater
     eller falske soekemoenstre som roter for skanneren. Vi proever alle aatte,
     gir hver en straffesum etter de fire reglene i standarden, og beholder den
     med lavest sum. Hvilken maske som ble brukt staar i formatfeltet, saa
     skanneren kan reversere den. */

  function maskeTreff(maske, rad, kol) {
    switch (maske) {
      case 0: return (rad + kol) % 2 === 0;
      case 1: return rad % 2 === 0;
      case 2: return kol % 3 === 0;
      case 3: return (rad + kol) % 3 === 0;
      case 4: return (Math.floor(rad / 2) + Math.floor(kol / 3)) % 2 === 0;
      case 5: return ((rad * kol) % 2) + ((rad * kol) % 3) === 0;
      case 6: return (((rad * kol) % 2) + ((rad * kol) % 3)) % 2 === 0;
      default: return ((((rad * kol) % 3) + ((rad + kol) % 2)) % 2) === 0;
    }
  }

  function brukMaske(mod, res, maske) {
    for (var r = 0; r < mod.length; r++) {
      for (var c = 0; c < mod.length; c++) {
        if (res[r][c]) continue;
        if (maskeTreff(maske, r, c)) mod[r][c] = !mod[r][c];
      }
    }
  }

  // Regel 1: sammenhengende like moduler fra 5 og oppover, i rad og kolonne.
  function straffLikeRekker(mod) {
    var storrelse = mod.length;
    var sum = 0;

    function tell(hent) {
      for (var a = 0; a < storrelse; a++) {
        var lengde = 1;
        for (var b = 1; b < storrelse; b++) {
          if (hent(a, b) === hent(a, b - 1)) {
            lengde++;
          } else {
            if (lengde >= 5) sum += 3 + (lengde - 5);
            lengde = 1;
          }
        }
        if (lengde >= 5) sum += 3 + (lengde - 5);
      }
    }

    tell(function (r, c) { return mod[r][c]; });
    tell(function (c, r) { return mod[r][c]; });
    return sum;
  }

  // Regel 2: hver 2x2-flate i samme farge. Store ensfargede felt gjoer det
  // vanskelig for skanneren aa telle moduler.
  function straffFlater(mod) {
    var storrelse = mod.length;
    var antall = 0;
    for (var r = 0; r < storrelse - 1; r++) {
      for (var c = 0; c < storrelse - 1; c++) {
        var v = mod[r][c];
        if (mod[r][c + 1] === v && mod[r + 1][c] === v && mod[r + 1][c + 1] === v) antall++;
      }
    }
    return antall * 3;
  }

  // Regel 3: moensteret 1:1:3:1:1 med fire lyse moduler paa den ene siden -
  // altsaa noe som ligner et soekemoenster. Slike falske treff kan faa
  // skanneren til aa tro at symbolet ligger et annet sted enn det gjoer, saa
  // straffen er hoey (40). Vi ser paa 11 moduler av gangen som et skyvevindu.
  function straffFalskeSoekemoenstre(mod) {
    var storrelse = mod.length;
    var antall = 0;
    for (var r = 0; r < storrelse; r++) {
      var rekkeRad = 0;
      var rekkeKol = 0;
      for (var c = 0; c < storrelse; c++) {
        rekkeRad = ((rekkeRad << 1) & 0x7FF) | (mod[r][c] ? 1 : 0);
        rekkeKol = ((rekkeKol << 1) & 0x7FF) | (mod[c][r] ? 1 : 0);
        if (c >= 10) {
          if (rekkeRad === 0x5D0 || rekkeRad === 0x05D) antall++;
          if (rekkeKol === 0x5D0 || rekkeKol === 0x05D) antall++;
        }
      }
    }
    return antall * 40;
  }

  // Regel 4: avvik fra 50 % moerke moduler, i trinn paa 5 prosentpoeng.
  // En kode som er tydelig lysere eller moerkere enn halvparten gir daarligere
  // kontrastmargin naar kameraet setter terskelen sin.
  //
  // IKKE "rett opp" ceil-en til floor(abs(prosent - 50) / 5). Ordlyden i
  // standarden peker mot floor, men de utbredte bibliotekene (bl.a. npm-pakken
  // "qrcode", som vi verifiserer mot) regner det slik det staar her, og runder
  // dermed strengere naar koden er moerkere enn 50 %. Forskjellen slaar bare inn
  // paa svaert store symboler (maalt til 1 av 422 i fuzz-test, versjon 33) og
  // endrer bare hvilken maske som velges - begge varianter er gyldige og lar seg
  // dekode. Vi holder oss til varianten som gir bit-identisk resultat med
  // referansen, saa avvik i testene alltid betyr en ekte feil.
  function straffMoerkeAndel(mod) {
    var storrelse = mod.length;
    var moerke = 0;
    for (var r = 0; r < storrelse; r++) {
      for (var c = 0; c < storrelse; c++) if (mod[r][c]) moerke++;
    }
    var prosent = (moerke * 100) / (storrelse * storrelse);
    return Math.abs(Math.ceil(prosent / 5) - 10) * 10;
  }

  function straffesum(mod) {
    return straffLikeRekker(mod) + straffFlater(mod) +
           straffFalskeSoekemoenstre(mod) + straffMoerkeAndel(mod);
  }

  /* ==================================================================== API */

  function matrise(tekst) {
    if (tekst == null) tekst = '';
    tekst = String(tekst);

    var bytes = tilUtf8(tekst);
    var versjon = velgVersjon(bytes.length);
    var kodeord = byggEndeligeKodeord(byggDataKodeord(bytes, versjon), versjon);

    var storrelse = versjon * 4 + 17;
    var mod = nyttRutenett(storrelse);
    var res = nyttRutenett(storrelse);

    settFunksjonsmoenstre(mod, res, versjon);
    plasserData(mod, res, kodeord);

    // Straffen maales paa hele symbolet, formatfeltet inkludert, saa formatet
    // maa skrives foer vi maaler. Masken legges paa og tas av igjen (XOR er sin
    // egen invers), slik at vi slipper aa bygge rutenettet paa nytt aatte
    // ganger.
    var besteMaske = 0;
    var lavest = Infinity;
    for (var m = 0; m < 8; m++) {
      settFormatfelt(mod, m);
      brukMaske(mod, res, m);
      var sum = straffesum(mod);
      brukMaske(mod, res, m);
      if (sum < lavest) {
        lavest = sum;
        besteMaske = m;
      }
    }

    settFormatfelt(mod, besteMaske);
    brukMaske(mod, res, besteMaske);
    return mod;
  }

  function svg(tekst, opsjoner) {
    var o = opsjoner || {};
    var mod = matrise(tekst);
    var n = mod.length;

    // Under 4 moduler stille sone slutter mange skannere aa finne symbolet, saa
    // margen klemmes opp uansett hva kalleren ber om.
    var marg = Math.max(4, Math.round(o.marg == null ? 4 : o.marg));
    var ruter = n + marg * 2;
    var storrelse = o.storrelse == null ? 256 : o.storrelse;
    var moerk = o.moerk == null ? '#000000' : o.moerk;
    var lys = o.lys === undefined ? '#ffffff' : o.lys;

    // Moerke moduler slaas sammen til vannrette strekk. Det gir langt faerre
    // baner enn en rect per modul, og fjerner de haarfine skjoetene mellom
    // naboruter som ellers dukker opp ved skalering.
    var baner = [];
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (!mod[r][c]) { c++; continue; }
        var start = c;
        while (c < n && mod[r][c]) c++;
        baner.push('M' + (start + marg) + ' ' + (r + marg) + 'h' + (c - start) + 'v1h-' + (c - start) + 'z');
      }
    }

    var ut = '<svg xmlns="http://www.w3.org/2000/svg" width="' + storrelse + '" height="' + storrelse +
             '" viewBox="0 0 ' + ruter + ' ' + ruter + '" shape-rendering="crispEdges">';
    if (lys) ut += '<rect width="' + ruter + '" height="' + ruter + '" fill="' + lys + '"/>';
    ut += '<path fill="' + moerk + '" d="' + baner.join('') + '"/></svg>';
    return ut;
  }

  return {
    matrise: matrise,
    svg: svg
  };
});

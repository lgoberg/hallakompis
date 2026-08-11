/**
 * Husstandskapselen: én innlogging som følger deg til alle tjenestene.
 *
 * Kompis eier innloggingen, men tiern, fortelling og resten skal IKKE måtte
 * spørre Kompis ved hver forespørsel. De er med vilje uten avhengigheter, og
 * en tjeneste som slutter å virke fordi Kompis er nede ville vært et
 * tilbakeskritt. Derfor legges identiteten i en signert kapsel som hver
 * tjeneste kan verifisere lokalt med Node sin egen crypto.
 *
 * Samme mønster som sjekkGate i lyttio.
 *
 * Formatet er <nyttelast i base64url>.<hmac i base64url>, og nyttelasten
 * inneholder husstand, person, navn, rolle og utløp. Den er lesbar for den som
 * har den, og det er med vilje: den inneholder ingenting hemmelig, bare hvem
 * du er. Signaturen hindrer at noen dikter opp en annen identitet.
 *
 * Kapselen kan ikke trekkes tilbake momentant, bare utløpe. For en familie er
 * det greit. Skal en økt drepes umiddelbart, er det den vanlige
 * hallakompis_session i databasen som gjelder, og den eier Kompis alene.
 */
import crypto from 'node:crypto';

export const HUSSTAND_KAPSEL = 'hallakompis_hvem';

/** 30 dager. Fornyes hver gang du er innom Kompis. */
const LEVETID_MS = 30 * 24 * 60 * 60 * 1000;

export interface Hvem {
  husstand: string;
  person: string;
  navn: string;
  rolle: 'adult' | 'child';
  utloper: number;
}

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signer(nyttelast: string, hemmelighet: string): string {
  return b64url(crypto.createHmac('sha256', hemmelighet).update(nyttelast).digest());
}

export function lagKapsel(hvem: Omit<Hvem, 'utloper'>, hemmelighet: string): { verdi: string; utloper: Date } {
  const utloper = Date.now() + LEVETID_MS;
  const nyttelast = b64url(Buffer.from(JSON.stringify({ ...hvem, utloper }), 'utf8'));
  return { verdi: nyttelast + '.' + signer(nyttelast, hemmelighet), utloper: new Date(utloper) };
}

/**
 * Domenet er poenget med hele greia: uten det blir kapselen bundet til
 * verten som satte den, og da ser ikke tiern.hallakompis.no noe.
 *
 * Den settes bare når vi faktisk kjører på hallakompis.no. På code.run-adressen
 * ville et domene på .hallakompis.no blitt forkastet av nettleseren, og da er
 * det bedre å la være enn å sette en kapsel som ikke virker noe sted.
 */
export function kapselDomene(vertsnavn: string | undefined): string | undefined {
  if (!vertsnavn) return undefined;
  const vert = (vertsnavn.split(':')[0] ?? '').toLowerCase();
  return vert === 'hallakompis.no' || vert.endsWith('.hallakompis.no') ? '.hallakompis.no' : undefined;
}

/**
 * Hvilken vert brukeren faktisk står på.
 *
 * Kompis-webben proxyer alle API-kall og MÅ slette host-headeren, ellers svarer
 * API-et på feil vert. Da er host her den interne adressen, ikke
 * kompis.hallakompis.no, og kapselen ville aldri blitt satt. Proxyen sender
 * derfor den opprinnelige verten videre som x-forwarded-host, og den vinner.
 */
export function offentligVert(headers: Record<string, unknown>): string | undefined {
  const fra = headers['x-forwarded-host'] ?? headers['host'];
  const verdi = Array.isArray(fra) ? fra[0] : fra;
  return typeof verdi === 'string' ? verdi.split(',')[0]?.trim() : undefined;
}

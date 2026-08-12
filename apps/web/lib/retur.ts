/**
 * Hvor brukeren skal sendes etter innlogging.
 *
 * Gaten i tiern og fortelling sender deg hit med ?retur=<der du kom fra>, slik
 * at et klikk på 10'ern ender i 10'ern og ikke i Kompis.
 *
 * Adressen kommer fra spørrestrengen, altså utenfra, og da må den sjekkes:
 * uten dette kunne hvem som helst lenket til
 * kompis.hallakompis.no/?retur=https://noe-annet.no og brukt innloggingen vår
 * som mellomstasjon til et fremmed sted. Bare hallakompis.no og
 * underdomenene slipper gjennom, og bare over https.
 */
const TILLATT = /^hallakompis\.no$|\.hallakompis\.no$/;

export function trygtRetursted(rå: string | null | undefined): string | null {
  if (!rå) return null;
  let u: URL;
  try {
    u = new URL(rå);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (!TILLATT.test(u.hostname.toLowerCase())) return null;
  return u.toString();
}

/** Navnet på tjenesten, til å si hvor vi er på vei. */
export function stedsnavn(url: string | null): string | null {
  if (!url) return null;
  try {
    const vert = new URL(url).hostname.toLowerCase();
    const kjent: Record<string, string> = {
      'tiern.hallakompis.no': "10'ern",
      'fortelling.hallakompis.no': 'Fortellingen',
      'sykkeltid.hallakompis.no': 'Godlia Rundt',
      'leksehjelp.hallakompis.no': 'Leksehjelp',
    };
    return kjent[vert] ?? vert.replace('.hallakompis.no', '');
  } catch {
    return null;
  }
}

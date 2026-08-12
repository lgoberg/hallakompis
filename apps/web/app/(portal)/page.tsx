import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import PortalClient from './client';
import type { Me } from '@/lib/api';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

async function fetchMe(cookieHeader: string): Promise<Me | null> {
  try {
    const res = await fetch(`${API_URL}/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = await cookies();

  /* Kom du hit fra en annen tjeneste, ligger målet i ?retur=. Det må følge med
     videre til innloggingen, ellers havner du på dashbordet etterpå i stedet
     for der du egentlig skulle. Adressen sjekkes i trygtRetursted der den
     faktisk brukes; her bæres den bare videre. */
  const sp = await searchParams;
  const raa = Array.isArray(sp.retur) ? sp.retur[0] : sp.retur;
  const tilInnlogging = raa ? `/login?retur=${encodeURIComponent(raa)}` : '/login';

  if (!c.has('hallakompis_session')) redirect(tilInnlogging);

  const cookieHeader = c.getAll().map((x) => `${x.name}=${x.value}`).join('; ');
  const me = await fetchMe(cookieHeader);
  if (!me) redirect(tilInnlogging);

  return <PortalClient me={me} />;
}

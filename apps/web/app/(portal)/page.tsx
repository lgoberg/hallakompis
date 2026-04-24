import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import PortalClient from './client';
import type { Me } from '@/lib/api';

async function fetchMe(cookieHeader: string): Promise<Me | null> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${base}/me`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function PortalPage() {
  const c = await cookies();
  if (!c.has('hallakompis_session')) redirect('/login');

  const cookieHeader = c.getAll().map((x) => `${x.name}=${x.value}`).join('; ');
  const me = await fetchMe(cookieHeader);
  if (!me) redirect('/login');

  return <PortalClient me={me} />;
}

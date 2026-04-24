'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Household, type Member } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<Household>('/auth/household')
      .then(setHousehold)
      .catch((e) => setError(e.message));
  }, []);

  async function selectUser(m: Member) {
    if (m.hasPin) {
      setSelected(m);
      return;
    }
    await doLogin(m, '');
  }

  async function doLogin(m: Member, pinCode: string) {
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/select-user', { userId: m.id, pin: pinCode || undefined });
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Noe gikk galt');
      setLoading(false);
    }
  }

  if (!household) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-muted font-display italic">
          {error ? `Feil: ${error}` : 'Laster …'}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Husstand-label øverst */}
      <div className="absolute top-7 left-0 right-0 text-center font-mono text-xs text-muted uppercase tracking-[0.18em]">
        {household.household.name.toLowerCase()}
      </div>

      {selected ? (
        <PinEntry
          member={selected}
          onCancel={() => { setSelected(null); setPin(''); setError(null); }}
          onSubmit={(p) => doLogin(selected, p)}
          pin={pin}
          setPin={setPin}
          error={error}
          loading={loading}
        />
      ) : (
        <UserGrid household={household} onSelect={selectUser} error={error} />
      )}
    </main>
  );
}

function UserGrid({ household, onSelect, error }: {
  household: Household;
  onSelect: (m: Member) => void;
  error: string | null;
}) {
  return (
    <div className="max-w-3xl px-10 text-center">
      <div className="inline-flex items-center gap-3 mb-3">
        <div className="w-7 h-7 rounded-full" style={{ background: 'radial-gradient(circle at 30% 30%, #DAA94E, #B8763D 60%, #2D4A3E)' }} />
        <span className="font-display text-2xl font-medium tracking-tight">kompis</span>
      </div>
      <h1 className="font-display text-5xl leading-tight mb-2">
        Hvem er du, <em className="text-copper">i dag</em>?
      </h1>
      <p className="font-display italic text-lg text-ink-soft mb-11">
        Hver har sin egen Kompis.
      </p>
      {error && <div className="text-coral text-sm mb-6">{error}</div>}
      <div className="grid grid-cols-5 gap-4 max-w-2xl mx-auto">
        {household.members.map((m) => (
          <button
            key={m.id}
            onClick={() => onSelect(m)}
            className={`p-5 bg-paper border rounded-2xl cursor-pointer transition hover:-translate-y-1 hover:shadow-xl hover:border-strong flex flex-col items-center gap-2.5 ${m.role === 'child' ? 'opacity-85 hover:opacity-100' : ''}`}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-paper text-2xl font-display"
              style={{ background: `linear-gradient(135deg, ${m.avatarColor ?? '#B8763D'}, ${darken(m.avatarColor ?? '#B8763D')})` }}
            >
              {(m.displayName ?? m.name)[0]}
            </div>
            <div className="text-[15px] font-medium">{m.displayName ?? m.name}</div>
            <div className="font-mono text-[10px] text-muted uppercase tracking-widest">{m.role === 'adult' ? 'voksen' : 'barn'}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PinEntry({ member, onCancel, onSubmit, pin, setPin, error, loading }: {
  member: Member;
  onCancel: () => void;
  onSubmit: (p: string) => void;
  pin: string;
  setPin: (p: string) => void;
  error: string | null;
  loading: boolean;
}) {
  return (
    <div className="max-w-sm px-10 text-center">
      <div
        className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-paper text-3xl font-display"
        style={{ background: `linear-gradient(135deg, ${member.avatarColor ?? '#B8763D'}, ${darken(member.avatarColor ?? '#B8763D')})` }}
      >
        {(member.displayName ?? member.name)[0]}
      </div>
      <h2 className="font-display text-3xl mb-1">{member.displayName ?? member.name}</h2>
      <p className="font-display italic text-muted mb-8">Tast inn PIN</p>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(pin); }}>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="w-full text-center text-3xl font-mono tracking-[0.5em] py-4 bg-paper border border-strong rounded-xl outline-none focus:border-copper"
          placeholder="••••"
        />
        {error && <div className="text-coral text-sm mt-4">{error}</div>}
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onCancel} className="flex-1 py-3 bg-paper border rounded-xl hover:bg-cream transition">
            Tilbake
          </button>
          <button type="submit" disabled={loading || pin.length < 4} className="flex-1 py-3 bg-ink text-paper rounded-xl hover:bg-forest disabled:opacity-50 transition">
            {loading ? 'Logger inn …' : 'Logg inn'}
          </button>
        </div>
      </form>
    </div>
  );
}

function darken(hex: string): string {
  // Simple darken — mixes with black 40%
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c * 0.6).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

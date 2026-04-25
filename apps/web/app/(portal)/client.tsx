'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Me, type Task, type ShoppingItem, type ChatResponse } from '@/lib/api';

interface ChatMsg {
  role: 'user' | 'kompis';
  text: string;
  toolCalls?: ChatResponse['toolCalls'];
}

type MobileView = 'home' | 'lists' | 'family' | 'kompis';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}

export default function PortalClient({ me }: { me: Me }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: 'kompis', text: `God dag, ${me.displayName ?? me.name}. Spør meg om kalenderen, legg til noe på handlelisten, eller prøv «hva kan du?».` },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('home');
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refreshData();
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat]);

  async function refreshData() {
    try {
      const [t, s] = await Promise.all([
        api.get<Task[]>('/tasks'),
        api.get<ShoppingItem[]>('/family/shopping'),
      ]);
      setTasks(t);
      setShopping(s);
    } catch (e) {
      console.error('Kunne ikke hente data:', e);
    }
  }

  async function sendChat(message: string) {
    if (!message.trim() || sending) return;
    setSending(true);
    setChat((c) => [...c, { role: 'user', text: message }]);
    setInput('');
    try {
      const res = await api.post<ChatResponse>('/chat', { message });
      setChat((c) => [...c, { role: 'kompis', text: res.reply, toolCalls: res.toolCalls }]);
      if (res.toolCalls.length) await refreshData();
    } catch (e) {
      setChat((c) => [...c, { role: 'kompis', text: `⚠ Feil: ${e instanceof Error ? e.message : 'ukjent'}` }]);
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    await api.post('/auth/logout');
    router.push('/login');
  }

  async function toggleTask(t: Task) {
    const doneAt = t.doneAt ? null : new Date().toISOString();
    await api.patch(`/tasks/${t.id}`, { doneAt });
    refreshData();
  }

  async function toggleShop(s: ShoppingItem) {
    await api.patch(`/family/shopping/${s.id}`, { checked: !s.checked });
    refreshData();
  }

  const todayTasks = tasks.filter((t) => t.listType === 'today');
  const laterTasks = tasks.filter((t) => t.listType === 'later');

  // ──────────────────────────────────────────────────────────────
  //  MOBILE
  // ──────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="min-h-screen flex flex-col bg-cream">
        <main className="flex-1 overflow-y-auto pb-20">
          {mobileView === 'home' && (
            <MobileHome
              me={me}
              todayTasks={todayTasks}
              laterTasks={laterTasks}
              shopping={shopping}
              onToggleTask={toggleTask}
              onLogout={logout}
            />
          )}
          {mobileView === 'lists' && (
            <MobileLists
              tasks={tasks}
              shopping={shopping}
              onToggleTask={toggleTask}
              onToggleShop={toggleShop}
            />
          )}
          {mobileView === 'family' && <MobileFamily />}
          {mobileView === 'kompis' && (
            <MobileKompis
              chat={chat}
              chatRef={chatRef}
              input={input}
              setInput={setInput}
              sending={sending}
              onSend={sendChat}
            />
          )}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 bg-paper border-t border-DEFAULT flex justify-around items-stretch h-16 z-10">
          <NavTab label="Hjem" icon="◐" active={mobileView === 'home'} onClick={() => setMobileView('home')} />
          <NavTab label="Lister" icon="✓" active={mobileView === 'lists'} onClick={() => setMobileView('lists')} />
          <NavTab label="Familie" icon="♥" active={mobileView === 'family'} onClick={() => setMobileView('family')} />
          <NavTab label="Kompis" icon="●" active={mobileView === 'kompis'} onClick={() => setMobileView('kompis')} highlight />
        </nav>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────
  //  DESKTOP (uendret)
  // ──────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-[220px_1fr_360px] min-h-screen">
      <aside className="border-r border-DEFAULT p-7 flex flex-col sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-5 h-5 rounded-full" style={{ background: 'radial-gradient(circle at 30% 30%, #DAA94E, #B8763D 60%, #2D4A3E)' }} />
          <span className="font-display text-xl">kompis</span>
        </div>
        <nav className="flex flex-col gap-1 text-sm text-ink-soft">
          <div className="text-[10px] uppercase tracking-widest text-faint px-3 mb-1.5 mt-5 font-medium">Daglig</div>
          <a className="px-3 py-2 rounded-lg bg-ink text-paper">◐ Hjem</a>
          <a className="px-3 py-2 rounded-lg hover:bg-black/5 cursor-pointer">▦ Kalender</a>
          <a className="px-3 py-2 rounded-lg hover:bg-black/5 cursor-pointer flex justify-between">✓ Oppgaver <span className="text-xs bg-black/8 px-1.5 rounded-full">{tasks.length}</span></a>
          <div className="text-[10px] uppercase tracking-widest text-faint px-3 mb-1.5 mt-5 font-medium">Familie</div>
          <a className="px-3 py-2 rounded-lg hover:bg-black/5 cursor-pointer">⌂ Handleliste</a>
          <a className="px-3 py-2 rounded-lg hover:bg-black/5 cursor-pointer">♥ Barna</a>
          <div className="text-[10px] uppercase tracking-widest text-faint px-3 mb-1.5 mt-5 font-medium">Tanker & Jobb</div>
          <a className="px-3 py-2 rounded-lg hover:bg-black/5 cursor-pointer">✧ Ideer</a>
        </nav>
        <button onClick={logout} className="mt-auto pt-5 border-t flex items-center gap-2.5 text-left cursor-pointer">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-paper text-xs font-semibold" style={{ background: `linear-gradient(135deg, ${me.avatarColor ?? '#B8763D'}, #8a3a2c)` }}>
            {(me.displayName ?? me.name)[0]}
          </div>
          <div className="text-[13px] flex-1">
            <div className="font-semibold">{me.displayName ?? me.name}</div>
            <div className="text-muted text-[11px]">Logg ut →</div>
          </div>
        </button>
      </aside>

      <main className="p-8 pb-16">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-widest text-muted mb-1.5">
            {new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <h1 className="font-display text-5xl font-light">
            God dag, <em className="text-copper font-normal">{me.displayName ?? me.name}</em>.
          </h1>
        </header>

        <div className="grid grid-cols-2 gap-4">
          <Card title="Oppgaver i dag" count={todayTasks.length}>
            {todayTasks.length === 0 && <EmptyHint text="Ingen oppgaver — be Kompis legge til noe!" />}
            {todayTasks.map((t) => (
              <div key={t.id} className="flex items-start gap-2.5 py-1.5 text-sm border-b last:border-b-0">
                <input type="checkbox" checked={!!t.doneAt} onChange={() => toggleTask(t)} className="mt-1" />
                <span className={t.doneAt ? 'line-through text-muted' : ''}>{t.content}</span>
                {t.priority === 'high' && <span className="text-[10px] text-coral ml-auto">!</span>}
              </div>
            ))}
          </Card>

          <Card title="Handleliste" count={shopping.filter((s) => !s.checked).length} subtitle="delt med husstanden">
            {shopping.length === 0 && <EmptyHint text="Tom handleliste" />}
            {shopping.map((s) => (
              <div key={s.id} className="flex items-center gap-2.5 py-1 text-sm">
                <input type="checkbox" checked={s.checked} onChange={() => toggleShop(s)} />
                <span className={s.checked ? 'line-through text-muted' : ''}>{s.content}</span>
                {s.category && <span className="text-[10px] text-muted ml-auto">{s.category}</span>}
              </div>
            ))}
          </Card>

          <Card title="Senere i uka" count={laterTasks.length}>
            {laterTasks.length === 0 && <EmptyHint text="Ingenting planlagt" />}
            {laterTasks.map((t) => (
              <div key={t.id} className="py-1.5 text-sm border-b last:border-b-0">{t.content}</div>
            ))}
          </Card>

          <Card title="Integrasjoner" subtitle="MVP — kun interne moduler">
            <div className="text-sm text-muted space-y-2">
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-sage" /> Database + API: kjører</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-faint" /> Google Kalender: ikke koblet</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-faint" /> Slack: ikke koblet</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-faint" /> Spond: ikke koblet</div>
            </div>
          </Card>
        </div>
      </main>

      <aside className="bg-paper border-l border-DEFAULT flex flex-col sticky top-0 h-screen">
        <div className="p-6 border-b">
          <div className="flex items-center gap-2.5">
            <div className="w-4 h-4 rounded-full" style={{ background: 'radial-gradient(circle at 30% 30%, #DAA94E, #B8763D)' }} />
            <div className="font-display text-lg">Samtale med <em className="text-copper">Kompis</em></div>
          </div>
          <div className="text-[10px] text-sage uppercase tracking-widest mt-1">● Klar</div>
        </div>

        <div ref={chatRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {chat.map((m, i) => (
            <div key={i} className={`max-w-[90%] ${m.role === 'user' ? 'self-end' : ''}`}>
              <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                m.role === 'user' ? 'bg-ink text-paper rounded-br-[4px]' : 'bg-cream rounded-bl-[4px]'
              }`}>
                {m.text}
              </div>
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="mt-1.5 text-[10px] text-muted font-mono flex flex-wrap gap-1">
                  {m.toolCalls.map((tc, j) => (
                    <span key={j} className="px-1.5 py-0.5 bg-black/5 rounded">· {tc.name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {sending && <div className="text-xs text-muted font-display italic">Kompis tenker …</div>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); sendChat(input); }} className="p-5 border-t flex gap-2.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Si «Kompis», eller skriv..."
            className="flex-1 bg-cream border rounded-full px-4 py-2.5 text-[13px] outline-none focus:border-copper"
          />
          <button type="submit" disabled={!input.trim() || sending} className="w-9 h-9 rounded-full bg-ink text-paper disabled:opacity-50">●</button>
        </form>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  MOBIL-KOMPONENTER
// ─────────────────────────────────────────────────────────────────

function MobileHome({
  me, todayTasks, laterTasks, shopping, onToggleTask, onLogout,
}: {
  me: Me;
  todayTasks: Task[];
  laterTasks: Task[];
  shopping: ShoppingItem[];
  onToggleTask: (t: Task) => void;
  onLogout: () => void;
}) {
  return (
    <div className="px-5 pt-6">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted mb-1">
            {new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <h1 className="font-display text-3xl font-light leading-tight">
            God dag, <em className="text-copper font-normal">{me.displayName ?? me.name}</em>
          </h1>
        </div>
        <button
          onClick={onLogout}
          className="w-9 h-9 rounded-full flex items-center justify-center text-paper text-xs font-semibold flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${me.avatarColor ?? '#B8763D'}, #8a3a2c)` }}
          aria-label="Logg ut"
        >
          {(me.displayName ?? me.name)[0]}
        </button>
      </header>

      <div className="space-y-4">
        <Card title="Oppgaver i dag" count={todayTasks.length}>
          {todayTasks.length === 0 && <EmptyHint text="Ingen oppgaver — be Kompis legge til noe!" />}
          {todayTasks.map((t) => (
            <div key={t.id} className="flex items-start gap-3 py-2 text-sm border-b last:border-b-0">
              <input type="checkbox" checked={!!t.doneAt} onChange={() => onToggleTask(t)} className="mt-1" />
              <span className={t.doneAt ? 'line-through text-muted flex-1' : 'flex-1'}>{t.content}</span>
              {t.priority === 'high' && <span className="text-[10px] text-coral">!</span>}
            </div>
          ))}
        </Card>

        <Card title="Senere i uka" count={laterTasks.length}>
          {laterTasks.length === 0 && <EmptyHint text="Ingenting planlagt" />}
          {laterTasks.slice(0, 5).map((t) => (
            <div key={t.id} className="py-2 text-sm border-b last:border-b-0">{t.content}</div>
          ))}
        </Card>

        <Card title="Handleliste" count={shopping.filter((s) => !s.checked).length} subtitle="delt med husstanden">
          {shopping.length === 0 && <EmptyHint text="Tom handleliste" />}
          {shopping.slice(0, 5).map((s) => (
            <div key={s.id} className="py-1.5 text-sm flex items-center gap-2.5">
              <span className={s.checked ? 'line-through text-muted' : ''}>{s.content}</span>
              {s.category && <span className="text-[10px] text-muted ml-auto">{s.category}</span>}
            </div>
          ))}
          {shopping.length > 5 && <div className="text-[11px] text-muted italic mt-2">+ {shopping.length - 5} mer i Lister</div>}
        </Card>
      </div>
    </div>
  );
}

function MobileLists({
  tasks, shopping, onToggleTask, onToggleShop,
}: {
  tasks: Task[];
  shopping: ShoppingItem[];
  onToggleTask: (t: Task) => void;
  onToggleShop: (s: ShoppingItem) => void;
}) {
  return (
    <div className="px-5 pt-6">
      <h1 className="font-display text-2xl font-light mb-5">Lister</h1>
      <div className="space-y-4">
        <Card title="Alle oppgaver" count={tasks.length}>
          {tasks.length === 0 && <EmptyHint text="Ingen oppgaver" />}
          {tasks.map((t) => (
            <div key={t.id} className="flex items-start gap-3 py-2 text-sm border-b last:border-b-0">
              <input type="checkbox" checked={!!t.doneAt} onChange={() => onToggleTask(t)} className="mt-1" />
              <span className={t.doneAt ? 'line-through text-muted flex-1' : 'flex-1'}>{t.content}</span>
              <span className="text-[10px] text-muted">{t.listType}</span>
            </div>
          ))}
        </Card>

        <Card title="Handleliste" count={shopping.filter((s) => !s.checked).length} subtitle="delt med husstanden">
          {shopping.length === 0 && <EmptyHint text="Tom handleliste" />}
          {shopping.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2 text-sm border-b last:border-b-0">
              <input type="checkbox" checked={s.checked} onChange={() => onToggleShop(s)} />
              <span className={s.checked ? 'line-through text-muted flex-1' : 'flex-1'}>{s.content}</span>
              {s.category && <span className="text-[10px] text-muted">{s.category}</span>}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function MobileFamily() {
  return (
    <div className="px-5 pt-6">
      <h1 className="font-display text-2xl font-light mb-5">Familie</h1>
      <Card title="Kommer snart" subtitle="kalender + barna">
        <EmptyHint text="Familie-modulen er under bygging." />
      </Card>
    </div>
  );
}

function MobileKompis({
  chat, chatRef, input, setInput, sending, onSend,
}: {
  chat: ChatMsg[];
  chatRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  onSend: (msg: string) => void;
}) {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-5 pt-6 pb-3 border-b border-DEFAULT bg-paper">
        <div className="flex items-center gap-2.5">
          <div className="w-4 h-4 rounded-full" style={{ background: 'radial-gradient(circle at 30% 30%, #DAA94E, #B8763D)' }} />
          <div className="font-display text-lg"><em className="text-copper">Kompis</em></div>
          <div className="text-[10px] text-sage uppercase tracking-widest ml-auto">● Klar</div>
        </div>
      </div>

      <div ref={chatRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
        {chat.map((m, i) => (
          <div key={i} className={`max-w-[85%] ${m.role === 'user' ? 'self-end' : ''}`}>
            <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
              m.role === 'user' ? 'bg-ink text-paper rounded-br-[4px]' : 'bg-cream rounded-bl-[4px]'
            }`}>
              {m.text}
            </div>
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div className="mt-1 text-[10px] text-muted font-mono flex flex-wrap gap-1">
                {m.toolCalls.map((tc, j) => (
                  <span key={j} className="px-1.5 py-0.5 bg-black/5 rounded">· {tc.name}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && <div className="text-xs text-muted font-display italic">Kompis tenker …</div>}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); onSend(input); }}
        className="p-3 border-t border-DEFAULT bg-paper flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Skriv noe..."
          className="flex-1 bg-cream border rounded-full px-4 py-2.5 text-sm outline-none focus:border-copper"
        />
        <button type="submit" disabled={!input.trim() || sending} className="w-10 h-10 rounded-full bg-ink text-paper disabled:opacity-50 flex-shrink-0">●</button>
      </form>
    </div>
  );
}

function NavTab({
  label, icon, active, onClick, highlight,
}: {
  label: string; icon: string; active: boolean; onClick: () => void; highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wider transition-colors ${
        active ? 'text-ink' : 'text-muted'
      }`}
    >
      <div
        className={`text-base ${
          highlight && active
            ? 'w-8 h-8 rounded-full bg-ink text-paper flex items-center justify-center'
            : highlight
              ? 'text-copper'
              : ''
        }`}
      >
        {icon}
      </div>
      <span>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
//  DELTE KOMPONENTER
// ─────────────────────────────────────────────────────────────────

function Card({ title, subtitle, count, children }: {
  title: string; subtitle?: string; count?: number; children: React.ReactNode;
}) {
  return (
    <section className="bg-paper border rounded-2xl p-5 shadow-soft">
      <div className="flex justify-between items-baseline mb-3.5">
        <div>
          {subtitle && <div className="text-[11px] uppercase tracking-widest text-muted">{subtitle}</div>}
          <div className="font-display text-lg">{title}</div>
        </div>
        {typeof count === 'number' && <div className="text-xs text-muted font-mono">{count}</div>}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="text-sm text-muted font-display italic py-2">{text}</div>;
}

const API_BASE = '/api';

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!res.ok) {
    const err: Error & { status?: number } = new Error(`API ${res.status}: ${path}`);
    err.status = res.status;
    try {
      const body = await res.json();
      err.message = body.error ?? err.message;
    } catch {}
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T = unknown>(p: string) => request<T>(p),
  post: <T = unknown>(p: string, body?: unknown) =>
    request<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(p: string, body: unknown) =>
    request<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T = unknown>(p: string, body: unknown) =>
    request<T>(p, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T = unknown>(p: string) => request<T>(p, { method: 'DELETE' }),
};

export type Member = {
  id: string;
  name: string;
  displayName: string | null;
  role: 'adult' | 'child' | 'wall_display';
  avatarColor: string | null;
  hasPin: boolean;
};

export type Household = {
  household: { id: string; name: string };
  members: Member[];
};

export type Me = {
  id: string;
  householdId: string;
  name: string;
  displayName: string | null;
  role: 'adult' | 'child' | 'wall_display';
  avatarColor?: string | null;
};

export type Task = {
  id: string;
  userId: string;
  content: string;
  priority: 'high' | 'medium' | 'low' | null;
  dueAt: string | null;
  doneAt: string | null;
  archivedAt: string | null;
  listType: 'today' | 'later' | 'someday';
};

export type ShoppingItem = {
  id: string;
  householdId: string;
  content: string;
  category: string | null;
  checked: boolean;
  archivedAt: string | null;
  addedBy: string | null;
  createdAt: string;
};

export type ChatResponse = {
  reply: string;
  toolCalls: { name: string; input: unknown; result?: unknown }[];
};

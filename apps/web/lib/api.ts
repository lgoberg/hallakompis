/**
 * Tynn wrapper rundt fetch som snakker med Kompis-API-en.
 * Sender cookies automatisk, parser JSON, kaster ved feil.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface ApiError extends Error {
  status: number;
  code?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const err = new Error(`API ${res.status}: ${path}`) as ApiError;
    err.status = res.status;
    try {
      const body = await res.json();
      err.message = body.error ?? err.message;
    } catch {}
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ─── Typer som speiler backend-responser ───
export interface Member {
  id: string;
  name: string;
  displayName: string | null;
  role: 'adult' | 'child' | 'wall_display';
  avatarColor: string | null;
  hasPin: boolean;
}

export interface Household {
  household: { id: string; name: string };
  members: Member[];
}

export interface Me {
  id: string;
  name: string;
  displayName: string | null;
  role: 'adult' | 'child' | 'wall_display';
  avatarColor: string | null;
  uiPreference: Record<string, unknown>;
}

export interface Task {
  id: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
  listType: 'today' | 'later' | 'someday';
  doneAt: string | null;
  dueAt: string | null;
}

export interface ShoppingItem {
  id: string;
  content: string;
  category: string | null;
  checked: boolean;
  addedBy: string | null;
}

export interface ChatResponse {
  reply: string;
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>;
}

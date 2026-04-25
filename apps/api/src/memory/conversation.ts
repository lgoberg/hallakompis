/**
 * Henter pågående samtale (< 24t siden siste melding) eller lager ny.
 * Laster også historie fra DB inn i Anthropic-format.
 */
import { db, conversations, chatMessages } from '@hallakompis/db';
import { eq, desc, and, gte } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';

const CONTINUATION_WINDOW_HOURS = 24;
const HISTORY_LIMIT = 20;

export async function getOrCreateConversation(userId: string): Promise<string> {
  const cutoff = new Date(Date.now() - CONTINUATION_WINDOW_HOURS * 60 * 60 * 1000);

  // Finn nyeste samtale med aktivitet innen vinduet
  const recent = await db
    .select({ id: conversations.id, startedAt: conversations.startedAt })
    .from(conversations)
    .where(and(eq(conversations.userId, userId), gte(conversations.startedAt, cutoff)))
    .orderBy(desc(conversations.startedAt))
    .limit(1);

  if (recent[0]) {
    // Sjekk om siste melding også er innenfor vinduet
    const lastMsg = await db
      .select({ createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, recent[0].id))
      .orderBy(desc(chatMessages.createdAt))
      .limit(1);
    if (!lastMsg[0] || lastMsg[0].createdAt >= cutoff) {
      return recent[0].id;
    }
  }

  // Lag ny
  const [created] = await db.insert(conversations).values({ userId }).returning({ id: conversations.id });
if (!created) throw new Error('Kunne ikke opprette samtale');  
return created.id;
}

export async function loadHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content, toolCalls: chatMessages.toolCalls })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(HISTORY_LIMIT);

  // Reverser til kronologisk rekkefølge
  return rows.reverse().map((r) => ({
    role: r.role as 'user' | 'assistant',
    content: r.content as Anthropic.MessageParam['content'],
  }));
}

export async function persistMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: Anthropic.MessageParam['content'],
  toolCalls?: unknown,
): Promise<string> {
  const [created] = await db
    .insert(chatMessages)
    .values({
      conversationId,
      role,
      content: content as object,
      toolCalls: toolCalls as object | undefined,
    })
    .returning({ id: chatMessages.id });
  if (!created) throw new Error('Kunne ikke lagre melding');
  return created.id;
}

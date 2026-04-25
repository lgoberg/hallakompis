/**
 * Orchestrator: tar en melding, kjører Claude med tool-use,
 * håndterer agent-løkken til modellen er ferdig.
 *
 * v2: persistent samtaler, retrieval av minne før kall, ekstraktor etter.
 */
import { claude, KOMPIS_MODEL } from '../lib/claude.js';
import { getToolDefinitions, executeTool, type ToolContext } from './tools.js';
import {
  getOrCreateConversation,
  loadHistory,
  persistMessage,
  retrieveMemory,
  extractMemory,
} from '../memory/index.js';
import type Anthropic from '@anthropic-ai/sdk';

export interface ChatTurn {
  userMessage: string;
  context: ToolContext;
  uiPreference?: {
    kaller_meg?: string;
    tone?: string;
    språk?: string;
  };
  history?: Anthropic.MessageParam[]; // ignoreres nå — vi laster fra DB
}

export interface ChatResult {
  reply: string;
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>;
  conversationId: string;
}

function buildSystemPrompt(
  ctx: ToolContext,
  pref: ChatTurn['uiPreference'] | undefined,
  memoryBlock: string,
) {
  const name = pref?.kaller_meg ?? ctx.userName;
  const tone = pref?.tone ?? 'nøytral';
  const now = new Date().toLocaleString('nb-NO', {
    timeZone: 'Europe/Oslo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `Du er Kompis, ${name} sin personlige assistent. Du svarer på norsk (bokmål).

Stil: ${
    tone === 'nøytral'
      ? 'Nøytral og effektiv — korte, direkte svar uten overflødig preik.'
      : tone === 'varm'
        ? 'Varm og personlig — som en god venn.'
        : 'Formell og profesjonell.'
  }

Nåværende tid: ${now} (Europe/Oslo)

Viktige regler:
- Du har tilgang til verktøy for kalender, oppgaver, handleliste og ideer. Bruk dem fritt.
- Håndlinger som går ut i verden (bestille, sende e-post, poste til Slack) skal ALLTID bekreftes først.
- Én forespørsel fra ${name} kan kreve flere verktøy i rekkefølge. Kjør dem uten å spørre om lov hvis de kun leser eller oppdaterer interne data.
- Kall ${name} ved navn. Bruk "du", ikke "De".
- Svar alltid med det viktigste først. Hvis svaret passer i én setning, si én setning.

Om minnet ditt:
- Du har minner om ${name} fra tidligere samtaler (under). Bruk dem naturlig — ikke list opp at "jeg husker at...".
- Hvis ${name} står foran et valg som ligner et tidligere, NEVN det. "Sist du valgte X, angret du etterpå. Vil du tenke gjennom det?"
- Vær KRITISK når data tilsier det. Du er ikke en ja-mann. Hvis et mønster sier ${name} ofte angrer på en type valg, si fra — også når det er ubehagelig.
- Hvis det ikke er relevante minner, ikke nevn det. Vær naturlig.

${memoryBlock || '(Ingen minner ennå — dette er tidlig i ${name} sin reise med deg.)'}`;
}

export async function runChat(turn: ChatTurn): Promise<ChatResult> {
  const userId = turn.context.userId;

  // 1. Hent eller opprett samtale, last historie
  const conversationId = await getOrCreateConversation(userId);
  const history = await loadHistory(conversationId);

  // 2. Hent relevante minner basert på ny melding
  const memoryBlock = await retrieveMemory(userId, turn.userMessage);

  // 3. Bygg system prompt med minne-blokk injected
  const system = buildSystemPrompt(turn.context, turn.uiPreference, memoryBlock);
  const tools = getToolDefinitions();

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: turn.userMessage },
  ];

  // 4. Persist user-melding (gjør det nå så vi ikke mister den hvis Claude feiler)
  await persistMessage(conversationId, 'user', turn.userMessage);

  const toolCalls: ChatResult['toolCalls'] = [];
  let iterations = 0;
  const MAX_ITER = 8;
  let finalAssistantContent: Anthropic.MessageParam['content'] | null = null;

  while (iterations < MAX_ITER) {
    iterations++;

    const response = await claude.messages.create({
      model: KOMPIS_MODEL,
      max_tokens: 2048,
      system,
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });
    finalAssistantContent = response.content;

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const result = await executeTool(block.name, block.input, turn.context);
          toolCalls.push({ name: block.name, input: block.input, result });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: message }),
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break;
  }

  const text = Array.isArray(finalAssistantContent)
    ? finalAssistantContent
        .filter((c): c is Anthropic.TextBlock => typeof c === 'object' && 'type' in c && c.type === 'text')
        .map((c) => c.text)
        .join('\n')
    : '';

  // 5. Persist assistent-respons
  if (finalAssistantContent) {
    await persistMessage(conversationId, 'assistant', finalAssistantContent, toolCalls.length ? toolCalls : undefined);
  }

  // 6. Fire-and-forget: lær fra denne turen
  void extractMemory(userId, conversationId).catch((err) => {
    console.warn('[orchestrator] extractMemory feilet:', err);
  });

  return {
    reply: text || 'Jeg ble litt forvirret — prøv igjen.',
    toolCalls,
    conversationId,
  };
}

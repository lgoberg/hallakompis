/**
 * Orchestrator: tar en melding, kjører Claude med tool-use,
 * håndterer agent-løkken til modellen er ferdig.
 */
import { claude, KOMPIS_MODEL } from '../lib/claude.js';
import { getToolDefinitions, executeTool, type ToolContext } from './tools.js';
import type Anthropic from '@anthropic-ai/sdk';

export interface ChatTurn {
  userMessage: string;
  context: ToolContext;
  uiPreference?: {
    kaller_meg?: string;
    tone?: string;
    språk?: string;
  };
  history?: Anthropic.MessageParam[];
}

export interface ChatResult {
  reply: string;
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>;
  updatedHistory: Anthropic.MessageParam[];
}

function buildSystemPrompt(ctx: ToolContext, pref?: ChatTurn['uiPreference']) {
  const name = pref?.kaller_meg ?? ctx.userName;
  const tone = pref?.tone ?? 'nøytral';
  const now = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return `Du er Kompis, ${name} sin personlige assistent. Du svarer på norsk (bokmål).

Stil: ${tone === 'nøytral' ? 'Nøytral og effektiv — korte, direkte svar uten overflødig preik.' :
        tone === 'varm' ? 'Varm og personlig — som en god venn.' :
        'Formell og profesjonell.'}

Nåværende tid: ${now} (Europe/Oslo)

Viktige regler:
- Du har tilgang til verktøy for kalender, oppgaver, handleliste og ideer. Bruk dem fritt.
- Håndlinger som går ut i verden (bestille, sende e-post, poste til Slack) skal ALLTID bekreftes først.
- Én forespørsel fra ${name} kan kreve flere verktøy i rekkefølge. Kjør dem uten å spørre om lov hvis de kun leser eller oppdaterer interne data.
- Kall ${name} ved navn. Bruk "du", ikke "De".
- Svar alltid med det viktigste først. Hvis svaret passer i én setning, si én setning.`;
}

export async function runChat(turn: ChatTurn): Promise<ChatResult> {
  const system = buildSystemPrompt(turn.context, turn.uiPreference);
  const tools = getToolDefinitions();

  const messages: Anthropic.MessageParam[] = [
    ...(turn.history ?? []),
    { role: 'user', content: turn.userMessage },
  ];

  const toolCalls: ChatResult['toolCalls'] = [];
  let iterations = 0;
  const MAX_ITER = 8;

  while (iterations < MAX_ITER) {
    iterations++;

    const response = await claude.messages.create({
      model: KOMPIS_MODEL,
      max_tokens: 2048,
      system,
      tools,
      messages,
    });

    // Legg hele responsen inn i history
    messages.push({ role: 'assistant', content: response.content });

    // Ferdig?
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      const text = response.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      return { reply: text, toolCalls, updatedHistory: messages };
    }

    // Kjør verktøy
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

    // Ukjent stop_reason
    break;
  }

  const last = messages[messages.length - 1];
  const text = Array.isArray(last?.content)
    ? last.content.filter((c) => typeof c === 'object' && 'type' in c && c.type === 'text').map((c) => (c as Anthropic.TextBlock).text).join('\n')
    : '';
  return { reply: text || 'Jeg ble litt forvirret — prøv igjen.', toolCalls, updatedHistory: messages };
}

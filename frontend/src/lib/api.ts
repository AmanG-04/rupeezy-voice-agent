/**
 * Backend API client. Vite dev server proxies /api → http://localhost:8000.
 */

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
}

export interface Conversation {
  conv_id: string;
  started_at: string;
  ended_at: string | null;
  ended_by: string | null;
  language: string;
  messages: ConversationMessage[];
}

export interface CreateConversationResponse {
  conv_id: string;
  started_at: string;
}

const BASE = '/api/conversations';

export async function createConversation(): Promise<CreateConversationResponse> {
  const r = await fetch(BASE, { method: 'POST' });
  if (!r.ok) throw new Error(`createConversation: ${r.status}`);
  return r.json();
}

export async function getConversation(convId: string): Promise<Conversation> {
  const r = await fetch(`${BASE}/${convId}`);
  if (!r.ok) throw new Error(`getConversation: ${r.status}`);
  return r.json();
}

export async function endConversation(
  convId: string,
  endedBy: 'agent' | 'lead' | 'dropped' = 'lead',
): Promise<Conversation> {
  const r = await fetch(`${BASE}/${convId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ended_by: endedBy }),
  });
  if (!r.ok) throw new Error(`endConversation: ${r.status}`);
  return r.json();
}

/**
 * Stream agent reply tokens for a single user turn.
 *
 * SSE events emitted by the backend:
 *   event: token  data: {"text": "<chunk>"}
 *   event: done   data: {}
 *   event: error  data: {"message": "<reason>"}
 *
 * EventSource doesn't support POST bodies, so we use fetch + manual SSE parsing.
 */
export async function streamTurn(
  convId: string,
  userText: string,
  handlers: {
    onToken: (text: string) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(`${BASE}/${convId}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ text: userText }),
    signal,
  });
  if (!r.ok || !r.body) {
    handlers.onError?.(`turn HTTP ${r.status}`);
    return;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank lines.
    let split: number;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = parseSSE(raw);
      if (!event) continue;
      if (event.event === 'token') {
        try {
          const parsed = JSON.parse(event.data) as { text: string };
          handlers.onToken(parsed.text);
        } catch {
          handlers.onToken(event.data);
        }
      } else if (event.event === 'done') {
        handlers.onDone?.();
      } else if (event.event === 'error') {
        try {
          const parsed = JSON.parse(event.data) as { message: string };
          handlers.onError?.(parsed.message);
        } catch {
          handlers.onError?.(event.data);
        }
      }
    }
  }
}

function parseSSE(raw: string): { event: string; data: string } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

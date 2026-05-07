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
  lead_id?: string | null;
}

// ---- Handoff (Phase 3) — must mirror backend/app/scoring/schemas.py ----

export type Bucket = 'hot' | 'warm' | 'cold';

export interface SignalBreakdown {
  stated_intent: number;
  engagement: number;
  network_size: number;
  objection_pattern: number;
  affirmative_cues: number;
  deferrals: number;
}

export interface Discovery {
  current_role: 'mfd' | 'advisor' | 'agent' | 'influencer' | 'other' | 'unknown';
  current_broker?: string | null;
  estimated_clients?: number | null;
  estimated_aum_inr?: number | null;
  has_nism_series_vii?: boolean | null;
}

export type ObjectionId =
  | 'existing_broker'
  | 'not_enough_contacts'
  | 'client_support'
  | 'trustworthiness'
  | 'think_about_it'
  | 'security_deposit'
  | 'nism_required'
  | 'other';

export interface ObjectionRaised {
  id: ObjectionId;
  raised_at_turn: number;
  resolved: 'true' | 'false' | 'partial';
  notes?: string;
}

export type NextActionType =
  | 'warm_transfer'
  | 'rm_callback'
  | 'whatsapp_link_sent'
  | 'nurture_sequence'
  | 'dnd';

export interface NextAction {
  type: NextActionType;
  scheduled_for?: string | null;
  assigned_rm?: string | null;
}

export interface Classification {
  bucket: Bucket;
  confidence: number;
  signal_breakdown: SignalBreakdown;
  rationale: string;
}

export interface Contact {
  name: string;
  phone: string;
  language_used: string;
}

export interface CallMeta {
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  turn_count: number;
  ended_by: string;
}

export interface HandoffRecord {
  lead_id: string;
  contact: Contact;
  call: CallMeta;
  classification: Classification;
  discovery: Discovery;
  objections_raised: ObjectionRaised[];
  unresolved_questions: string[];
  next_action: NextAction;
  summary_short: string;
  transcript_url?: string | null;
}

export interface EndConversationResponse {
  conversation: Conversation;
  handoff: HandoffRecord | null;
  handoff_error: string | null;
}

import { api } from './apiBase';

const BASE = api('/api/conversations');

export async function createConversation(
  opts?: { leadId?: string },
): Promise<CreateConversationResponse> {
  const init: RequestInit = { method: 'POST' };
  if (opts?.leadId) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify({ lead_id: opts.leadId });
  }
  const r = await fetch(BASE, init);
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
): Promise<EndConversationResponse> {
  const r = await fetch(`${BASE}/${convId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ended_by: endedBy }),
  });
  if (!r.ok) throw new Error(`endConversation: ${r.status}`);
  return r.json();
}

export async function getHandoff(convId: string): Promise<HandoffRecord> {
  const r = await fetch(`${BASE}/${convId}/handoff`);
  if (!r.ok) throw new Error(`getHandoff: ${r.status}`);
  return r.json();
}

// ---- Dashboard (Phase 5) ----

export interface Funnel {
  contacted: number;
  engaged: number;
  qualified: number;
  hot: number;
  warm: number;
  cold: number;
}

export interface LeadRow {
  conv_id: string;
  started_at: string;
  duration_sec: number;
  bucket: Bucket;
  confidence: number;
  next_action: NextActionType;
  summary_short: string;
  language_used: string;
}

export interface LeadDetail {
  handoff: HandoffRecord;
  transcript: ConversationMessage[];
}

const DASH = api('/api/dashboard');

export async function getFunnel(): Promise<Funnel> {
  const r = await fetch(`${DASH}/funnel`);
  if (!r.ok) throw new Error(`getFunnel: ${r.status}`);
  return r.json();
}

export async function listLeads(opts?: { bucket?: Bucket; limit?: number }): Promise<LeadRow[]> {
  const qs = new URLSearchParams();
  if (opts?.bucket) qs.set('bucket', opts.bucket);
  if (opts?.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  const r = await fetch(`${DASH}/leads${q ? `?${q}` : ''}`);
  if (!r.ok) throw new Error(`listLeads: ${r.status}`);
  return r.json();
}

export async function getLeadDetail(convId: string): Promise<LeadDetail> {
  const r = await fetch(`${DASH}/leads/${convId}`);
  if (!r.ok) throw new Error(`getLeadDetail: ${r.status}`);
  return r.json();
}

// ---- WhatsApp logs (Phase 8) ----

export type WhatsappTemplateId = 'hot' | 'warm' | 'cold_nurture' | string;
export type WhatsappStatus =
  | 'sent_mock'
  | 'sent_cloud_api'
  | 'failed'
  | 'skipped'
  | string;

export interface WhatsappLog {
  id: number;
  template_id: WhatsappTemplateId;
  body: string;
  to_phone: string;
  sent_at: string; // ISO 8601
  status: WhatsappStatus;
}

export async function getWhatsappLogs(convId: string): Promise<WhatsappLog[]> {
  const r = await fetch(`${DASH}/leads/${convId}/whatsapp`);
  if (!r.ok) throw new Error(`getWhatsappLogs: ${r.status}`);
  return r.json();
}

// ---- Phase 9: batch upload + dialer queue ----

export interface BatchUploadResponse {
  inserted: number;
  skipped_duplicates: number;
  errors: string[];
}

export interface QueuedLead {
  lead_id: string;
  name: string;
  phone: string;
  language_pref: string;
  status: 'queued' | 'contacting' | 'completed' | 'failed';
  conv_id: string | null;
  bucket: Bucket | null;
}

export interface QueueResponse {
  queued: QueuedLead[];
}

export interface DialNextResponse {
  idle?: boolean;
  lead_id?: string;
  conv_id?: string;
  name?: string;
  phone?: string;
  bucket?: Bucket;
  confidence?: number;
  next_action?: NextActionType;
  status?: string;
  error?: string;
}

export async function uploadLeadsCsv(file: File): Promise<BatchUploadResponse> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`${DASH}/leads/batch`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`uploadLeadsCsv: ${r.status}`);
  return r.json();
}

export async function getLeadsQueue(): Promise<QueueResponse> {
  const r = await fetch(`${DASH}/leads/queue`);
  if (!r.ok) throw new Error(`getLeadsQueue: ${r.status}`);
  return r.json();
}

export async function dialNextLead(): Promise<DialNextResponse> {
  const r = await fetch(`${DASH}/leads/dial-next`, { method: 'POST' });
  if (!r.ok) throw new Error(`dialNextLead: ${r.status}`);
  return r.json();
}

export interface SeedDemoResponse {
  enqueued: number;
  personas: number;
}

export async function seedDemoLeads(): Promise<SeedDemoResponse> {
  const r = await fetch(`${DASH}/leads/seed-demo`, { method: 'POST' });
  if (!r.ok) throw new Error(`seedDemoLeads: ${r.status}`);
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
    // Normalise CRLF -> LF as we decode so the rest of the parser only has
    // to deal with one line ending. sse-starlette emits CRLF per the spec.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    // SSE messages are separated by a blank line.
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

/**
 * Voice-mode turn: streams BOTH text tokens and base64 WAV audio chunks.
 *
 *   event: token  data: {"text": "..."}        — for the live transcript
 *   event: audio  data: {"wav_b64": "..."}     — Aoede voice, one sentence
 *   event: done   data: {}
 *   event: error  data: {"message": "..."}
 */
export async function streamTurnAudio(
  convId: string,
  userText: string,
  handlers: {
    onToken: (text: string) => void;
    onAudio: (wavB64: string) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(`${BASE}/${convId}/turn/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ text: userText }),
    signal,
  });
  if (!r.ok || !r.body) {
    handlers.onError?.(`turn/audio HTTP ${r.status}`);
    return;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

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
      } else if (event.event === 'audio') {
        try {
          const parsed = JSON.parse(event.data) as { wav_b64: string };
          handlers.onAudio(parsed.wav_b64);
        } catch {
          // ignore malformed
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

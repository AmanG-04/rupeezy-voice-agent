import type { HandoffRecord } from './api';

export const sampleMessages = [
  { role: 'assistant', text: "Hello, I'm Aria, an AI assistant for Example Academy. How can I help you with our Python course?" },
  { role: 'user', text: "Main beginner hoon. Python course ka cost aur duration kya hai?" },
  { role: 'assistant', text: "Course 500 rupees ka hai aur six weeks online chalta hai. Job guarantee nahi hai, lekin beginner Python skills seekhne ke liye designed hai." },
  { role: 'user', text: "Theek hai, main sign up karna chahta hoon. Signup link bhej do." },
  { role: 'assistant', text: "Theek hai. Main aapki interest aur questions conversation summary mein include karungi. Enrollment abhi complete nahi hua hai." },
] as const;

export const sampleHandoff: HandoffRecord = {
  lead_id: 'sample-learner',
  conversation_id: 'sample-conversation',
  contact: { name: 'Sample learner', phone: '', language_used: 'hinglish' },
  call: { started_at: '2026-09-30T10:00:00Z', ended_at: '2026-09-30T10:01:00Z', duration_sec: 60, turn_count: 5, ended_by: 'lead' },
  classification: {
    bucket: 'hot', confidence: 0.9,
    rationale: 'The lead explicitly asked to sign up after discussing costs.',
    signal_breakdown: { stated_intent: 1, engagement: 0.7, network_size: 0.5, objection_pattern: 0.6, affirmative_cues: 0.8, deferrals: 0 },
  },
  discovery: { current_role: 'other' },
  objections_raised: [], unresolved_questions: [],
  next_action: { type: 'warm_transfer' },
  summary_short: 'Beginner learner asked about course price and duration, then explicitly requested signup. Share enrollment details; no enrollment or message has been completed.',
  evidence: [
    { field: 'information_request', turn: 1, quote: sampleMessages[1].text },
    { field: 'signup_intent', turn: 3, quote: sampleMessages[3].text },
  ],
};

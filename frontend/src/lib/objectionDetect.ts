/**
 * Client-side objection detector. Keyword-based, deterministic, no extra
 * LLM call — fires the moment the user's utterance lands so the transcript
 * shows live objection chips while Aria is still composing the rebuttal.
 *
 * IDs match the canonical set the post-call classifier uses (Appendix §7.1)
 * so the in-flight chip and the final handoff panel reference the same label.
 */

export type ObjectionId =
  | 'existing_broker'
  | 'not_enough_contacts'
  | 'client_support'
  | 'trustworthiness'
  | 'think_about_it'
  | 'security_deposit'
  | 'nism_required'
  | 'other';

export const OBJECTION_LABEL: Record<ObjectionId, string> = {
  existing_broker: 'Existing broker',
  not_enough_contacts: 'Network size',
  client_support: 'Client support',
  trustworthiness: 'Trust / legitimacy',
  think_about_it: 'Deferring',
  security_deposit: 'Security deposit',
  nism_required: 'NISM required',
  other: 'Other',
};

interface Pattern {
  id: ObjectionId;
  triggers: RegExp[];
}

// Order matters — first match wins. More-specific patterns first so a phrase
// like "I'm with Zerodha" matches existing_broker before falling through to
// trust / think-about-it.
const PATTERNS: Pattern[] = [
  {
    id: 'existing_broker',
    triggers: [
      /\b(angel\s*one|zerodha|upstox|groww|5\s*paisa|fivepaisa|motilal|smc|yes\s*securities|kotak|icici\s*direct|hdfc\s*sec)\b/i,
      /\b(already|currently|abhi)\s+(with|registered|associated|tied|ke\s+saath|enrolled)\b/i,
      /\bdoosre|kisi\s+aur\s+broker\b/i,
      /\bmy\s+(current|existing)\s+(broker|partner|platform)\b/i,
    ],
  },
  {
    id: 'security_deposit',
    triggers: [
      /\bsecurity\s+deposit\b/i,
      /\bone\s+lakh|1\s*lakh|₹\s*1\s*l|₹\s*1,?00,?000\b/i,
      /\b(refundable|deposit\s+refund)\b/i,
      /\bek\s+lakh|jamaa(?:\s+karna|raashi)?\b/i,
    ],
  },
  {
    id: 'nism_required',
    triggers: [
      /\bnism\b/i,
      /\bseries\s*7|series\s*vii\b/i,
      /\bsecurities\s+operations\b/i,
      /\bcertif(ication|icate)\s+(needed|required|mandatory)\b/i,
    ],
  },
  {
    id: 'not_enough_contacts',
    triggers: [
      /\bnot\s+enough\s+(clients|contacts|leads|network)\b/i,
      /\b(small|tiny)\s+(network|book|client\s+base)\b/i,
      /\bzyaada\s+clients\s+nahi\b/i,
      /\b(no|few|hardly\s+any)\s+clients\b/i,
      /\b50\s+referrals?\b/i,
    ],
  },
  {
    id: 'client_support',
    triggers: [
      /\b(client|customer)\s+support\b/i,
      /\bwho\s+(handles|will\s+handle)\s+(issues|problems|support)\b/i,
      /\bif\s+(my\s+)?clients?\s+(face|have)\s+(issue|problem|trouble)\b/i,
      /\bsupport\s+kaun\s+(dega|karega)\b/i,
    ],
  },
  {
    id: 'trustworthiness',
    triggers: [
      /\btrust(worthy)?|legit(imate)?\b/i,
      /\bsebi\s+(registered|registration)\b/i,
      /\bare\s+you\s+(safe|reliable|real)\b/i,
      /\bkitna\s+(bharosa|trust)\b/i,
      /\b(scam|fraud|fake)\b/i,
    ],
  },
  {
    id: 'think_about_it',
    triggers: [
      /\bi(?:'ll|\s+will)\s+think\s+about\s+it\b/i,
      /\bcall\s+(me\s+)?(later|back\s+later)\b/i,
      /\b(busy|not\s+a\s+good\s+time)\b/i,
      /\bsoch\s+ke\s+batata\b/i,
      /\bbaad\s+mein|abhi\s+busy\b/i,
      /\blet\s+me\s+(think|get\s+back)\b/i,
    ],
  },
];

export interface DetectedObjection {
  id: ObjectionId;
  label: string;
}

export function detectObjection(text: string): DetectedObjection | null {
  if (!text || text.length < 4) return null;
  for (const p of PATTERNS) {
    if (p.triggers.some((re) => re.test(text))) {
      return { id: p.id, label: OBJECTION_LABEL[p.id] };
    }
  }
  return null;
}

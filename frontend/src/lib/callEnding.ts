/**
 * Detect replies where Aria has clearly closed the call.
 *
 * Keep this conservative: if the assistant is still asking a question, the
 * frontend should keep listening. The post-call pipeline runs only after a
 * final goodbye/transfer confirmation.
 */
export function shouldAutoEndAfterAssistantReply(reply: string): boolean {
  const text = reply.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text || text.includes('?')) return false;

  return TERMINAL_CLOSE_PHRASES.some((phrase) => text.includes(phrase));
}

const TERMINAL_CLOSE_PHRASES = [
  'have a great day',
  'have a productive day',
  'productive day ahead',
  'thank you for your time',
  'thanks for your time',
  'call you shortly',
  'reach out to you shortly',
  'connect with you right away',
  'partner manager reach out',
  'partner team reach out',
  'pass your details to our partner team',
  'hand this over to our partner team',
];

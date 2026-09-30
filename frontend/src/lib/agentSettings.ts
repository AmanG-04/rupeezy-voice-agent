export interface AgentSettings {
  business_name: string;
  agent_name: string;
  program_name: string;
  knowledge: string;
  language: 'en-IN' | 'hi-IN' | 'hinglish';
}

export const defaultSettings: AgentSettings = {
  business_name: 'Example Academy',
  agent_name: 'Aria',
  program_name: 'Python course',
  knowledge: 'We offer a six-week beginner Python course for 500 rupees. Classes are online. No job or placement guarantee is offered. Interested learners can request course details; do not claim enrollment or messages have been completed.',
  language: 'en-IN',
};

export const rupeezySettings: AgentSettings = {
  business_name: 'Rupeezy', agent_name: 'Aria',
  program_name: 'Authorized Person partner program', knowledge: '', language: 'en-IN',
};

export function loadAgentSettings(): AgentSettings {
  try {
    return { ...defaultSettings, ...JSON.parse(sessionStorage.getItem('agent-settings') || '{}') };
  } catch {
    return { ...defaultSettings };
  }
}

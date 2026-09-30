import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Clock3, FileText, Mic, Sparkles } from 'lucide-react';

const PREVIEWS = {
  english: {
    lead: 'I’m interested in the Python course. How much is it?',
    agent: 'The course costs 500 rupees and runs online for six weeks. Would you like to hear what you’ll learn?',
    evidence: 'Asked about getting started and costs',
  },
  hinglish: {
    lead: 'Interest hai, Python course ka cost kya hai?',
    agent: 'Course 500 rupees ka hai aur six weeks online chalta hai. Aap jaana chahenge ki kya seekhenge?',
    evidence: 'Getting started aur costs ke baare mein poocha',
  },
} as const;

const WAVE_HEIGHTS = [8, 13, 21, 12, 28, 38, 22, 48, 32, 18, 40, 54, 29, 44, 22, 35, 50, 30, 16, 42, 26, 34, 18, 24, 12, 8];

export default function LandingHero() {
  const [language, setLanguage] = useState<'english' | 'hinglish'>('english');
  const preview = PREVIEWS[language];

  return (
    <section aria-labelledby="hero-heading" className="max-w-6xl w-full mx-auto px-5 sm:px-8 pt-12 sm:pt-16 lg:pt-24 pb-12 sm:pb-20">
      <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-14 items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-rupeezy-accent/25 bg-rupeezy-accent-faint px-3 py-1.5 text-[11px] font-medium text-rupeezy-accent mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-rupeezy-accent" aria-hidden="true" />
            A voice agent you can actually try
          </div>
          <h1 id="hero-heading" className="font-serif text-[2.75rem] sm:text-[3.75rem] lg:text-[4rem] leading-[1.08] tracking-[-0.045em] text-rupeezy-fg">
            A conversation.
            <br />
            A qualified lead.
            <br />
            <span className="text-rupeezy-accent italic">
              The full context.
            </span>
          </h1>
          <p className="mt-6 text-base sm:text-lg leading-relaxed text-rupeezy-fg-muted max-w-lg">
            Build a voice agent for your business. Give it your facts, talk in English or Hinglish, and review every conversation with a clear, evidence-backed handoff.
          </p>
          <div className="mt-8 flex flex-col min-[400px]:flex-row gap-3">
            <Link to="/voice" className="inline-flex items-center justify-center gap-2 rounded-lg bg-rupeezy-accent px-5 py-3.5 text-sm font-medium text-white shadow-soft hover:bg-rupeezy-accent/90 transition-colors">
              <Mic size={16} aria-hidden="true" />
              Try a voice agent
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/sample" className="inline-flex items-center justify-center gap-2 rounded-lg border border-rupeezy-border bg-rupeezy-card/60 px-5 py-3.5 text-sm font-medium text-rupeezy-fg hover:border-rupeezy-fg-muted transition-colors">
              Explore the demo
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-rupeezy-fg-faint">
            Browser voice · no account needed.
          </p>
          <div role="note" className="mt-4 flex items-start gap-2.5 rounded-lg border border-rupeezy-warm/20 bg-rupeezy-warm-faint px-3.5 py-3 max-w-lg">
            <Clock3 size={15} className="mt-0.5 shrink-0 text-rupeezy-warm" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-rupeezy-fg-muted">
              The backend runs on Render’s free tier and may take approximately 60 seconds to wake up after being idle. You can explore the sample demo while it starts.
            </p>
          </div>
          <div className="mt-8 pt-6 border-t border-rupeezy-border flex flex-wrap gap-x-5 gap-y-3 text-xs text-rupeezy-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <Check size={13} className="text-rupeezy-ok" aria-hidden="true" />
              Grounded answers
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check size={13} className="text-rupeezy-ok" aria-hidden="true" />
              Transcript evidence
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check size={13} className="text-rupeezy-ok" aria-hidden="true" />
              Human review
            </span>
          </div>
        </div>

        <div className="relative min-w-0">
          <div aria-hidden="true" className="absolute inset-x-8 inset-y-12 rounded-full bg-rupeezy-accent/10 blur-3xl pointer-events-none" />
          <div className="relative rounded-2xl border border-rupeezy-border bg-rupeezy-surface shadow-lifted overflow-hidden">
            <div className="px-5 py-4 flex flex-wrap gap-3 items-center justify-between border-b border-rupeezy-border">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-rupeezy-accent-faint text-rupeezy-accent flex items-center justify-center">
                  <Mic size={15} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    Aria
                  </p>
                  <p className="text-[11px] text-rupeezy-fg-faint">
                    Course enquiry example
                  </p>
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-rupeezy-fg-faint border border-rupeezy-border rounded-md px-2 py-1">
                Example preview
              </span>
            </div>

            <div className="px-5 sm:px-6 pt-5 pb-6">
              <div role="group" aria-label="Preview language" className="inline-flex gap-1 p-1 bg-rupeezy-ink rounded-lg border border-rupeezy-border">
                {(['english', 'hinglish'] as const).map((option) => (
                  <button key={option} type="button" aria-pressed={language === option} onClick={() => setLanguage(option)} className={`rounded-md px-3 py-1.5 text-xs transition-colors ${language === option ? 'bg-rupeezy-elevated text-rupeezy-fg shadow-sm' : 'text-rupeezy-fg-muted hover:text-rupeezy-fg'}`}>
                    {option === 'english' ? 'English' : 'Hinglish'}
                  </button>
                ))}
              </div>
              <div aria-hidden="true" className="h-20 sm:h-24 flex items-center justify-center gap-[4px] overflow-hidden my-3">
                {WAVE_HEIGHTS.map((height, index) => (
                  <span key={index} className={`w-[4px] shrink-0 rounded-full ${index > 6 && index < 20 ? 'bg-rupeezy-accent/80' : 'bg-rupeezy-accent/30'}`} style={{ height }} />
                ))}
              </div>
              <div aria-live="polite" aria-atomic="true" className="space-y-4">
                <div className="pl-8">
                  <p className="text-[10px] uppercase tracking-wider text-rupeezy-fg-faint mb-2 text-right">
                    Lead
                  </p>
                  <p className="rounded-xl rounded-tr-sm border border-rupeezy-border bg-rupeezy-card p-3.5 text-[13px] leading-relaxed">
                    {preview.lead}
                  </p>
                </div>
                <div className="pr-4">
                  <p className="text-[10px] uppercase tracking-wider text-rupeezy-accent mb-2 flex items-center gap-1.5">
                    <Sparkles size={11} aria-hidden="true" />
                    Aria
                  </p>
                  <p className="text-[13px] leading-relaxed text-rupeezy-fg-muted">
                    {preview.agent}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-rupeezy-border bg-rupeezy-card/70 p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="inline-flex items-center gap-2 text-xs text-rupeezy-fg-muted">
                  <FileText size={14} aria-hidden="true" />
                  What the handoff captures
                </span>
                <span className="text-[10px] tracking-wider font-medium text-rupeezy-warm bg-rupeezy-warm-faint border border-rupeezy-warm/20 rounded px-2 py-1">
                  WARM
                </span>
              </div>
              <p className="text-xs leading-relaxed text-rupeezy-fg mb-2">
                {preview.evidence}. Interested, with no signup commitment yet.
              </p>
              <p className="text-[11px] text-rupeezy-fg-faint">
                Authored example. No live call or classification runs here.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 lg:mt-14 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rupeezy-border bg-rupeezy-card/40 px-5 py-4">
        <p className="text-sm text-rupeezy-fg-muted">
          Your business. Your offer. Your agent’s voice.
        </p>
        <Link to="/configure" className="inline-flex items-center gap-2 text-sm font-medium text-rupeezy-accent shrink-0 hover:text-rupeezy-fg transition-colors">
          Configure your agent
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

import { Link } from 'react-router-dom';

export default function ChatPage() {
  return (
    <PlaceholderPage
      phase="Phase 2"
      title="Text chat"
      blurb="Conversation engine: Gemini 2.5 Flash + Appendix A RAG + 5 objections + multilingual."
    />
  );
}

export function PlaceholderPage({
  phase,
  title,
  blurb,
}: {
  phase: string;
  title: string;
  blurb: string;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="text-xs uppercase tracking-widest text-rupeezy-accent mb-2">{phase}</div>
        <h1 className="text-2xl font-semibold mb-3">{title}</h1>
        <p className="text-slate-400 text-sm mb-6">{blurb}</p>
        <p className="text-slate-500 text-xs mb-6">Lands in a later phase. Phase 0 verifies routing only.</p>
        <Link to="/" className="text-rupeezy-accent hover:underline text-sm">
          ← back to home
        </Link>
      </div>
    </div>
  );
}

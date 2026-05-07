/**
 * Brand mark — the small "R" logo + wordmark used in headers across pages.
 * Serif R (Fraunces) over a glass square; wordmark in light tracking.
 */
export function Brand({
  size = 'md',
  to,
}: {
  size?: 'sm' | 'md' | 'lg';
  to?: string;
}) {
  const dims = {
    sm: { box: 'w-7 h-7', text: 'text-base', word: 'text-xs' },
    md: { box: 'w-9 h-9', text: 'text-lg', word: 'text-sm' },
    lg: { box: 'w-11 h-11', text: 'text-xl', word: 'text-base' },
  }[size];

  const inner = (
    <div className="flex items-center gap-3">
      <div
        className={`${dims.box} rounded-md bg-rupeezy-card border border-rupeezy-border flex items-center justify-center font-serif ${dims.text} text-rupeezy-fg shadow-glass-inset`}
        aria-hidden
      >
        R
      </div>
      <div className="flex flex-col leading-tight">
        <span className={`font-serif ${dims.word} text-rupeezy-fg tracking-tight`}>
          Rupeezy
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-rupeezy-fg-faint">
          Partner Agent
        </span>
      </div>
    </div>
  );

  if (to) {
    return (
      <a
        href={to}
        className="inline-flex items-center hover:opacity-80 transition-opacity"
      >
        {inner}
      </a>
    );
  }
  return inner;
}

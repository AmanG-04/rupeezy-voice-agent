/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Refined dark palette — deeper, more neutral, less blue.
        rupeezy: {
          ink: '#0A0A0F',          // page bg, deepest
          surface: '#0F0F14',      // panel base
          card: '#15151B',         // raised card
          elevated: '#1A1A22',     // even more raised (modals)
          border: '#1F1F28',       // hairline
          'border-subtle': '#16161F',
          // Foreground tokens
          fg: '#F5F5FA',           // primary text
          'fg-muted': '#9A9AAB',   // secondary
          'fg-faint': '#5A5A6A',   // captions, metadata
          // Brand accent — softer indigo, less saturated
          accent: '#7C7CFF',
          'accent-faint': '#7C7CFF20',
          'accent-glow': '#7C7CFF40',
          // Status — desaturated, sophisticated
          hot: '#FF6B6B',
          'hot-faint': '#FF6B6B15',
          warm: '#F2C94C',
          'warm-faint': '#F2C94C15',
          cold: '#7A8597',
          'cold-faint': '#7A859715',
          ok: '#5BCB8A',
          'ok-faint': '#5BCB8A15',
        },
      },
      fontFamily: {
        // Body & UI
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        // Serif headlines — Fraunces is a contemporary modern serif with
        // optical sizing and weights well-suited to dark UIs.
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        // Mono for IDs, timestamps, code
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      letterSpacing: {
        tightish: '-0.011em',
        tighter: '-0.022em',
      },
      boxShadow: {
        // Subtle glass inner glow
        'glass-inset': 'inset 0 1px 0 0 rgba(255,255,255,0.06)',
        'glass-card': 'inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 0 0 rgba(0,0,0,0.4)',
        'soft': '0 8px 24px -8px rgba(0,0,0,0.5)',
        'lifted': '0 24px 64px -24px rgba(0,0,0,0.7)',
      },
      backgroundImage: {
        // Radial vignettes used as subtle backgrounds
        'glow-accent': 'radial-gradient(circle at top, rgba(124,124,255,0.10), transparent 60%)',
        'glow-subtle': 'radial-gradient(circle at top, rgba(255,255,255,0.04), transparent 60%)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 240ms ease-out',
      },
    },
  },
  plugins: [],
};

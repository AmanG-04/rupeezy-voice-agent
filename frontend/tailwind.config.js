/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rupeezy: {
          ink: '#0B1220',
          surface: '#0F172A',
          card: '#1E293B',
          accent: '#6366F1',
          hot: '#EF4444',
          warm: '#F59E0B',
          cold: '#64748B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

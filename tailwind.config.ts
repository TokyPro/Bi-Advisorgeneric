import type { Config } from 'tailwindcss';
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface2) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        brand: { pink: 'rgb(var(--b-pink) / <alpha-value>)', blue: 'rgb(var(--b-blue) / <alpha-value>)', violet: 'rgb(var(--b-violet) / <alpha-value>)', aqua: 'rgb(var(--b-aqua) / <alpha-value>)', navy: 'rgb(var(--b-navy) / <alpha-value>)' },
      },
      fontFamily: { sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      borderRadius: { '4xl': '2rem' },
      boxShadow: { soft: '0 10px 40px -12px rgba(95,100,200,.25)', card: '0 2px 20px -4px rgba(60,60,120,.10)' },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        blink: { '0%,92%,100%': { transform: 'scaleY(1)' }, '96%': { transform: 'scaleY(.1)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.35' } },
      },
      animation: { float: 'float 4s ease-in-out infinite', blink: 'blink 5s infinite', pulseDot: 'pulseDot 1.2s infinite' },
    },
  },
  plugins: [],
};
export default config;

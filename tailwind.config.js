/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'gene-purple': '#6C5CE7',
        'life-cyan': '#00CEC9',
        app: 'var(--bg)',
        panel: 'var(--bg-panel)',
        surface: 'var(--bg-surface)',
        'surface-strong': 'var(--bg-surface-strong)',
        glass: 'var(--bg-glass)',
        ink: 'var(--text)',
        sub: 'var(--text-secondary)',
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        msgai: 'var(--msg-ai)',
        msgaitxt: 'var(--msg-ai-text)',
      },
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

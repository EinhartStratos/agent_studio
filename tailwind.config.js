/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'native-bg': 'var(--native-bg)',
        'native-bg-soft': 'var(--native-bg-soft)',
        'native-panel': 'var(--native-panel)',
        'native-panel-2': 'var(--native-panel-2)',
        'native-border': 'var(--native-border)',
        'native-border-soft': 'var(--native-border-soft)',
        'native-text': 'var(--native-text)',
        'native-muted': 'var(--native-muted)',
        'native-accent': 'var(--native-accent)',
        'native-accent-hover': 'var(--native-accent-hover)',
        'native-accent-soft': 'var(--native-accent-soft)',
        'native-input-bg': 'var(--native-input-bg)',
        'native-hover': 'var(--native-hover)',
        'native-hover-active': 'var(--native-hover-active)',
        'native-code-bg': 'var(--native-code-bg)',
        'native-pre-bg': 'var(--native-pre-bg)',
        'native-th-bg': 'var(--native-th-bg)',
        'native-glass': 'var(--native-glass)',
        'native-success': 'var(--native-success)',
        'native-warning': 'var(--native-warning)',
        'native-danger': 'var(--native-danger)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'system-ui',
          'Inter',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'JetBrains Mono',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        'glass': '0 1px 2px rgba(0,0,0,0.06), 0 8px 24px -8px rgba(0,0,0,0.10)',
        'soft': '0 1px 2px rgba(15,23,42,0.06), 0 10px 30px -12px rgba(15,23,42,0.15)',
        'card': '0 1px 3px rgba(0,0,0,0.08), 0 16px 40px -18px rgba(0,0,0,0.25)',
        'glow-violet': '0 10px 30px -12px rgba(139, 92, 246, 0.45)',
        'glow-indigo': '0 10px 30px -12px rgba(99, 102, 241, 0.45)',
        'glow-amber': '0 10px 28px -12px rgba(245, 158, 11, 0.4)',
        'lift': '0 20px 45px -20px rgba(79, 70, 229, 0.25), 0 6px 12px -4px rgba(15,23,42,0.08)',
        'inset-soft': 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.08)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
        '4xl': '1.5rem',
      },
      backgroundImage: {
        'mesh-dark':
          'radial-gradient(1200px 600px at 10% -10%, rgba(129,140,248,0.14), transparent 60%), radial-gradient(1000px 500px at 90% 0%, rgba(167,139,250,0.11), transparent 55%), radial-gradient(900px 500px at 50% 110%, rgba(56,189,248,0.07), transparent 60%)',
        'mesh-light':
          'radial-gradient(1200px 600px at 10% -10%, rgba(129,140,248,0.08), transparent 60%), radial-gradient(1000px 500px at 90% 0%, rgba(52,211,153,0.055), transparent 55%), radial-gradient(900px 500px at 50% 110%, rgba(96,165,250,0.045), transparent 60%)',
        'grad-accent':
          'linear-gradient(135deg, var(--native-accent) 0%, var(--native-accent-2, #a78bfa) 100%)',
        'grad-accent-soft':
          'linear-gradient(135deg, var(--native-accent-soft) 0%, rgba(167,139,250,0.11) 100%)',
        'grad-user':
          'linear-gradient(135deg, #6366f1 0%, #818cf8 50%, #a78bfa 100%)',
        'grad-assistant':
          'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))',
        'grad-think':
          'linear-gradient(135deg, rgba(167,139,250,0.15), rgba(129,140,248,0.10) 60%, rgba(56,189,248,0.09))',
        'grad-tool':
          'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(251,146,60,0.10) 60%, rgba(251,191,36,0.11))',
        'grad-market':
          'linear-gradient(135deg, rgba(129,140,248,0.19), rgba(167,139,250,0.16) 45%, rgba(251,207,232,0.11))',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 180ms ease-out both',
        'lift-in': 'liftIn 200ms cubic-bezier(0.22,1,0.36,1) both',
        'pulse-soft': 'pulseSoft 2.2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: 0, transform: 'translateY(2px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        liftIn: {
          from: { opacity: 0, transform: 'translateY(6px) scale(0.995)' },
          to:   { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: 0.85 },
          '50%':     { opacity: 0.55 },
        },
      },
    },
  },
  plugins: [],
};

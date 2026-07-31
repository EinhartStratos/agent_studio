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
        'native-panel': 'var(--native-panel)',
        'native-border': 'var(--native-border)',
        'native-text': 'var(--native-text)',
        'native-muted': 'var(--native-muted)',
        'native-accent': 'var(--native-accent)',
      },
    },
  },
  plugins: [],
};

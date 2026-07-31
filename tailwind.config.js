/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'native-bg': '#0f0f0f',
        'native-panel': '#1a1a1a',
        'native-border': '#2a2a2a',
        'native-text': '#e6e6e6',
        'native-muted': '#888888',
        'native-accent': '#2563eb',
      },
    },
  },
  plugins: [],
};

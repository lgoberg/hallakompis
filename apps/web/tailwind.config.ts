import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        cream: {
          DEFAULT: '#F2ECE0',
          light: '#FBF6EC',
        },
        paper: '#FDFAF3',
        ink: {
          DEFAULT: '#1A1816',
          soft: '#4A453F',
        },
        muted: '#8B857C',
        faint: '#B8B2A6',
        forest: '#2D4A3E',
        copper: '#B8763D',
        amber: '#DAA94E',
        sage: '#7A8D7A',
        coral: '#C45C48',
        plum: '#6B4A6B',
        src: {
          fw: '#3B5C8A',
          work: '#2D4A3E',
          personal: '#B8763D',
          kids: '#C45C48',
          school: '#6B4A6B',
        },
        dark: {
          bg: '#141311',
          card: '#1F1D1A',
          'card-hi': '#26231F',
          text: '#E8E2D5',
          muted: '#8A857C',
          faint: '#5A544C',
        },
      },
      borderColor: {
        DEFAULT: 'rgba(26, 24, 22, 0.08)',
        strong: 'rgba(26, 24, 22, 0.16)',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(26,24,22,0.04), 0 4px 16px rgba(26,24,22,0.04)',
        card: '0 1px 2px rgba(26,24,22,0.04), 0 8px 24px rgba(26,24,22,0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;

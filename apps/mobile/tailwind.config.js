/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './app/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#0a0a0a',
          light: '#ffffff',
        },
        foreground: {
          DEFAULT: '#ededed',
          light: '#171717',
        },
        accent: {
          DEFAULT: '#00ffff',
          soft: 'rgba(0,255,255,0.55)',
          faint: 'rgba(0,255,255,0.22)',
        },
        muted: '#aaa',
        surface: {
          DEFAULT: '#111111',
          raised: '#1a1a1a',
          overlay: '#222222',
        },
      },
      fontFamily: {
        display: ['CormorantGaramond', 'serif'],
        mono: ['DMMono', 'monospace'],
        sans: ['Outfit', 'sans-serif'],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
    },
  },
  plugins: [],
};

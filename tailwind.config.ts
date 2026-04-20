import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        navy: {
          50: '#eef3f8',
          100: '#c8dcf0',
          300: '#6ca7d4',
          500: '#2b5278',
          700: '#1b3b5a',
          900: '#0f2338',
        },
        teal: {
          100: '#e6f3ee',
          400: '#2ea87e',
          600: '#1a7a55',
        },
        page: '#f4f6f9',
        surface: '#eef3f8',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xs: '4px',
        xl: '12px',
        pill: '20px',
      },
      borderWidth: {
        hairline: '0.5px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(27, 59, 90, 0.06), 0 1px 2px rgba(27, 59, 90, 0.04)',
        panel: '0 4px 12px rgba(27, 59, 90, 0.08)',
      },
      fontSize: {
        caption: ['11px', { lineHeight: '1.4', letterSpacing: '0.04em' }],
        label: ['12px', { lineHeight: '1.5' }],
        body: ['13px', { lineHeight: '1.6' }],
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;

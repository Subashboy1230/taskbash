// Tailwind v4 uses a single PostCSS plugin. No separate tailwind.config.js needed —
// theme is configured directly in globals.css using @theme.

const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config

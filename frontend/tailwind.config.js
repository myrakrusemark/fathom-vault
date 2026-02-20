/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      borderRadius: {
        '3xl': '1.5rem',
        '4xl': '2rem'
      }
    }
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        fathom: {
          "primary": "#F4A261",
          "primary-content": "#1A1A2E",
          "secondary": "#8B5CF6",
          "secondary-content": "#FFFFFF",
          "accent": "#06B6D4",
          "accent-content": "#1A1A2E",
          "neutral": "#2A2A4A",
          "neutral-content": "#C8C8E0",
          "base-100": "#1A1A2E",
          "base-200": "#1E1E38",
          "base-300": "#252545",
          "base-content": "#E0E0F0",
          "info": "#38BDF8",
          "info-content": "#1A1A2E",
          "success": "#4ADE80",
          "success-content": "#1A1A2E",
          "warning": "#FBBF24",
          "warning-content": "#1A1A2E",
          "error": "#FB7185",
          "error-content": "#1A1A2E",
          "--rounded-box": "1rem",
          "--rounded-btn": "0.75rem",
          "--rounded-badge": "1rem",
          "--tab-radius": "0.75rem",
          "--animation-btn": "0.25s",
          "--animation-input": "0.2s",
          "--btn-focus-scale": "0.98",
          "--border-btn": "1px",
        }
      }
    ],
  }
}

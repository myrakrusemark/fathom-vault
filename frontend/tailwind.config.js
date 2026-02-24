/** @type {import('tailwindcss').Config} */
const sharedThemeVars = {
  "--rounded-box": "1rem",
  "--rounded-btn": "0.75rem",
  "--rounded-badge": "1rem",
  "--tab-radius": "0.75rem",
  "--animation-btn": "0.25s",
  "--animation-input": "0.2s",
  "--btn-focus-scale": "0.98",
  "--border-btn": "1px",
}

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
        "fathom-v": {
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
          ...sharedThemeVars,
        }
      },
      {
        "fathom-m": {
          "primary": "#06B6D4",
          "primary-content": "#0F1D20",
          "secondary": "#F4A261",
          "secondary-content": "#0F1D20",
          "accent": "#8B5CF6",
          "accent-content": "#0F1D20",
          "neutral": "#1A3036",
          "neutral-content": "#B0D4DC",
          "base-100": "#0F1D20",
          "base-200": "#142528",
          "base-300": "#1C3338",
          "base-content": "#E0F0F2",
          "info": "#38BDF8",
          "info-content": "#0F1D20",
          "success": "#4ADE80",
          "success-content": "#0F1D20",
          "warning": "#FBBF24",
          "warning-content": "#0F1D20",
          "error": "#FB7185",
          "error-content": "#0F1D20",
          ...sharedThemeVars,
        }
      },
      {
        "fathom-a": {
          "primary": "#F4A261",
          "primary-content": "#1E1610",
          "secondary": "#06B6D4",
          "secondary-content": "#1E1610",
          "accent": "#8B5CF6",
          "accent-content": "#1E1610",
          "neutral": "#3A2E20",
          "neutral-content": "#D4C4AC",
          "base-100": "#1E1610",
          "base-200": "#261E16",
          "base-300": "#352A1E",
          "base-content": "#F0E8DC",
          "info": "#38BDF8",
          "info-content": "#1E1610",
          "success": "#4ADE80",
          "success-content": "#1E1610",
          "warning": "#FBBF24",
          "warning-content": "#1E1610",
          "error": "#FB7185",
          "error-content": "#1E1610",
          ...sharedThemeVars,
        }
      },
      {
        "fathom-c": {
          "primary": "#4ADE80",
          "primary-content": "#101E14",
          "secondary": "#F4A261",
          "secondary-content": "#101E14",
          "accent": "#8B5CF6",
          "accent-content": "#101E14",
          "neutral": "#1E3E28",
          "neutral-content": "#A8D4B4",
          "base-100": "#101E14",
          "base-200": "#162618",
          "base-300": "#1E3422",
          "base-content": "#DCF0E4",
          "info": "#38BDF8",
          "info-content": "#101E14",
          "success": "#86EFAC",
          "success-content": "#101E14",
          "warning": "#FBBF24",
          "warning-content": "#101E14",
          "error": "#FB7185",
          "error-content": "#101E14",
          ...sharedThemeVars,
        }
      },
    ],
  }
}

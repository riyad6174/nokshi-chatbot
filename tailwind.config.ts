import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1c1917",
        sand: "#f7f3ec",
        clay: "#b45309",
        teal: "#0f766e",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 24px 60px -12px rgba(28, 25, 23, 0.25)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Chat panel opening from the launcher corner.
        "panel-in": {
          "0%": { opacity: "0", transform: "translateY(16px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "bubble-in-left": {
          "0%": { opacity: "0", transform: "translateX(-10px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        "bubble-in-right": {
          "0%": { opacity: "0", transform: "translateX(10px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        pop: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "70%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "30%": { transform: "translateY(-4px)", opacity: "1" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.55" },
          "100%": { transform: "scale(1.7)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        wiggle: {
          "0%, 100%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(-8deg)" },
          "75%": { transform: "rotate(8deg)" },
        },
      },
      animation: {
        "fade-up": "fade-up 180ms ease-out",
        "panel-in": "panel-in 260ms cubic-bezier(0.2, 0.9, 0.3, 1.15)",
        "bubble-in-left": "bubble-in-left 220ms ease-out both",
        "bubble-in-right": "bubble-in-right 220ms ease-out both",
        pop: "pop 320ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both",
        "typing-dot": "typing-dot 1.1s ease-in-out infinite",
        "pulse-ring": "pulse-ring 1.6s ease-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        wiggle: "wiggle 400ms ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;

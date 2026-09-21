import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        page: "var(--color-page)",
        surface: "var(--color-surface)",
        "surface-muted": "var(--color-surface-muted)",
        "surface-elevated": "var(--color-surface-elevated)",
        primary: "var(--color-primary)",
        "primary-text": "var(--color-primary-text)",
        secondary: "var(--color-secondary)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        border: "var(--color-border)",
        accent: {
          tint: "var(--color-accent-tint)",
          DEFAULT: "var(--color-accent)",
        },
        hero: {
          DEFAULT: "var(--color-hero)",
          border: "var(--color-hero-border)",
          foreground: "var(--color-hero-foreground)",
          muted: "var(--color-hero-muted)",
          secondary: "var(--color-hero-secondary)",
        },
        // Floating surfaces (tooltips): dark in both themes, deliberately not
        // tied to the hero tokens so the briefing can follow the theme.
        tooltip: {
          DEFAULT: "var(--color-tooltip)",
          foreground: "var(--color-tooltip-foreground)",
        },
        category: {
          activity: "var(--color-category-activity)",
          cardiovascular: "var(--color-category-cardiovascular)",
          sleep: "var(--color-category-sleep)",
          body: "var(--color-category-body)",
          nutrition: "var(--color-category-nutrition)",
          respiratory: "var(--color-category-respiratory)",
          recovery: "var(--color-category-recovery)",
          attention: "var(--color-category-attention)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          '"Segoe UI"',
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "var(--radius-card)",
        control: "var(--radius-control)",
      },
      spacing: {
        sidebar: "var(--sidebar-width)",
      },
      maxWidth: {
        content: "var(--content-max-width)",
      },
      transitionDuration: {
        DEFAULT: "200ms",
      },
    },
  },
  plugins: [],
};

export default config;
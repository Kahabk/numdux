/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0E0E0E",
        notebook: "#141414",
        panel: "#1A1A1A",
        line: "#2A2A2A",
        ink: "#F5F5F5",
        muted: "#9A9A9A",
        accent: "#6C8CFF",
        ok: "#6FAF83",
        warn: "#C9A45D",
        bad: "#C46A6A"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "ui-monospace", "monospace"]
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px"
      }
    }
  },
  plugins: []
};


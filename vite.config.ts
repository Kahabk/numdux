import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiUrl = process.env.VITE_API_URL || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "backend/app/dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ["@monaco-editor/react"],
          recharts: ["recharts"],
          table: ["@tanstack/react-table"],
          query: ["@tanstack/react-query"],
          icons: ["lucide-react"]
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiUrl
    }
  }
});

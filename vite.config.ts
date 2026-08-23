import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Suppress chunk size warning — bundle is intentionally large for this SPA
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: true,
    fs: { strict: true, deny: ["**/.*"] },
  },
  // Define optional analytics env vars as empty strings so Vite doesn't warn
  define: {
    "import.meta.env.VITE_ANALYTICS_ENDPOINT": JSON.stringify(
      process.env.VITE_ANALYTICS_ENDPOINT ?? ""
    ),
    "import.meta.env.VITE_ANALYTICS_WEBSITE_ID": JSON.stringify(
      process.env.VITE_ANALYTICS_WEBSITE_ID ?? ""
    ),
  },
});

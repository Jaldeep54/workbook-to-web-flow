import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * The frontend is a plain single-page app: Vite builds a static bundle that
 * talks to the Klinzo Operations API over REST. There is no server entry, no
 * server functions and no database client here — `VITE_API_BASE_URL` is the
 * only thing it needs to know about the backend.
 */
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    viteReact(),
  ],
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  server: {
    host: true,
    port: 8080,
  },
  preview: { port: 8080 },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});

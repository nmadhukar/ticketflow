import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

/**
 * CopilotKit's v2 bundle imports its own stylesheet (`import "./index.css"`), which is built with
 * Tailwind v4 cascade layers. Vite would run it through this app's Tailwind v3 PostCSS step, which
 * rejects it ("@layer base is used but no matching @tailwind base"). This resolves that one file to
 * a small module that adds the CSS as a <style> when it first loads: it stays in the lazily loaded
 * assistant chunk, and its layered rules never override the app's own (unlayered) styles.
 */
function copilotKitStyles(): Plugin {
  const VIRTUAL = "\0copilotkit-v2-styles";
  const target = /[\\/]@copilotkit[\\/]react-core[\\/]dist[\\/]v2[\\/]index\.css$/;
  let file = "";
  return {
    name: "ticketflow:copilotkit-styles",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(".css") || !importer) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved || !target.test(resolved.id)) return null;
      file = resolved.id;
      return VIRTUAL;
    },
    load(id) {
      if (id !== VIRTUAL) return null;
      const css = JSON.stringify(readFileSync(file, "utf8"));
      return `if (typeof document !== "undefined" && !document.getElementById("copilotkit-v2-styles")) {
  const style = document.createElement("style");
  style.id = "copilotkit-v2-styles";
  style.textContent = ${css};
  document.head.appendChild(style);
}`;
    },
  };
}

export default defineConfig({
  plugins: [copilotKitStyles(), react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/ws": {
        target: "http://localhost:5000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

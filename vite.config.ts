import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "node:fs";

/**
 * CopilotKit's JS bundle hard-imports its own stylesheet
 * (node_modules/@copilotkit/react-core/dist/v2/index.mjs does `import "./index.css"`).
 * That stylesheet is already-compiled Tailwind v4 output - a `@layer base` block with no
 * `@tailwind` directive - and this project runs Tailwind v3, whose PostCSS plugin refuses
 * exactly that shape ("`@layer base` is used but no matching `@tailwind base` directive is
 * present"). Tailwind's plugin, not Vite's, is the wall, and PostCSS config is resolved once
 * for the whole build so it cannot be made per-file.
 *
 * This plugin redirects the package's own stylesheet import to a virtual JS module that
 * exports the file's text. That import then injects nothing, and the app loads the CSS
 * itself with `?raw` (see client/src/components/CopilotPopupLazy.tsx) - the one path that
 * skips PostCSS. A `?raw` import is left untouched so that self-load still works.
 *
 * The import arrives in two shapes. During `vite build` it is the package's own relative
 * `import "./index.css"`. During `vite dev`, Vite's dependency optimiser pre-bundles the
 * package into node_modules/.vite/deps and rewrites the import to an absolute path, which
 * esbuild bakes in before Vite plugins run; matching only the relative shape let that one
 * through, so the same PostCSS error reappeared in the dev console. The resolver below
 * therefore normalises the specifier to a real path first and accepts either shape.
 */
function copilotKitCssAsJs(): Plugin {
  const VIRTUAL_PREFIX = "\0copilot-css:";
  // The precompiled stylesheets CopilotKit ships in its `dist` folders. Both the source
  // `import "./index.css"` (seen during `vite build`) and the absolute path the dev
  // pre-bundler rewrites it to (seen in node_modules/.vite/deps/*.js during `vite dev`)
  // must land on the same file.
  const copilotDistCss = /[\\/]node_modules[\\/]@copilotkit[\\/][^\\/]+[\\/]dist[\\/].+\.css$/;
  return {
    name: "copilotkit-css-as-js",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.includes("?")) return null;
      if (!source.endsWith(".css")) return null;
      // Resolve the specifier to a real path so the check below works for both shapes:
      // a relative `./index.css` from inside the package, and the absolute path the dev
      // pre-bundler emits. A bare specifier such as `katex/dist/katex.min.css` is left to
      // Vite, whose resolver finds it correctly.
      let resolved: string;
      if (path.isAbsolute(source)) {
        resolved = source;
      } else if (source.startsWith(".")) {
        if (!importer) return null;
        resolved = path.resolve(path.dirname(importer.split("?")[0]), source);
      } else {
        return null;
      }
      if (!copilotDistCss.test(resolved)) return null;
      // The trailing ".js" is a marker only: it makes Vite treat the id as JS. The
      // file it stands for is recovered in load() by stripping the marker.
      return `${VIRTUAL_PREFIX}${resolved}.js`;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;
      const file = id.slice(VIRTUAL_PREFIX.length, -".js".length);
      return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
    },
  };
}

export default defineConfig({
  plugins: [copilotKitCssAsJs(), react()],
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

import { defineConfig } from "astro/config";
import pagefind from "astro-pagefind";
import { fileURLToPath } from "node:url";
import { assertNonEmptySitemaps } from "./scripts/lib/sitemap-build-check.mjs";

const FONT_FILE = /\.(woff2?|ttf|otf|eot)(\?.*)?$/i;

export default defineConfig({
  site: "https://ukelections.co.uk",
  integrations: [pagefind(), {
    name: "validate-built-sitemaps",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const maps = assertNonEmptySitemaps(fileURLToPath(dir));
        console.log(`Validated ${maps.length} non-empty built sitemap(s).`);
      },
    },
  }],
  vite: {
    build: {
      // Never inline a font as a data: URI. Vite's 4KB default swallowed the one
      // Manrope subset small enough to qualify (Cyrillic-Extended, 2,553 bytes),
      // and the site CSP sets font-src 'self', so the browser blocked it. Emitting
      // every subset as a real file under /_astro/ keeps the policy tight and drops
      // 3.4KB of base64 out of the render-blocking stylesheet. Returning undefined
      // leaves all other asset types on Vite's normal size threshold.
      assetsInlineLimit: (filePath) => (FONT_FILE.test(filePath) ? false : undefined),
    },
  },
});

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Fail the build if any generated sitemap contains no locations. */
export function assertNonEmptySitemaps(directory) {
  const maps = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith(".xml")) {
        const xml = readFileSync(file, "utf8");
        if (/<(?:urlset|sitemapindex)\b/.test(xml)) {
          if (!/<loc>\s*https?:\/\/[^<\s]+\s*<\/loc>/.test(xml)) {
            throw new Error(`Empty sitemap: ${path.relative(directory, file)}`);
          }
          maps.push(file);
        }
      }
    }
  }
  visit(directory);
  if (!maps.length) throw new Error("No built sitemap found");
  return maps;
}

import { expect, it } from "vitest";
import { GET } from "../src/pages/robots.txt";
import { SITE_URL } from "../src/lib/site";

it("emits each robots user agent once and preserves crawler policy", async () => {
  const response = await GET({} as Parameters<typeof GET>[0]);
  const text = await response.text();
  const agents = [...text.matchAll(/^User-agent:\s*(.+)$/gmi)].map(match => match[1].trim().toLowerCase());
  expect(new Set(agents).size).toBe(agents.length);
  expect(agents.sort()).toEqual(["*", "claudebot", "google-extended", "gptbot", "oai-searchbot", "perplexitybot"]);
  for (const agent of ["GPTBot", "ClaudeBot", "Google-Extended"]) expect(text).toContain(`User-agent: ${agent}\nDisallow: /`);
  for (const agent of ["*", "OAI-SearchBot", "PerplexityBot"]) expect(text).toContain(`User-agent: ${agent}\nAllow: /`);
  expect(text).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
});

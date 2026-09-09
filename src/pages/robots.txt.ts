import type { APIRoute } from "astro";
import { SITE_URL } from "../lib/site";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(`# Citation and answer-search crawlers are allowed explicitly.\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\n# Preserve the existing editorial policy against model training and Gemini grounding.\n# These directives do not block Google Search, Bing, ChatGPT Search, or Perplexity.\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\nSitemap: ${SITE_URL}/sitemap-news.xml\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });

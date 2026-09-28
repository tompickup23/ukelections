import type { APIRoute } from "astro";
import { existsSync } from "node:fs";
import path from "node:path";
import articles from "../../data/editorial/articles.json";
import { recentNewsArticles, type EditorialArticle } from "../lib/editorial";
import { SITE_URL } from "../lib/site";
export const prerender = true;
const esc = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const GET: APIRoute = () => {
  const recent = recentNewsArticles(articles as EditorialArticle[]);
  for (const article of recent) {
    const source = path.join(process.cwd(), "src/pages", article.path, "index.astro");
    if (!existsSync(source)) throw new Error(`News registry route has no article: ${article.path}`);
  }
  if (recent.length > 1000) throw new Error("News sitemap needs pagination above 1,000 articles");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${recent.map(article => `<url><loc>${SITE_URL}${article.path}</loc><news:news><news:publication><news:name>UK Elections</news:name><news:language>en</news:language></news:publication><news:publication_date>${esc(article.firstPublishedAt)}</news:publication_date><news:title>${esc(article.title)}</news:title></news:news></url>`).join("")}</urlset>\n`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};

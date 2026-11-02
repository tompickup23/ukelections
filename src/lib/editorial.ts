/** An explicitly reviewed article, never inferred from a generated contest. */
export interface EditorialArticle {
  path: string;
  title: string;
  summary: string;
  methodologyUrl: string;
  correctionsUrl: string;
  author: { name: string; url: string };
  firstPublishedAt: string;
  modifiedAt?: string;
  substantiveUpdate?: string;
  primarySources: string[];
  reviewedAt: string;
  reviewer: string;
}
const stamp = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function validateEditorialRegistry(articles: EditorialArticle[], now = new Date()): EditorialArticle[] {
  const seen = new Set<string>();
  for (const article of articles) {
    if (!/^\/news\/[a-z0-9-]+\/$/.test(article.path) || seen.has(article.path)) throw new Error("Editorial articles need distinct /news/ routes");
    seen.add(article.path);
    if (!article.title?.trim() || !article.summary?.trim() || !article.author?.name?.trim() || !article.reviewer?.trim()) throw new Error("Missing editorial attribution");
    if (!stamp(article.firstPublishedAt) || Date.parse(article.firstPublishedAt) > +now || !stamp(article.reviewedAt) || Date.parse(article.reviewedAt) > +now) throw new Error("Invalid or future editorial timestamp");
    if (!article.primarySources?.length || ![article.author.url, article.methodologyUrl, article.correctionsUrl, ...article.primarySources].every(url => /^https:\/\//.test(url))) throw new Error("Missing editorial source links");
    if (article.modifiedAt && (!stamp(article.modifiedAt) || Date.parse(article.modifiedAt) < Date.parse(article.firstPublishedAt) || Date.parse(article.modifiedAt) > +now || !article.substantiveUpdate?.trim())) throw new Error("A substantive update needs a valid date and explanation");
  }
  return articles;
}
export function recentNewsArticles(articles: EditorialArticle[], now = new Date()) {
  return validateEditorialRegistry(articles, now).filter(article => +now - Date.parse(article.firstPublishedAt) < 48 * 3600000);
}

const xmlEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * Google News sitemap XML for the reviewed articles first published in the
 * last 48 hours. Not served at present.
 *
 * /sitemap-news.xml used to be generated on every build and declared in
 * robots.txt, but the register is empty by design (see
 * data/editorial/README.md), so it served an empty <urlset> that Search
 * Console reported as an error (SEO audit, 2 November 2026). Generated
 * by-election result pages were not used to fill it: they are automated
 * records, not reviewed articles, and their publication dates are stamped by
 * the publisher after the build, so the build cannot tell which fall inside
 * the two-day window. To serve it again once there are articles, add a
 * prerendered route that returns this string and put the Sitemap line back
 * in src/pages/robots.txt.ts.
 */
export function newsSitemapXml(articles: EditorialArticle[], siteUrl: string, now = new Date()): string {
  const recent = recentNewsArticles(articles, now);
  if (recent.length > 1000) throw new Error("News sitemap needs pagination above 1,000 articles");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${recent.map(article => `<url><loc>${siteUrl}${article.path}</loc><news:news><news:publication><news:name>UK Elections</news:name><news:language>en</news:language></news:publication><news:publication_date>${xmlEscape(article.firstPublishedAt)}</news:publication_date><news:title>${xmlEscape(article.title)}</news:title></news:news></url>`).join("")}</urlset>\n`;
}

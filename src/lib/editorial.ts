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

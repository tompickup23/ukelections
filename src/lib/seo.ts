import { SITE_NAME, SITE_URL } from "./site";

/**
 * Structured-data builders shared across page templates.
 *
 * site.ts is deliberately import-free (its metadata tests load it in isolation),
 * so anything that needs to compose several site constants lives here instead.
 *
 * Every builder returns a plain JSON-LD node. BaseLayout serialises whatever it
 * is handed, so the shapes below are the only place the schema.org vocabulary is
 * spelled out and the only place to fix it.
 */

export interface Crumb {
  /** Label shown in the trail and in the SERP breadcrumb. */
  name: string;
  /** Site-absolute path, with the trailing slash the site uses everywhere. */
  href: string;
}

/** The home crumb every trail starts with. Callers pass the trail below it. */
export const HOME_CRUMB: Crumb = { name: SITE_NAME, href: "/" };

const absolute = (href: string) =>
  /^https?:\/\//.test(href) ? href : new URL(href, `${SITE_URL}/`).toString();

/**
 * BreadcrumbList for `trail`, with the home crumb prepended.
 *
 * Callers pass only the path below the root, last item being the current page,
 * so no template can ship a trail that starts somewhere other than the site
 * root or that disagrees with another template about what the root is called.
 */
export function buildBreadcrumbList(trail: Crumb[]): Record<string, unknown> {
  const crumbs = [HOME_CRUMB, ...trail];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.href)
    }))
  };
}

/** The publisher node Google requires on every Article/NewsArticle. */
export function publisherNode(): Record<string, unknown> {
  return {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/og-default.png`,
      width: 1200,
      height: 630
    }
  };
}

export interface NewsArticleInput {
  headline: string;
  description: string;
  /** Canonical page URL. */
  url: string;
  /** ISO 8601 with offset. The date the reported event became reportable. */
  datePublished: string;
  /** ISO 8601 with offset. */
  dateModified?: string;
  image?: string;
}

/**
 * NewsArticle for a dated contest page.
 *
 * Google truncates a headline past 110 characters in News surfaces and treats a
 * longer one as a spec violation, so this refuses rather than silently shipping
 * one: a build failure is cheaper than a page quietly dropped from News.
 */
export function buildNewsArticle(input: NewsArticleInput): Record<string, unknown> {
  if (input.headline.length > 110) {
    throw new Error(
      `NewsArticle headline is ${input.headline.length} characters, over Google News' 110 limit: ${input.headline}`
    );
  }
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: input.headline,
    description: input.description,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.url },
    url: input.url,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    inLanguage: "en-GB",
    isAccessibleForFree: true,
    author: { "@type": "Person", name: "Tom Pickup", url: `${SITE_URL}/contact/` },
    publisher: publisherNode(),
    ...(input.image ? { image: [input.image] } : {})
  };
}

export interface DatasetInput {
  name: string;
  description: string;
  /** Canonical page URL. */
  url: string;
  /** e.g. "2024-07-04/2026-08-27" or "2026-05-07". */
  temporalCoverage?: string;
  /** Free-text area the data covers, e.g. "United Kingdom". */
  spatialCoverage?: string;
  /** The quantities the dataset actually reports. */
  variableMeasured?: string[];
  /** Absolute URL of a machine-readable distribution, where one exists. */
  distributionUrl?: string;
  distributionFormat?: string;
  keywords?: string[];
}

/**
 * Dataset node, for Google Dataset Search.
 *
 * Deliberately omits `distribution` unless a real machine-readable URL is
 * passed: claiming a download that does not exist is the single most common way
 * a Dataset entry gets pulled, and the pages here present their data as HTML.
 */
export function buildDataset(input: DatasetInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: input.name,
    description: input.description,
    url: input.url,
    inLanguage: "en-GB",
    isAccessibleForFree: true,
    license: "https://creativecommons.org/licenses/by/4.0/",
    creator: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL
    },
    publisher: publisherNode(),
    ...(input.temporalCoverage ? { temporalCoverage: input.temporalCoverage } : {}),
    ...(input.spatialCoverage
      ? { spatialCoverage: { "@type": "Place", name: input.spatialCoverage } }
      : {}),
    ...(input.variableMeasured?.length ? { variableMeasured: input.variableMeasured } : {}),
    ...(input.keywords?.length ? { keywords: input.keywords } : {}),
    ...(input.distributionUrl
      ? {
          distribution: [
            {
              "@type": "DataDownload",
              contentUrl: input.distributionUrl,
              encodingFormat: input.distributionFormat ?? "application/json"
            }
          ]
        }
      : {})
  };
}

/**
 * The instant a contest's result became reportable: 22:00 UK local time on
 * polling day, when polls close, expressed as a W3C datetime in UTC.
 *
 * Google News accepts a bare date but reads a full datetime as the article's
 * actual publication moment, which is what decides ordering in Top Stories. The
 * UK offset is derived from the date rather than hardcoded, so a result declared
 * during BST is not filed an hour late (and a December one not an hour early).
 *
 * Shared by the by-election template and sitemap-news.xml so a page and its news
 * sitemap entry can never disagree about when it was published.
 */
export function newsPublicationDate(pollingDay: string): string {
  const [year, month, day] = pollingDay.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Not an ISO date: ${pollingDay}`);
  }
  // Probe the same wall-clock time as UTC, ask what London calls it, and the
  // difference is London's offset on that date. Two hours either side of the
  // DST switchover this is still correct, because the switch happens at 01:00.
  const probe = Date.UTC(year, month - 1, day, 22, 0, 0);
  const londonParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(probe));
  const part = (type: string) => Number(londonParts.find((p) => p.type === type)?.value);
  const asLondon = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second")
  );
  const offsetMs = asLondon - probe;
  return new Date(probe - offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

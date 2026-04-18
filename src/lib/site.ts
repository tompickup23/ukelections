export const SITE_NAME = "UK Elections";
export const SITE_URL = "https://ukelections.co.uk";
export const DEFAULT_DESCRIPTION =
  "Election intelligence for every UK contest. Candidates, history, forecasts, confidence intervals, source notes, and honest backtests in one place.";
export const DEFAULT_SOCIAL_IMAGE_PATH = "/og-card.svg";

export type StructuredDataNode = Record<string, unknown>;

export interface ReleaseEntry {
  date: string;
  title: string;
  summary: string;
  sourceUrl: string;
}

export interface SearchEntry {
  href: string;
  title: string;
  kind: "page" | "section" | "release";
  description: string;
  priority: number;
}

export const NAV_ITEMS = [
  { href: "/seats/", label: "Seats" },
  { href: "/your-area/", label: "Your Area" },
  { href: "/forecasts/", label: "Forecasts" },
  { href: "/methodology/", label: "Methodology" },
  { href: "/sources/", label: "Sources" }
] as const;

export const RELEASES: ReleaseEntry[] = [
  {
    date: "2026-04-18",
    title: "UK Elections scaffold",
    summary: "Initial public scaffold, GitHub repository, Cloudflare Pages project, and placeholder deployment.",
    sourceUrl: SITE_URL
  }
];

const STATIC_PATHS = [
  "/",
  "/seats/",
  "/your-area/",
  "/forecasts/",
  "/methodology/",
  "/sources/",
  "/releases/",
  "/privacy/",
  "/terms/",
  "/accessibility/"
] as const;

export const SEARCH_ENTRIES: SearchEntry[] = [
  {
    href: "/seats/",
    title: "Seats",
    kind: "page",
    description: "Constituency and contest pages planned for candidates, history, boundaries, and local signals.",
    priority: 100
  },
  {
    href: "/your-area/",
    title: "Your Area",
    kind: "page",
    description: "Postcode and place lookup specification for the first usable constituency search.",
    priority: 95
  },
  {
    href: "/forecasts/",
    title: "Forecasts",
    kind: "page",
    description: "Forecasting framework, confidence bands, backtests, and publication rules.",
    priority: 90
  },
  {
    href: "/methodology/",
    title: "Methodology",
    kind: "page",
    description: "Source-first methodology for candidates, results, boundaries, polls, and probabilistic models.",
    priority: 85
  },
  {
    href: "/sources/",
    title: "Sources",
    kind: "page",
    description: "Planned primary data sources and ingestion status.",
    priority: 80
  }
];

export function normalisePageTitle(title: string): string {
  return /uk\s*elections/i.test(title) ? title : `${title} | ${SITE_NAME}`;
}

export function buildAbsoluteUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return new URL(normalizedPath, SITE_URL).toString();
}

export function getIndexableSitePaths(): string[] {
  return [...STATIC_PATHS].sort((a, b) => a.localeCompare(b));
}

export function getPublicSearchEntries(): SearchEntry[] {
  return [...SEARCH_ENTRIES].sort((left, right) => right.priority - left.priority);
}

export function buildReleaseCollectionStructuredData(
  releases: ReleaseEntry[],
  options: {
    canonicalUrl: string;
    description: string;
    socialImageUrl: string;
  }
): StructuredDataNode[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: SITE_URL
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Releases",
          item: options.canonicalUrl
        }
      ]
    },
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Release diary",
      description: options.description,
      url: options.canonicalUrl,
      image: options.socialImageUrl,
      isPartOf: {
        "@id": `${SITE_URL}/#website`
      }
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: releases.map((release, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "NewsArticle",
          headline: release.title,
          description: release.summary,
          datePublished: release.date,
          url: release.sourceUrl
        }
      }))
    }
  ];
}

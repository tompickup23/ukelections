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

/**
 * The person who runs the site, as the footer and /about/ describe them.
 *
 * Every property restates something the site already publishes in its own
 * words (footer, /about/, /contact/). Add nothing here that a reader cannot
 * already find on the site, and keep the description in step with the footer
 * disclosure: the party membership is stated, not softened or left out.
 */
export const AUTHOR_ID = `${SITE_URL}/about/#author`;
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

export function authorNode(): Record<string, unknown> {
  return {
    "@type": "Person",
    "@id": AUTHOR_ID,
    name: "Tom Pickup",
    url: `${SITE_URL}/about/`,
    description:
      "Runs UK Elections as an independent research project. A Lancashire county councillor and Reform UK member; no party, council, candidate or election authority has any say over what appears on the site.",
  };
}

/** Full Organization node for the site, with its contact route. */
export function organizationNode(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    ...publisherNode(),
    description:
      "An independent research project publishing UK election results, forecasts and boundaries from public data.",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "corrections and data queries",
      url: `${SITE_URL}/contact/`,
    },
  };
}

/** Standalone Person node, for pages that describe the author. */
export function personNode(): Record<string, unknown> {
  return { "@context": "https://schema.org", ...authorNode() };
}

/** Shared publisher identity for structured data. */
export function publisherNode(): Record<string, unknown> {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      // Square, as Google's logo guidance asks; the 1200x630 social card is not a logo.
      url: `${SITE_URL}/apple-touch-icon.png`,
      width: 180,
      height: 180
    }
  };
}

export interface NewsArticleInput {
  headline: string;
  description: string;
  /** Canonical page URL. */
  url: string;
  /** ISO 8601 with offset. The actual first publication of the article, not the event date. */
  datePublished: string;
  /** ISO 8601 with offset. */
  dateModified?: string;
  image?: string;
}

/**
 * NewsArticle for reviewed editorial reporting with evidenced publication dates.
 *
 * The 110-character bound is a house-style constraint for concise headlines,
 * not a Google eligibility requirement.
 */
export function buildNewsArticle(input: NewsArticleInput): Record<string, unknown> {
  if (input.headline.length > 110) {
    throw new Error(
      `NewsArticle headline is ${input.headline.length} characters, over the house-style 110-character limit: ${input.headline}`
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
    author: authorNode(),
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
  /** YYYY-MM-DD the data last changed in substance, never a build date. */
  dateModified?: string;
  /** Free-text area the data covers, e.g. "United Kingdom". */
  spatialCoverage?: string;
  /** The quantities the dataset actually reports. */
  variableMeasured?: string[];
  /** Absolute URL of a machine-readable distribution, where one exists. */
  distributionUrl?: string;
  distributionFormat?: string;
  distributions?: Record<string, unknown>[];
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
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    ...(input.spatialCoverage
      ? { spatialCoverage: { "@type": "Place", name: input.spatialCoverage } }
      : {}),
    ...(input.variableMeasured?.length ? { variableMeasured: input.variableMeasured } : {}),
    ...(input.keywords?.length ? { keywords: input.keywords } : {}),
    ...(input.distributions?.length
      ? { distribution: input.distributions }
      : input.distributionUrl
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

export interface ElectionEventInput {
  /** e.g. "Bray by-election, Windsor and Maidenhead". */
  name: string;
  description: string;
  /** Canonical page URL. */
  url: string;
  /** Polling day, YYYY-MM-DD. */
  pollingDay: string;
  /** The area voting, e.g. the ward or constituency. */
  area: string;
  /** The council or returning officer's authority. */
  authority: string;
}

/**
 * Event node for a scheduled poll. Only for contests still to be held: once
 * polls close the page is a result, and an Event in the past would be stale.
 * Dates only, because polling hours vary by election type.
 */
export function buildElectionEvent(input: ElectionEventInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: input.name,
    description: input.description,
    url: input.url,
    startDate: input.pollingDay,
    endDate: input.pollingDay,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    isAccessibleForFree: true,
    inLanguage: "en-GB",
    location: {
      "@type": "Place",
      name: input.area,
      address: {
        "@type": "PostalAddress",
        addressLocality: input.area,
        addressRegion: input.authority,
        addressCountry: "GB"
      }
    },
    organizer: { "@type": "GovernmentOrganization", name: input.authority }
  };
}

/**
 * `value` if it is an absolute http(s) URL, otherwise null.
 *
 * Several source fields in the election corpus hold an attribution rather than
 * a link: "BBC", "at the count", "Birmingham Mail", and 740 rows carrying the
 * sentence "LEAP data at https://www.andrewteale.me.uk/leap/downloads". Fed
 * straight into an `href` they become RELATIVE links, so each one invents a URL
 * under the current page. Google had crawled at least one of them
 * (/seats/powys/llandrindod-south/LEAP data at https://...), which is both a
 * dead link for the reader and crawl budget spent inventing pages on a site
 * already sitting on 1,629 discovered-but-not-indexed URLs.
 *
 * Anything that is not a URL is an attribution and belongs in the text.
 */
export function externalHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\/\S+$/.test(trimmed) ? trimmed : null;
}

/* ------------------------------------------------------------------ */
/* Place result titles                                                 */
/* ------------------------------------------------------------------ */

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 November 2026", or "12 Nov 2026" with `short`. British order, no weekday. */
export function titleDate(iso: string, short = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${(short ? MONTHS_SHORT : MONTHS_LONG)[m - 1]} ${y}`;
}

/** The guide every title aims for; longer ones are cut off in search results. */
export const TITLE_LIMIT = 60;

export interface PlaceTitleInput {
  /** The ward, division or other area the page is about. */
  place: string;
  /** The council, which disambiguates repeated place names. */
  council?: string | null;
  /** What the page answers: "Election result", "By-election result", ... */
  label: string;
  /** ISO polling date, written in British order. */
  date?: string | null;
  /**
   * Shorten to TITLE_LIMIT where the names allow, in this order: abbreviate the
   * month, drop a "London Borough of" style prefix from the council, then drop
   * the council. The council stays in the description and the page heading.
   * A title that still runs over is one whose place name alone is too long.
   */
  fit?: boolean;
}

/**
 * The answer-first title shared by ward pages and council by-election pages:
 * "Belsize, Camden. Election result, 7 May 2026".
 */
export function placeResultTitle(input: PlaceTitleInput): string {
  // The council is what people search for and what tells two wards of the
  // same name apart, so a long title gives up the date before the council:
  // short month, then the year alone, then no date. The council is never dropped.
  const compose = (council: string | null | undefined, date: string) =>
    `${input.place}${council ? `, ${council}` : ""}. ${input.label}${date ? `, ${date}` : ""}`;
  const long = input.date ? titleDate(input.date, false) : "";
  const short = input.date ? titleDate(input.date, true) : "";
  const year = input.date ? input.date.slice(0, 4) : "";
  const full = compose(input.council, long);
  if (!input.fit) return full;
  const shortCouncil = input.council?.replace(/^(?:London Borough of|Royal Borough of) /, "");
  const ladder = [full, compose(input.council, short), compose(shortCouncil, short), compose(shortCouncil, year), compose(shortCouncil, "")];
  // When even the undated form is too long, nothing is gained by dropping the
  // year, so the title keeps it and runs over.
  return ladder.find((t) => t.length <= TITLE_LIMIT) ?? ladder[ladder.length - 2];
}

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
  { href: "/forecasts/general-election/", label: "General Election" },
  { href: "/by-elections/makerfield/", label: "Makerfield By-election" },
  { href: "/polling/", label: "Polling" },
  { href: "/past-results/", label: "Past Results" },
  { href: "/your-area/", label: "Find Your Ward" },
  { href: "/methodology/", label: "About" },
] as const;

export type NavGroup = {
  label: string;
  items: ReadonlyArray<{ href: string; label: string; desc: string }>;
};

export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: "Forecasts",
    items: [
      { href: "/forecasts/general-election/", label: "General Election", desc: "Reform UK projected to win 348 of 650 seats" },
      { href: "/by-elections/makerfield/", label: "Makerfield By-election", desc: "18 Jun · Reform UK vs Burnham · 1.4pp toss-up" },
      { href: "/polling/", label: "Polling", desc: "Westminster vote intention from named pollsters" },
    ],
  },
  {
    label: "Past Results",
    items: [
      { href: "/past-results/", label: "All Past Results", desc: "Every contest we've forecast" },
      { href: "/past-results/by-region/", label: "By Region", desc: "Reform UK share heatmap across the 12 regions" },
      { href: "/forecasts/may-2026/", label: "Council Elections 2026", desc: "7-May backtest · 5.7pp MAE" },
      { href: "/data-quality/", label: "Data Quality", desc: "Sources, coverage, gaps" },
    ],
  },
  {
    label: "Browse",
    items: [
      { href: "/seats/", label: "650 Constituencies", desc: "Seat-by-seat profile" },
      { href: "/councils/", label: "Councils", desc: "Every English council" },
      { href: "/your-area/", label: "Find Your Ward", desc: "By postcode" },
    ],
  },
  {
    label: "About",
    items: [
      { href: "/methodology/", label: "Methodology", desc: "How the model works" },
      { href: "/sources/", label: "Sources", desc: "Data provenance" },
      { href: "/coverage/", label: "Coverage", desc: "What we forecast" },
      { href: "/transparency/", label: "Transparency", desc: "Funding & affiliations" },
      { href: "/releases/", label: "Releases", desc: "Version history" },
    ],
  },
] as const;

export const RELEASES: ReleaseEntry[] = [
  {
    date: "2026-04-20",
    title: "Review action audit",
    summary: "Added a reproducible local audit pipeline and review-action classes for post-boundary, temporal-validation, winner-signal, and vote-share calibration gaps.",
    sourceUrl: buildAbsoluteUrl("/data-quality/")
  },
  {
    date: "2026-04-18",
    title: "Model input validation",
    summary: "Added poll aggregate and model feature validation, including asylum route safeguards and area-specific population quality metadata.",
    sourceUrl: buildAbsoluteUrl("/data-quality/")
  },
  {
    date: "2026-04-18",
    title: "Electoral history quality gates",
    summary: "Added boundary-versioned electoral history coverage for local, Westminster, Senedd, Scottish, and STV elections.",
    sourceUrl: buildAbsoluteUrl("/data-quality/")
  },
  {
    date: "2026-04-18",
    title: "Full election model scope",
    summary: "Expanded the modelling plan to cover borough, county, unitary, Westminster, Senedd, and Scottish Parliament election families with source quality gates.",
    sourceUrl: buildAbsoluteUrl("/forecasts/")
  },
  {
    date: "2026-04-18",
    title: "UK Elections scaffold",
    summary: "Initial public scaffold, GitHub repository, Cloudflare Pages project, and placeholder deployment.",
    sourceUrl: SITE_URL
  }
];

const STATIC_PATHS = [
  "/",
  "/councils/",
  "/past-results/",
  "/seats/",
  "/your-area/",
  "/forecasts/",
  "/forecasts/may-2026/",
  "/forecasts/general-election/",
  "/by-elections/makerfield/",
  "/past-results/may-2025/",
  "/past-results/indicators/",
  "/forecasts/senedd-2026/",
  "/forecasts/holyrood-2026/",
  "/polling/",
  "/data-quality/",
  "/data-quality/2024-backtest/",
  "/data-quality/ge-backtest/",
  "/methodology/",
  "/methodology/general-election/",
  "/methodology/national-model/",
  "/sources/",
  "/releases/",
  "/privacy/",
  "/terms/",
  "/accessibility/",
  "/coverage/",
  "/past-results/by-region/",
  "/transparency/"
] as const;

export const SEARCH_ENTRIES: SearchEntry[] = [
  {
    href: "/past-results/indicators/",
    title: "Demographic indicators, backtest 2025 → 2026",
    kind: "page",
    description: "What predicts vote share for each major party across both the 1 May 2025 and 1 May 2026 council elections. Reform's degree-share correlation (−0.85) is the most stable lawful relationship in modern English local elections. Labour's coalition reshuffled hard between 2025 and 2026. Train-2025 predict-2026 MAE per party.",
    priority: 109
  },
  {
    href: "/past-results/may-2025/",
    title: "1 May 2025 council elections, full review",
    kind: "page",
    description: "Comprehensive analytical review of the 1 May 2025 county council elections. 24 councils, 1,400 seats, 547 Reform UK seats (39.1%), 9 Reform majorities, with the demographic regression that explains 84% of cross-council Reform vote variance (no-quals r = +0.905; degree r = -0.896).",
    priority: 108
  },
  {
    href: "/by-elections/makerfield/",
    title: "Makerfield by-election. 18 June 2026",
    kind: "page",
    description: "Forecast for the Makerfield by-election triggered by Josh Simons' resignation to make way for Andy Burnham. Two scenarios (Burnham stands / withdraws), 1 May 2026 ward signal, Survation 14-15 May poll, 120-year historical anchor.",
    priority: 110
  },
  {
    href: "/polling/",
    title: "Polling, current Westminster average and how we use it",
    kind: "page",
    description: "Where our forecast's national polling input comes from. Current UK / Welsh / Scottish rolling 14-day average, the Restore Britain overlay, the refresh ledger, and how it flows into the seat forecast.",
    priority: 107
  },
  {
    href: "/councils/",
    title: "Councils",
    kind: "page",
    description: "Every English and Welsh council that contested May 7 2026: result, control, Reform seats, and next-election date (or TBC where Local Government Reorganisation is in play).",
    priority: 102
  },
  {
    href: "/past-results/",
    title: "Past Results. May 7 2026",
    kind: "page",
    description: "Locked May 7 2026 forecast scored against actual count. Per-party MAE, Step 9b isolation audit, and the 15 Reform UK majorities.",
    priority: 101
  },
  {
    href: "/seats/",
    title: "Seats",
    kind: "page",
    description: "Per-council and per-ward pages with predicted vs actual winner, candidates, history, and local signals.",
    priority: 100
  },
  {
    href: "/your-area/",
    title: "Your Area",
    kind: "page",
    description: "Postcode and place lookup that routes voters to the right contest.",
    priority: 95
  },
  {
    href: "/forecasts/",
    title: "Forecasts",
    kind: "page",
    description: "Model-family framework, confidence bands, backtests, and publication rules.",
    priority: 90
  },
  {
    href: "/data-quality/",
    title: "Data Quality",
    kind: "page",
    description: "Accuracy gates for source history, boundary changes, and model inputs.",
    priority: 88
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
    description: "Planned primary, secondary, and internal data sources with ingestion status.",
    priority: 80
  },
  {
    href: "/coverage/",
    title: "Coverage, what we are and aren't predicting",
    kind: "page",
    description: "Which contests are in scope, which wards have direct baselines vs predecessor blends, and which categories of seat we don't forecast.",
    priority: 86
  },
  {
    href: "/data-quality/2024-backtest/",
    title: "2024 backtest, predicted vs actual",
    kind: "page",
    description: "How accurate the model was on the last cycle. Per-party MAE and seat winner accuracy for 1 May 2024.",
    priority: 84
  },
  {
    href: "/data-quality/ge-backtest/",
    title: "GE2024 backtest",
    kind: "page",
    description: "Backtest of the general-election seat model against the 4 July 2024 result. Per-party MAE and confidence calibration.",
    priority: 83
  },
  {
    href: "/methodology/general-election/",
    title: "General election forecast, methodology",
    kind: "page",
    description: "How we forecast 650 constituencies: BES priors, swing models, demographic ceilings, by-election overlays, and tactical voting.",
    priority: 82
  },
  {
    href: "/methodology/national-model/",
    title: "Methodology, national model",
    kind: "page",
    description: "How the May 2026 model works step-by-step: baseline, swing, demographics, incumbency, Reform proxy, and the audit-driven Step 9b corrections.",
    priority: 81
  },
  {
    href: "/past-results/by-region/",
    title: "Reform UK by region, 7 May 2026",
    kind: "page",
    description: "Reform UK share by English region on 7 May 2026: actual vote share, council seats won, and the regional spread of the swing.",
    priority: 79
  },
  {
    href: "/transparency/",
    title: "Pre-registration and audit log",
    kind: "page",
    description: "Locked forecasts, model parameter snapshots, post-audit changelog, and corrections SLA. The pre-registration record for every published forecast.",
    priority: 78
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

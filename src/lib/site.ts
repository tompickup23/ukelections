export const SITE_NAME = "UK Elections";
export const SITE_URL = "https://ukelections.co.uk";
export const DEFAULT_DESCRIPTION =
  "Election intelligence for every UK contest. Candidates, history, forecasts, confidence intervals, source notes, and honest backtests in one place.";
// Static fallback card for pages with no Satori-rendered per-page card.
// Must be a PNG — Facebook, X, LinkedIn and Slack all decline to render
// an SVG og:image. Regenerate with `npm run build:og-default`.
export const DEFAULT_SOCIAL_IMAGE_PATH = "/og-default.png";

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
  { href: "/by-elections/", label: "By-elections" },
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
      { href: "/forecasts/general-election/", label: "General Election", desc: "Full 650-seat projection from the latest Westminster polling" },
      { href: "/forecasts/lancashire-unitaries/", label: "Lancashire reorganisation", desc: "The four new Lancashire unitaries, forecast for the May 2027 shadow elections" },
      { href: "/forecasts/mayoral/", label: "Mayoral projections", desc: "The May 2027 mayoral races under the restored supplementary vote, plus the 2028 roster" },
      { href: "/by-elections/", label: "By-elections", desc: "Clacton result: Farage returned on 63.3%. Plus 18 Jun results + weekly ward scorecard" },
      { href: "/polling/", label: "Polling", desc: "Westminster vote intention from named pollsters" },
      { href: "/polling/trends/", label: "Polling trends", desc: "Every poll plotted over time, with the UK Elections average and pollster house effects" },
    ],
  },
  {
    label: "Past Results",
    items: [
      { href: "/past-results/", label: "All Past Results", desc: "Every contest we've forecast" },
      { href: "/past-results/by-region/", label: "By Region", desc: "Reform UK share heatmap across the 12 regions" },
      { href: "/forecasts/may-2026/", label: "Council Elections 2026", desc: "May 2024 backtest · 5.7pp MAE" },
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
      { href: "/contact/", label: "Contact", desc: "Questions and corrections" },
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
  "/forecasts/lancashire-unitaries/",
  "/forecasts/mayoral/",
  "/by-elections/",
  "/by-elections/local/",
  "/by-elections/makerfield/",
  "/by-elections/aberdeen-south/",
  "/by-elections/arbroath-and-broughty-ferry/",
  "/by-elections/clacton/",
  "/past-results/may-2025/",
  "/past-results/indicators/",
  "/forecasts/senedd-2026/",
  "/forecasts/holyrood-2026/",
  "/polling/",
  "/polling/trends/",
  "/data-quality/",
  "/data-quality/2024-backtest/",
  "/data-quality/ge-backtest/",
  "/methodology/",
  "/methodology/general-election/",
  "/methodology/national-model/",
  "/methodology/demographic-ward-model/",
  "/methodology/local-by-elections/",
  "/sources/",
  "/releases/",
  "/privacy/",
  "/terms/",
  "/accessibility/",
  "/coverage/",
  "/past-results/by-region/",
  "/transparency/",
  "/contact/"
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
    href: "/by-elections/",
    title: "By-elections. Results, forecasts and what's next",
    kind: "page",
    description: "Every Westminster by-election we track, the declared result, and how the forecast or signal compared. Clacton, 13 August 2026: Reform hold, Farage returned on 63.3%, turnout 44.4%. The 18 June 2026 round: Labour held Makerfield (Burnham), Conservatives gained Aberdeen South, SNP held Arbroath and Broughty Ferry. Plus the weekly local council by-election scorecard.",
    priority: 111
  },
  {
    href: "/by-elections/local/",
    title: "Council by-elections. Every scheduled contest, one page each",
    kind: "page",
    description: "Every scheduled council by-election in Great Britain, with the candidates, the reason the seat fell vacant, how the ward last voted, and a projection wherever the ward gives an honest baseline. The method's record on every council by-election since May 2025 is published alongside it.",
    priority: 111
  },
  {
    href: "/by-elections/clacton/",
    title: "Clacton by-election, 13 August 2026",
    kind: "page",
    description: "Nigel Farage resigned as MP for Clacton on 8 July 2026, amid a parliamentary standards investigation, to trigger a by-election and stand in it himself. Labour, the Conservatives, the Liberal Democrats, the Greens and Restore Britain all boycotted it. The declared result on a record 34-candidate ballot, why we published no vote-share forecast, and the GE2024 baseline.",
    priority: 112
  },
  {
    href: "/by-elections/makerfield/",
    title: "Makerfield by-election. Result vs forecast",
    kind: "page",
    description: "Andy Burnham (Labour) held Makerfield on 18 June 2026 with a 9,231 majority (54.8% to 34.5%). The UKE forecast wrongly called Reform (1.4pp toss-up) by blending a moot bimodal scenario; the final-polls poll-of-polls (Lab +7) called it right. Full result, scorecard, and the four methodology failures.",
    priority: 110
  },
  {
    href: "/by-elections/aberdeen-south/",
    title: "Aberdeen South by-election. Conservative gain",
    kind: "page",
    description: "The Conservatives gained Aberdeen South from the SNP on 18 June 2026 (Douglas Lumsden, 49.5%, majority 6,050). An upset on a 37% turnout: tactical unionist consolidation as Labour collapsed. Every area signal had pointed to an SNP hold.",
    priority: 106
  },
  {
    href: "/by-elections/arbroath-and-broughty-ferry/",
    title: "Arbroath and Broughty Ferry by-election. SNP hold",
    kind: "page",
    description: "The SNP held Arbroath and Broughty Ferry on 18 June 2026 (Lara Bird, 41.2%, majority 5,278), Reform UK third. The 7 May Holyrood signal in Angus South called the result almost exactly; the GE2024 baseline (Labour second) did not.",
    priority: 105
  },
  {
    href: "/polling/",
    title: "Polling, current Westminster average and how we use it",
    kind: "page",
    description: "Where our forecast's national polling input comes from. Current UK Westminster rolling 14-day average, the Restore Britain overlay, the refresh ledger, the frozen final pre-election Welsh and Scottish snapshots, and how it all flows into the seat forecast.",
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
    href: "/methodology/local-by-elections/",
    title: "Methodology, council by-elections",
    kind: "page",
    description: "The full council by-election method: the ward's own last result moved by swing measured only from comparable by-elections (same era, same Reform-entry condition), the calibration fitted on the published record, and the stratified-versus-pooled comparison that justifies the design.",
    priority: 86
  },
  {
    href: "/methodology/demographic-ward-model/",
    title: "Methodology, demographic ward model",
    kind: "page",
    description: "A machine-learning model of Reform UK's local vote built from Census 2021 ward demographics alone, walk-forward validated against the May 2026 results.",
    priority: 84
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
    href: "/contact/",
    title: "Contact",
    kind: "page",
    description: "How to reach UK Elections. Questions, corrections and data queries go to info@ukelections.co.uk; corrections are applied to the page and noted.",
    priority: 60
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

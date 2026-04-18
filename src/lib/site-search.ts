import { getPublicPlaceAreas, getPublicPlaceRegions, buildPublicPlaceRegionPath, slugifyAreaName } from "./site";
import { getEthnicProjection } from "./ethnic-projections";

export interface SiteSearchEntry {
  href: string;
  title: string;
  kind: "page" | "region" | "place";
  kicker: string;
  description: string;
  priority: number;
  areaCode?: string;
  areaName?: string;
  regionName?: string;
  population?: number;
  wbiPct2021?: number;
  wbiNow?: number | null;
  wbi2051?: number | null;
  searchText: string;
}

const STATIC_PAGE_ENTRIES: SiteSearchEntry[] = [
  {
    href: "/",
    title: "Home",
    kind: "page",
    kicker: "Overview",
    description: "National demographic projections, area search, and key findings.",
    priority: 120,
    searchText: "home overview national projections demographic ethnic composition"
  },
  {
    href: "/places/",
    title: "Places",
    kind: "page",
    kicker: "Area directory",
    description: "Browse all local authorities with demographic projections to 2061.",
    priority: 119,
    searchText: "places areas local authorities directory browse regions"
  },
  {
    href: "/national/",
    title: "National",
    kind: "page",
    kicker: "National outlook",
    description: "England-wide demographic projections and fastest-changing areas.",
    priority: 116,
    searchText: "national england projections white british ethnic change fastest"
  },
  {
    href: "/compare/",
    title: "Compare",
    kind: "page",
    kicker: "Area comparison",
    description: "Compare demographic projections across multiple areas side-by-side.",
    priority: 111,
    searchText: "compare areas side by side demographic projections"
  },
  {
    href: "/releases/",
    title: "Releases",
    kind: "page",
    kicker: "Update diary",
    description: "Release log tracking data updates and model improvements.",
    priority: 110,
    searchText: "releases update diary freshness chronology"
  },
  {
    href: "/sources/",
    title: "Sources",
    kind: "page",
    kicker: "Source ledger",
    description: "Data sources — Census, ONS, DfE, NHS Digital.",
    priority: 108,
    searchText: "sources ons census dfe nhs data"
  },
  {
    href: "/methodology/",
    title: "Methodology",
    kind: "page",
    kicker: "Model methodology",
    description: "Hamilton-Perry CCR model, validation, limitations.",
    priority: 109,
    searchText: "methodology hamilton perry model validation census ccr"
  }
];

export function getPublicSearchEntries(): SiteSearchEntry[] {
  const placeEntries = getPublicPlaceAreas().map((area) => {
    const ep = getEthnicProjection(area.areaCode);
    const wbiNow = ep?.current?.groups?.white_british ?? area.wbiPct2021 ?? null;
    const wbi2051 = ep?.projections?.["2051"]?.white_british ?? null;
    return {
      href: `/places/${slugifyAreaName(area.areaName)}/`,
      title: area.areaName,
      kind: "place" as const,
      kicker: `${area.regionName} | ${area.countryName}`,
      description: `Population ${(area.population ?? 0).toLocaleString()}, WBI ${wbiNow?.toFixed(1) ?? "?"}% (2021)`,
      priority: Math.min(99, Math.max(20, Math.round((area.population ?? 0) / 10000))),
      areaCode: area.areaCode,
      areaName: area.areaName,
      regionName: area.regionName,
      population: area.population,
      wbiPct2021: area.wbiPct2021,
      wbiNow,
      wbi2051,
      searchText: [
        area.areaName,
        area.areaCode,
        area.regionName,
        area.countryName,
        "place",
        "local authority",
        "demographic",
        "projections"
      ]
        .join(" ")
        .toLowerCase()
    };
  });

  const regionEntries = getPublicPlaceRegions().map((region) => ({
    href: buildPublicPlaceRegionPath(region.regionName),
    title: region.regionName,
    kind: "region" as const,
    kicker: `${region.countryName} region`,
    description: `${region.publicPlaceCount} local authorities in ${region.regionName}.`,
    priority: 112,
    searchText: [
      region.regionName,
      region.countryName,
      "region",
      "regional"
    ]
      .join(" ")
      .toLowerCase()
  }));

  const kindOrder: Record<SiteSearchEntry["kind"], number> = { page: 0, region: 1, place: 2 };

  return [...STATIC_PAGE_ENTRIES, ...regionEntries, ...placeEntries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return kindOrder[left.kind] - kindOrder[right.kind];
    }
    return right.priority - left.priority || left.title.localeCompare(right.title);
  });
}

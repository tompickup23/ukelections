import fs from "node:fs";
import path from "node:path";

export const SITE_NAME = "UK Elections";
export const SITE_URL = "https://ukelections.co.uk";
export const DEFAULT_DESCRIPTION =
  "Election intelligence for every UK contest. Candidates, history, forecasts, confidence intervals, demographics, and honest backtests in one place.";
export const DEFAULT_SOCIAL_IMAGE_PATH = "/og-card.svg";

export type StructuredDataNode = Record<string, unknown>;

export interface ReleaseEntry {
  date: string;
  title: string;
  summary: string;
  sourceUrl: string;
}

export interface DemographicAreaSummary {
  areaCode: string;
  areaName: string;
  regionName: string;
  countryName: string;
  population?: number;
  wbiPct2021?: number;
  wbiPct2041?: number;
  diversityIndex2021?: number;
  diversityIndex2041?: number;
}

const INDEXABLE_STATIC_PATHS = [
  "/",
  "/places/",
  "/compare/",
  "/national/",
  "/regional/",
  "/releases/",
  "/sources/",
  "/methodology/"
] as const;

function slugifyRegionName(regionName: string): string {
  return regionName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function slugifyAreaName(areaName: string): string {
  return areaName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function buildPlacePath(area: { areaCode: string; areaName: string }): string {
  return `/places/${slugifyAreaName(area.areaName)}/`;
}

export function normalisePageTitle(title: string): string {
  return /uk\s*elections/i.test(title) ? title : `${title} | ${SITE_NAME}`;
}

export function buildAbsoluteUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return new URL(normalizedPath, SITE_URL).toString();
}

export function buildPublicPlaceRegionSlug(regionName: string): string {
  return slugifyRegionName(regionName);
}

export function buildPublicPlaceRegionPath(regionName: string): string {
  return `/places/regions/${buildPublicPlaceRegionSlug(regionName)}/`;
}

/**
 * Return all areas from the ethnic projections dataset.
 * Unlike asylumstats (which filters by asylum support thresholds),
 * UK Elections publishes every local authority with projection data.
 */
export function getPublicPlaceAreas(): DemographicAreaSummary[] {
  const dataPath = path.resolve("src/data/live/ethnic-projections.json");
  if (!fs.existsSync(dataPath)) return [];

  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const areas: DemographicAreaSummary[] = [];

  // Build region lookup from local-route-latest (only source of regionName)
  const regionLookup = new Map<string, { regionName: string; countryName: string }>();
  const routePath = path.resolve("src/data/live/local-route-latest.json");
  if (fs.existsSync(routePath)) {
    const routeData = JSON.parse(fs.readFileSync(routePath, "utf8"));
    for (const routeArea of routeData.areas ?? []) {
      regionLookup.set(routeArea.areaCode, {
        regionName: routeArea.regionName ?? "Unknown",
        countryName: routeArea.countryName ?? "England",
      });
    }
  }

  // ethnic-projections.json has areas as object keyed by area code (e.g. "E08000025")
  if (raw.areas && typeof raw.areas === "object" && !Array.isArray(raw.areas)) {
    for (const [areaCode, areaData] of Object.entries(raw.areas)) {
      const data = areaData as Record<string, any>;
      const region = regionLookup.get(areaCode);
      areas.push({
        areaCode,
        areaName: data.areaName ?? areaCode,
        regionName: region?.regionName ?? "Unknown",
        countryName: region?.countryName ?? "England",
        population: data.current?.total_population,
        wbiPct2021: data.current?.groups?.white_british,
        wbiPct2041: data.projections?.["2041"]?.white_british,
        diversityIndex2021: data.diversityIndex?.entropy,
        diversityIndex2041: undefined,
      });
    }
  }

  return areas;
}

export function getPublicPlaceRegions(): Array<{ regionName: string; countryName: string; publicPlaceCount: number }> {
  const regionMap = new Map<string, { regionName: string; countryName: string; publicPlaceCount: number }>();

  for (const area of getPublicPlaceAreas()) {
    const existing =
      regionMap.get(area.regionName) ??
      {
        regionName: area.regionName,
        countryName: area.countryName,
        publicPlaceCount: 0
      };

    existing.publicPlaceCount += 1;
    regionMap.set(area.regionName, existing);
  }

  return [...regionMap.values()].sort((left, right) => left.regionName.localeCompare(right.regionName));
}

export function getIndexableSitePaths(): string[] {
  const paths = new Set<string>(INDEXABLE_STATIC_PATHS);

  for (const region of getPublicPlaceRegions()) {
    paths.add(buildPublicPlaceRegionPath(region.regionName));
  }

  for (const area of getPublicPlaceAreas()) {
    paths.add(buildPlacePath(area));
  }

  return [...paths].sort((a, b) => a.localeCompare(b));
}

interface PlaceStructuredDataOptions {
  canonicalUrl: string;
  description: string;
  socialImageUrl: string;
  snapshotDate: string;
}

export function buildPlaceStructuredData(
  area: DemographicAreaSummary,
  options: PlaceStructuredDataOptions
): StructuredDataNode[] {
  const areaId = `${options.canonicalUrl}#area`;
  const datasetId = `${options.canonicalUrl}#dataset`;

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
          name: area.areaName,
          item: options.canonicalUrl
        }
      ]
    },
    {
      "@context": "https://schema.org",
      "@type": "AdministrativeArea",
      "@id": areaId,
      name: area.areaName,
      identifier: area.areaCode,
      address: {
        "@type": "PostalAddress",
        addressRegion: area.regionName,
        addressCountry: area.countryName
      },
      containedInPlace: [
        {
          "@type": "AdministrativeArea",
          name: area.regionName
        },
        {
          "@type": "Country",
          name: area.countryName
        }
      ],
      subjectOf: {
        "@id": datasetId
      }
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      "@id": datasetId,
      name: `${area.areaName} demographic profile`,
      description: options.description,
      url: options.canonicalUrl,
      isAccessibleForFree: true,
      dateModified: options.snapshotDate,
      temporalCoverage: "2021/2051",
      spatialCoverage: {
        "@id": areaId
      },
      creator: {
        "@id": `${SITE_URL}/#organization`
      },
      publisher: {
        "@id": `${SITE_URL}/#organization`
      },
      keywords: [
        "population projections",
        "ethnic composition",
        "demographic change",
        "Census 2021",
        area.areaName
      ],
      variableMeasured: [
        "Ethnic composition",
        "Population projections",
        "Diversity index",
        "Fertility rates",
        "Migration patterns"
      ]
    }
  ];
}

interface ReleaseCollectionStructuredDataOptions {
  canonicalUrl: string;
  description: string;
  socialImageUrl: string;
}

export function buildReleaseCollectionStructuredData(
  releases: ReleaseEntry[],
  options: ReleaseCollectionStructuredDataOptions
): StructuredDataNode[] {
  const listId = `${options.canonicalUrl}#release-list`;

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
      name: "UK Elections release diary",
      description: options.description,
      url: options.canonicalUrl,
      mainEntity: {
        "@id": listId
      },
      about: [
        "UK population projections",
        "ethnic composition data",
        "demographic research releases"
      ]
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "@id": listId,
      name: "Release diary entries",
      numberOfItems: releases.length,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: releases.map((release, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "CreativeWork",
          name: release.title,
          description: release.summary,
          url: release.sourceUrl,
          datePublished: release.date
        }
      }))
    }
  ];
}

import rawAreaSeries from "../data/live/area-series.json";

export interface AreaSeriesPoint {
  areaCode: string;
  areaName: string;
  periodEnd: string;
  value: number;
  dataStatus: "official_anchor" | "illustrative";
}

export interface AreaTrendSummary {
  areaCode: string;
  areaName: string;
  points: Array<
    AreaSeriesPoint & {
      label: string;
    }
  >;
  firstValue: number;
  latestValue: number;
  latestPeriodLabel: string;
  deltaFromPrevious: number | null;
  changePctFromPrevious: number | null;
  deltaFromFirst: number;
  changePctFromFirst: number | null;
  officialAnchorCount: number;
  illustrativeCount: number;
  hasIllustrativeData: boolean;
}

function formatPeriodLabel(periodEnd: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(periodEnd));
}

function getChangePct(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function loadAreaSeries(): AreaSeriesPoint[] {
  return rawAreaSeries as AreaSeriesPoint[];
}

export function getAreaTrendSummary(areaCode: string): AreaTrendSummary | null {
  const points = loadAreaSeries()
    .filter((point) => point.areaCode === areaCode)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
    .map((point) => ({
      ...point,
      label: formatPeriodLabel(point.periodEnd)
    }));

  if (points.length === 0) {
    return null;
  }

  const latest = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const first = points[0];
  const officialAnchorCount = points.filter((point) => point.dataStatus === "official_anchor").length;
  const illustrativeCount = points.length - officialAnchorCount;

  return {
    areaCode,
    areaName: latest.areaName,
    points,
    firstValue: first.value,
    latestValue: latest.value,
    latestPeriodLabel: latest.label,
    deltaFromPrevious: previous ? latest.value - previous.value : null,
    changePctFromPrevious: previous ? getChangePct(latest.value, previous.value) : null,
    deltaFromFirst: latest.value - first.value,
    changePctFromFirst: getChangePct(latest.value, first.value),
    officialAnchorCount,
    illustrativeCount,
    hasIllustrativeData: illustrativeCount > 0
  };
}

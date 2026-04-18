import rawAsc from "../data/live/asc-dashboard.json";

export interface AreaAscProfile {
  areaName: string;
  grossSpendPerCapita: number;
  residentialRatePer10k65: number;
  qualityOfLifeScore: number;
  dtocDaysAnnual: number;
  period: string;
}

interface AscDashboard {
  source: string;
  methodology: string;
  lastUpdated: string;
  caveat: string;
  areas: Record<string, AreaAscProfile>;
}

const data = rawAsc as AscDashboard;

export function getAscProfile(areaCode: string): AreaAscProfile | null {
  return data.areas[areaCode] ?? null;
}

export function getAscSource(): string {
  return data.source;
}

export function getAscCaveat(): string {
  return data.caveat;
}

export function getAscSpendPercentile(areaCode: string): number | null {
  const area = data.areas[areaCode];
  if (!area) return null;
  const spends = Object.values(data.areas).map((a) => a.grossSpendPerCapita);
  const below = spends.filter((s) => s < area.grossSpendPerCapita).length;
  return Math.round((below / spends.length) * 100);
}

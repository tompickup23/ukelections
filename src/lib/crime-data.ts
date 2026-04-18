import rawCrime from "../data/live/crime-dashboard.json";

export interface CrimeBreakdown {
  type: string;
  rate: number;
}

export interface AreaCrimeProfile {
  areaName: string;
  totalCrimeRate: number;
  violentCrimeRate: number;
  theftRate: number;
  asbRate: number;
  drugRate: number;
  hateCrimeCount: number;
  yearOnYearChange: number;
  breakdown: CrimeBreakdown[];
  period: string;
}

interface CrimeDashboard {
  source: string;
  methodology: string;
  lastUpdated: string;
  caveat: string;
  areas: Record<string, AreaCrimeProfile>;
}

const data = rawCrime as CrimeDashboard;

export function getCrimeProfile(areaCode: string): AreaCrimeProfile | null {
  return data.areas[areaCode] ?? null;
}

export function getCrimeSource(): string {
  return data.source;
}

export function getCrimeCaveat(): string {
  return data.caveat;
}

export function getCrimeRatePercentile(areaCode: string): number | null {
  const area = data.areas[areaCode];
  if (!area) return null;
  const rates = Object.values(data.areas).map((a) => a.totalCrimeRate);
  const below = rates.filter((r) => r < area.totalCrimeRate).length;
  return Math.round((below / rates.length) * 100);
}

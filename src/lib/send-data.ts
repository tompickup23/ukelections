import rawSend from "../data/live/send-dashboard.json";

export interface PrimaryNeed {
  need: string;
  pct: number;
}

export interface AreaSendProfile {
  areaName: string;
  ehcpRatePer10k: number;
  asdPrevalencePct: number;
  fiveYearGrowthPct: number;
  totalEhcps: number;
  primaryNeeds: PrimaryNeed[];
  period: string;
}

interface SendDashboard {
  source: string;
  methodology: string;
  lastUpdated: string;
  caveat: string;
  areas: Record<string, AreaSendProfile>;
}

const data = rawSend as SendDashboard;

export function getSendProfile(areaCode: string): AreaSendProfile | null {
  return data.areas[areaCode] ?? null;
}

export function getSendSource(): string {
  return data.source;
}

export function getSendCaveat(): string {
  return data.caveat;
}

export function getSendGrowthPercentile(areaCode: string): number | null {
  const area = data.areas[areaCode];
  if (!area) return null;
  const rates = Object.values(data.areas).map((a) => a.fiveYearGrowthPct);
  const below = rates.filter((r) => r < area.fiveYearGrowthPct).length;
  return Math.round((below / rates.length) * 100);
}

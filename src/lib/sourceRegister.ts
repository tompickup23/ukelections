export type SourceStatus = "Required" | "Planned" | "Review" | "Internal" | "Later";

export type SourceRegisterEntry = {
  name: string;
  purpose: string;
  status: SourceStatus;
  sourceType: "primary" | "verified_secondary" | "internal" | "context";
};

export const SOURCE_REGISTER: SourceRegisterEntry[] = [
  {
    name: "Democracy Club",
    purpose: "Candidates, ballot metadata, and candidate result rows where available",
    status: "Planned",
    sourceType: "verified_secondary"
  },
  {
    name: "Official notices",
    purpose: "Statements of persons nominated, local authority result pages, and returning officer declarations",
    status: "Required",
    sourceType: "primary"
  },
  {
    name: "House of Commons Library",
    purpose: "Westminster constituency and candidate result files",
    status: "Planned",
    sourceType: "verified_secondary"
  },
  {
    name: "Local archives",
    purpose: "Local Elections Archive Project, Open Council Data, DCLEAPIL, and local election handbooks",
    status: "Review",
    sourceType: "verified_secondary"
  },
  {
    name: "ONSPD, Boundary-Line, ONS Geography",
    purpose: "Postcode, ward, division, constituency, and authority joins",
    status: "Planned",
    sourceType: "primary"
  },
  {
    name: "Boundaries Scotland and Senedd resources",
    purpose: "Scottish Parliament, Scottish local, and Welsh election geography",
    status: "Planned",
    sourceType: "primary"
  },
  {
    name: "UKD, Census, ONS/Nomis, IMD",
    purpose: "Ward and constituency demographic features with source metadata",
    status: "Review",
    sourceType: "context"
  },
  {
    name: "Polling records",
    purpose: "Pollster, client, fieldwork dates, sample, mode, geography, and method notes",
    status: "Planned",
    sourceType: "context"
  },
  {
    name: "Home Office asylum support tables",
    purpose: "Route-specific local asylum support stock, accommodation type, and local authority context",
    status: "Review",
    sourceType: "context"
  },
  {
    name: "Population models",
    purpose: "ONS/Nomis, Census 2021, NEWETHPOP validation, and area-specific population projections",
    status: "Review",
    sourceType: "context"
  },
  {
    name: "Parliament and finance APIs",
    purpose: "Members, votes, Hansard, IPSA, Electoral Commission finance, Companies House, and interests data for context pages",
    status: "Later",
    sourceType: "context"
  },
  {
    name: "AI DOGE and Labour tracker",
    purpose: "Internal source review for refined local modelling and provenance workflows",
    status: "Internal",
    sourceType: "internal"
  }
];

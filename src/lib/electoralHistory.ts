export type AccuracyGate = {
  id: string;
  label: string;
  requirement: string;
};

export type HistoryScope = {
  id: string;
  label: string;
  geography: string;
  historyUnit: string;
  requiredSources: string[];
};

export type ReviewAction = {
  id: string;
  label: string;
  treatment: string;
};

export const ACCURACY_GATES: AccuracyGate[] = [
  {
    id: "source",
    label: "Source proof",
    requirement: "Every fact row has a source URL, source snapshot id, or both."
  },
  {
    id: "geography",
    label: "Geography version",
    requirement: "Every contest links to the boundary version in force on polling day."
  },
  {
    id: "mapping",
    label: "Boundary change mapping",
    requirement: "Any result moved across boundaries has explicit weights and a mapping source."
  },
  {
    id: "candidate",
    label: "Candidate roster",
    requirement: "Published forecasts require Democracy Club or official nomination data."
  },
  {
    id: "audit",
    label: "Audit trail",
    requirement: "Manual edits record reviewer, reason, timestamp, and original value."
  }
];

export const HISTORY_SCOPES: HistoryScope[] = [
  {
    id: "borough_history",
    label: "Borough and district elections",
    geography: "Ward boundaries valid for each borough contest",
    historyUnit: "Candidate result rows by ward and polling date",
    requiredSources: ["Official notices", "Local archives", "Boundary sources"]
  },
  {
    id: "county_history",
    label: "County council elections",
    geography: "County division boundaries valid for each county contest",
    historyUnit: "Candidate result rows by county division and polling date",
    requiredSources: ["Official notices", "Local archives", "Boundary sources"]
  },
  {
    id: "unitary_history",
    label: "Unitary authority elections",
    geography: "Unitary ward or division boundaries valid for each contest",
    historyUnit: "Candidate result rows by ward or division and polling date",
    requiredSources: ["Official notices", "Local archives", "Boundary sources"]
  },
  {
    id: "westminster_history",
    label: "Westminster elections",
    geography: "UK Parliament constituency boundaries for the election year",
    historyUnit: "Candidate result rows by constituency and polling date",
    requiredSources: ["House of Commons Library", "Returning officer declarations", "Boundary sources"]
  },
  {
    id: "senedd_history",
    label: "Senedd elections",
    geography: "Senedd constituency or list geography in force for the election",
    historyUnit: "Party list and candidate rows required by the voting system",
    requiredSources: ["Senedd resources", "Official results", "Boundary sources"]
  },
  {
    id: "scottish_history",
    label: "Scottish Parliament elections",
    geography: "Scottish Parliament constituency and regional boundaries in force for the election",
    historyUnit: "Constituency candidate rows plus regional list rows",
    requiredSources: ["Scottish Parliament results", "Boundaries Scotland", "Official results"]
  },
  {
    id: "local_stv_history",
    label: "Local STV elections",
    geography: "Multi-member ward boundaries in force for the election",
    historyUnit: "First-preference results and elected candidates by ward",
    requiredSources: ["Official notices", "Official results", "Boundary sources"]
  }
];

export const REVIEW_ACTIONS: ReviewAction[] = [
  {
    id: "post_boundary_single_contest",
    label: "Post-boundary single contest",
    treatment: "Hold for another current-boundary contest or official notional history before publication."
  },
  {
    id: "single_current_contest",
    label: "Single current contest",
    treatment: "Keep in review until there is a second contest or a reviewed local comparator."
  },
  {
    id: "limited_temporal_validation",
    label: "Limited temporal validation",
    treatment: "Require another leave-one-out validation or a reviewed notional baseline."
  },
  {
    id: "vote_share_only_limited",
    label: "Vote-share-only pass",
    treatment: "Treat as useful calibration, not a publishable elected-party signal."
  },
  {
    id: "failed_winner_signal",
    label: "Winner signal failed",
    treatment: "Investigate party/candidate dynamics, local swing, and ward history before promotion."
  },
  {
    id: "failed_vote_share_calibration",
    label: "Vote-share calibration failed",
    treatment: "Keep blocked from publication until the baseline error is materially improved."
  }
];

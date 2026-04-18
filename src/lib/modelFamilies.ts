export type ModelFamily = {
  id: string;
  label: string;
  geography: string;
  votingSystem: string;
  requiredInputs: string[];
  firstGate: string;
};

export const MODEL_FAMILIES: ModelFamily[] = [
  {
    id: "local_fptp_borough",
    label: "Borough local election",
    geography: "Current borough wards",
    votingSystem: "First past the post",
    requiredInputs: [
      "official ward codes and boundaries",
      "wards up and defending councillor",
      "statement of persons nominated",
      "borough ward result history",
      "UKD, Census, IMD, and local context features"
    ],
    firstGate: "Candidate roster and ward boundary review"
  },
  {
    id: "local_fptp_county",
    label: "County council election",
    geography: "County divisions",
    votingSystem: "First past the post",
    requiredInputs: [
      "county division codes and boundaries",
      "division result history",
      "candidate roster",
      "division-to-ward or LSOA mapping where local features are used"
    ],
    firstGate: "Division geography review"
  },
  {
    id: "local_fptp_unitary",
    label: "Unitary authority election",
    geography: "Unitary wards or divisions",
    votingSystem: "First past the post where applicable",
    requiredInputs: [
      "authority election cycle",
      "ward or division boundaries",
      "candidate roster",
      "current control and incumbent councillors",
      "predecessor authority mapping where boundaries changed"
    ],
    firstGate: "Authority cycle and boundary review"
  },
  {
    id: "local_stv",
    label: "Local STV election",
    geography: "Multi-member local wards",
    votingSystem: "Single transferable vote",
    requiredInputs: [
      "multi-member ward boundaries",
      "candidate roster",
      "previous first-preference results",
      "transfer assumptions or historic transfer data"
    ],
    firstGate: "Voting-system-specific allocator review"
  },
  {
    id: "westminster_fptp",
    label: "Westminster general election",
    geography: "UK Parliament constituencies",
    votingSystem: "First past the post",
    requiredInputs: [
      "official constituency results",
      "candidate roster",
      "2024 boundary generation",
      "national and regional polling",
      "local and demographic indicators"
    ],
    firstGate: "Constituency result and boundary review"
  },
  {
    id: "senedd_closed_list_pr",
    label: "Senedd election",
    geography: "Senedd multi-member constituencies",
    votingSystem: "Closed-list proportional representation",
    requiredInputs: [
      "new Senedd constituency geography",
      "party list candidates",
      "Welsh polling",
      "previous Senedd, Westminster, and local signals",
      "seat allocation rules"
    ],
    firstGate: "New-system geography and allocator review"
  },
  {
    id: "scottish_ams",
    label: "Scottish Parliament election",
    geography: "Scottish Parliament constituencies and regions",
    votingSystem: "Additional member system",
    requiredInputs: [
      "constituency boundaries",
      "regional list boundaries",
      "constituency candidates",
      "regional list candidates",
      "constituency and list polling",
      "AMS allocation rules"
    ],
    firstGate: "Constituency/list split and allocation review"
  }
];

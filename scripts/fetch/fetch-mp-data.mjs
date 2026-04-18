/**
 * Fetch current UK MPs from the Parliament Members API.
 * Maps each MP to their constituency and constituent local authorities.
 * Output: src/data/live/mp-directory.json
 *
 * Usage: node scripts/fetch/fetch-mp-data.mjs
 */

import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../../src/data/live/mp-directory.json");

const MEMBERS_API = "https://members-api.parliament.uk/api/Members/Search";

// Party name normalisation
const PARTY_MAP = {
  "Labour": "Labour",
  "Conservative": "Conservative",
  "Liberal Democrat": "Liberal Democrats",
  "Liberal Democrats": "Liberal Democrats",
  "Scottish National Party": "SNP",
  "Reform UK": "Reform UK",
  "Green Party": "Green",
  "Plaid Cymru": "Plaid Cymru",
  "Democratic Unionist Party": "DUP",
  "Sinn Féin": "Sinn Fein",
  "Alliance Party of Northern Ireland": "Alliance",
  "Social Democratic & Labour Party": "SDLP",
  "Ulster Unionist Party": "UUP",
  "Speaker": "Speaker",
  "Independent": "Independent",
};

async function fetchAllMPs() {
  const allMPs = [];
  let skip = 0;
  const take = 20;
  let total = Infinity;

  console.log("Fetching MPs from Parliament API...");

  while (skip < total) {
    const url = `${MEMBERS_API}?House=Commons&IsCurrentMember=true&skip=${skip}&take=${take}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`API error: ${res.status} at skip=${skip}`);
      break;
    }
    const data = await res.json();
    total = data.totalResults ?? data.items?.length ?? 0;

    for (const item of data.items ?? []) {
      const member = item.value;
      if (!member) continue;

      const latestMembership = member.latestHouseMembership;
      const constituency = latestMembership?.membershipFrom ?? "";
      const party = PARTY_MAP[member.latestParty?.name] ?? member.latestParty?.name ?? "Unknown";
      const photoUrl = member.thumbnailUrl ?? null;

      allMPs.push({
        memberId: member.id,
        mpName: member.nameDisplayAs ?? `${member.nameAddressAs}`,
        party,
        constituencyName: constituency,
        photoUrl,
        majority: latestMembership?.membershipStartDate ? null : null, // API doesn't provide majority
        electedDate: latestMembership?.membershipStartDate ?? null,
      });
    }

    skip += take;
    // Rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`Fetched ${allMPs.length} MPs`);
  return allMPs;
}

async function main() {
  const mps = await fetchAllMPs();

  const output = {
    source: "Parliament Members API",
    lastUpdated: new Date().toISOString().split("T")[0],
    totalMPs: mps.length,
    members: mps.sort((a, b) => a.constituencyName.localeCompare(b.constituencyName)),
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${mps.length} MPs to ${OUT_PATH}`);

  // Summary
  const parties = {};
  for (const mp of mps) {
    parties[mp.party] = (parties[mp.party] ?? 0) + 1;
  }
  console.log("Party breakdown:", parties);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

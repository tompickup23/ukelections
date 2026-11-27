#!/usr/bin/env node
// First cut of the May 2027 ward list for England, with a baseline for every
// ward. Data only: no page, engine or forecast reads these files yet.
//
// Writes:
//   data/identity/wards-2027.json            councils in scope, their wards, seats up, sources
//   data/identity/wards-2027-baselines.json  one baseline per ward with its method, plus the
//                                            most recent by-election kept apart
//
// Method and sources: docs/wards-2027-method.md. Inputs are listed, with
// sha256, in each output's "inputs" block. Inputs outside the repo are read
// from .cache/wards-2027/ (gitignored); the doc says where each comes from.
//
// Usage: node scripts/build-wards-2027.mjs [--check]   (--check: build and compare, write nothing)

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCsv, slugify, canonicalParty, fullSlateShares, pooledShares, notionalShares, wardSlugIndex,
  loadWardLookupCsv, sha256File, round6, parseOrderCommencement, councilLadSlug, sumShares, looseSlug,
} from "./lib/wards-2027-lib.mjs";
import { loadInputs, validateNotional } from "./wards-2027-validate-notional.mjs";
import { readOrder } from "./lib/wards-2027-orders.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/wards-2027");
const ORDERS = join(CACHE, "orders");
const OUT_WARDS = join(ROOT, "data/identity/wards-2027.json");
const OUT_BASE = join(ROOT, "data/identity/wards-2027-baselines.json");
const POLLING_DAY = "2027-05-06";
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// Published totals the summary is compared with. Quoted as reported in the
// brief for this work; not fetched (see the doc).
const RIVAL_TOTALS = { english_councils: 215, seats: 7554, note: "The English total that rival sites list for 6 May 2027, as given in the brief for this work (27 November 2026). Not fetched or checked here." };

const SRC = {
  wd26: { key: "wd26", label: "ONS, Wards (May 2026) Boundaries UK BGC, as committed in data/geography/wd26-bgc.geojson", url: "https://geoportal.statistics.gov.uk/" },
  dc: { key: "dc", label: "Democracy Club ward results, England 2016 to April 2026, Drive library: DOGE/Elections & Demographics/01 Election results (ward, 2016-2026)/ward_results_2016-2026_candidates.csv", url: "https://candidates.democracyclub.org.uk/" },
  may2026: { key: "may2026", label: "May 2026 results as merged for the site, data/results/may-2026/local-and-mayor.merged.json", url: null },
  leap2019: { key: "leap2019", label: "Andrew Teale, Local Elections Archive Project, all local election results for 2019 (leap-2019-05-02.csv), retrieved 27 November 2026", url: "https://www.andrewteale.me.uk/2019/leap-2019-05-02.zip" },
  leap2022: { key: "leap2022", label: "Andrew Teale, Local Elections Archive Project, all local election results for 2022 (leap-2022-05-05.csv), retrieved 27 November 2026", url: "https://www.andrewteale.me.uk/2022/leap-2022-05-05.zip" },
  appends: { key: "appends", label: "Local by-election results since May 2026, data/history/byelection-appends.json", url: null },
};

function loadLeap(file, date, src) {
  const text = readFileSync(join(CACHE, file), "utf8");
  const lines = parseCsv(`c0,c1,c2,c3,c4,c5,c6,c7\n${text}`);
  const byWard = new Map();
  for (const r of lines) {
    if (!r.c3?.startsWith("E05") && !r.c3?.startsWith("E58")) continue;
    if (!byWard.has(r.c3)) byWard.set(r.c3, { code: r.c3, council: r.c0, ward: r.c2, date, cands: [], elected: 0, source: src });
    const w = byWard.get(r.c3);
    w.cands.push({ party: canonicalParty(r.c5), votes: Number(r.c6) });
    if (r.c7 === "1") w.elected++;
  }
  for (const w of byWard.values()) {
    const s = fullSlateShares(w.cands);
    w.rows = w.cands.length;
    w.shares = s?.shares || null;
    w.total_votes = s?.total_votes || null;
    delete w.cands;
  }
  return byWard;
}

function loadOrders() {
  if (!existsSync(join(ORDERS, "index.json"))) throw new Error("Run node scripts/wards-2027-fetch-orders.mjs first (.cache/wards-2027/orders/index.json missing).");
  const index = JSON.parse(readFileSync(join(ORDERS, "index.json"), "utf8"));
  return index.map((o) => {
    const base = join(ORDERS, o.id.replace(/\//g, "_"));
    const art1 = existsSync(`${base}.article1.txt`) ? readFileSync(`${base}.article1.txt`, "utf8") : "";
    const m = o.title.match(/^The (.+?) \(Electoral Changes\)/);
    return {
      ...o,
      council_slug: m ? slugify(m[1]) : null,
      amendment: /\(Amendment\)/.test(o.title),
      ...parseOrderCommencement(art1),
      read: existsSync(`${base}.xml`) ? readOrder(readFileSync(`${base}.xml`, "utf8")) : null,
    };
  });
}

function main() {
  const check = process.argv.includes("--check");
  const councils27 = read("data/identity/councils-2027.json");
  const evidence = read("data/identity/councils-2027-cycle-evidence.json");
  const cbase = new Map(read("data/identity/councils-2027-baselines.json").councils.map((c) => [c.slug, c]));
  const evBySlug = new Map(evidence.councils.map((c) => [c.slug, c]));
  const inputs = loadInputs();
  const { dc, sets, b2026 } = inputs;
  const wd22 = (() => {
    const j = read("data/features/lsoa21-to-ward.json").lookup;
    let csv = "lsoa21cd,wardcd,wardnm,ladcd,ladnm\n";
    for (const [l, v] of Object.entries(j)) csv += `${l},${v.wd22cd},"${v.wd22nm.replace(/"/g, '""')}",${v.lad22cd},"${v.lad22nm.replace(/"/g, '""')}"\n`;
    return loadWardLookupCsv(csv);
  })();
  const leap2019 = loadLeap("leap-2019-05-02.csv", "2019-05-02", SRC.leap2019);
  const leap2022 = loadLeap("leap-2022-05-05.csv", "2022-05-05", SRC.leap2022);
  const orders = loadOrders();
  const appends = read("data/history/byelection-appends.json");

  // Ordinary results by ONS ward code, every year we can join.
  const ordinaryByCode = new Map(); // code -> [{date, ...ballot}]
  const pushResult = (code, r) => {
    if (!code || !r.shares) return;
    if (!ordinaryByCode.has(code)) ordinaryByCode.set(code, []);
    ordinaryByCode.get(code).push(r);
  };
  const idx = { 2023: wardSlugIndex(sets[2023].wards), 2024: wardSlugIndex(sets[2024].wards), 2022: wardSlugIndex(wd22.wards), 2026: wardSlugIndex(sets[2026].wards) };
  const ballotSet = (y) => (y === 2026 ? sets[2026] : y === 2022 ? wd22 : sets[y]);
  for (const b of dc.values()) {
    if (b.by_election) continue;
    const y = Number(b.date.slice(0, 4));
    if (![2022, 2023, 2024].includes(y)) continue;
    const code = idx[y](b.council_slug, b.ward_slug);
    if (code && ballotSet(y).wards.has(code)) pushResult(code, { ...b, source: SRC.dc, source_url: b.source });
  }
  for (const b of b2026.values()) {
    const code = b.gss && sets[2026].wards.has(b.gss) ? b.gss : idx[2026](b.council_slug, b.ward_slug);
    if (code) pushResult(code, { ...b, source: SRC.may2026, source_url: null });
  }
  for (const w of leap2022.values()) pushResult(w.code, { ...w, ballot_paper_id: null, source_url: SRC.leap2022.url });
  for (const list of ordinaryByCode.values()) list.sort((a, b) => b.date.localeCompare(a.date));

  // By-elections, by council slug and ward slug, newest first.
  const byeByWard = new Map();
  const pushBye = (council, ward, r) => {
    const k = `${council}/${ward}`;
    if (!byeByWard.has(k)) byeByWard.set(k, []);
    byeByWard.get(k).push(r);
  };
  for (const b of dc.values()) if (b.by_election && b.shares) pushBye(b.council_slug, b.ward_slug, { ballot_paper_id: b.ballot_paper_id, date: b.date, shares: b.shares, rows: b.rows, source: "dc", source_url: b.source });
  for (const r of appends.results) {
    const s = fullSlateShares(r.candidates.map((c) => ({ party: canonicalParty(c.party_name, c.party_ec_id), votes: c.votes })));
    if (s && !r.candidates.some((c) => c.votes == null)) pushBye(r.council_slug, r.ward_slug, { ballot_paper_id: r.ballot_paper_id, date: r.election_date, shares: s.shares, rows: r.candidates.length, source: "appends", source_url: r.source, review_status: r.review_status });
  }
  for (const list of byeByWard.values()) list.sort((a, b) => b.date.localeCompare(a.date));

  // The year each current ward code first appears in the ONS sets on hand.
  const firstSet = (code) => (wd22.wards.has(code) ? 2022 : sets[2023].wards.has(code) ? 2023 : sets[2024].wards.has(code) ? 2024 : sets[2025].wards.has(code) ? 2025 : 2026);

  // Councils in scope.
  const scope = [
    ...councils27.councils.filter((c) => c.nation === "E").map((c) => ({ ...c, block: "verified" })),
    ...councils27.not_verified.map((c) => ({ ...c, block: "unverified", evidence: evBySlug.get(c.slug) || null })),
  ];

  const wards26ByLad = new Map();
  for (const w of sets[2026].wards.values()) {
    if (!wards26ByLad.has(w.ladSlug)) wards26ByLad.set(w.ladSlug, []);
    wards26ByLad.get(w.ladSlug).push(w);
  }

  const councilRows = [];
  const wardRows = [];
  const baseRows = [];

  for (const c of scope) {
    const cb = cbase.get(c.slug) || null;
    const ev = c.evidence;
    const row = {
      slug: c.slug, name: c.name, block: c.block, cycle: c.cycle || ev?.stored_cycle || null,
      council_seats_up: c.block === "verified" ? c.seats_up?.value ?? null : null,
      council_seats_up_source: c.block === "verified" ? (c.seats_up?.value != null ? `data/identity/councils-2027.json (${c.seats_up.source_label})` : "blank in data/identity/councils-2027.json") : null,
      status_2027: c.block === "verified" ? "verified" : ev?.status_2027 || "no_evidence",
      last_ordinary_poll: cb?.latest_ordinary_poll || null,
      boundaries: null, boundary_order: null, wards_listed: 0, ward_seats_sum: null, notes: [],
    };
    councilRows.push(row);
    if (c.block === "unverified" && row.status_2027 !== "due_by_cycle") {
      row.notes.push(`Not listed: councils-2027-cycle-evidence.json says ${row.status_2027} (${ev?.dc_cycle?.basis || "no basis"}).`);
      continue;
    }
    const mine = orders.filter((o) => o.council_slug === c.slug && o.read);
    const redraw = mine.find((o) => o.read.effect_2027 === "redraw");
    const related = mine.filter((o) => o.read.effect_2027 === "related_alteration");
    const drawnFor = (o) => o.read.redraw?.year ?? o.read.retirement_2027?.elected_in ?? null;
    const retire = mine.filter((o) => o.read.retirement_2027 && drawnFor(o)).sort((p, q) => q.id.localeCompare(p.id, undefined, { numeric: true }))[0] || null;
    const lad = wards26ByLad.get(councilLadSlug(c.slug)) || [];
    const cite = (o, effect) => effect === "retirement_2027"
      ? { title: o.title, url: o.url, effect, wards_drawn_for: drawnFor(o), retirement_2027: o.read.retirement_2027.quote ? o.read.retirement_2027.quote.replace(/\s*\u2014\s*/g, ": ") : `${o.read.retirement_2027.schedule_title}, column for 2027` }
      : { title: o.title, url: o.url, effect, in_force_2027: o.quotes_2027[0] || null };
    row.boundary_order = [...(redraw ? [cite(redraw, "redraw")] : []), ...related.map((o) => cite(o, "related_alteration")), ...(retire ? [cite(retire, "retirement_2027")] : [])];
    if (!row.boundary_order.length) row.boundary_order = null;
    let wards = [];
    if (redraw) {
      const r = redraw.read.redraw;
      if (r.wards && r.wards.length === r.wards_in_note) {
        row.boundaries = "new";
        row.new_ward_unit = r.unit;
        row.new_wards_in_order_note = r.wards_in_note;
        wards = r.wards.map((w) => ({ name: w.name, councillors: w.councillors, boundaries: "new" }));
      } else {
        row.boundaries = "unknown";
        row.notes.push(`${redraw.title} redraws the ${r.unit}s from 2027 (${r.wards_in_note} in its note), but its schedule gave ${r.wards ? r.wards.length : "no"} names here; wards left blank.`);
      }
    } else if (lad.length) {
      const affected = new Map();
      for (const o of related) for (const n of o.read.related_alteration.wards) affected.set(looseSlug(slugify(n)), { name: n, order: o.title });
      row.boundaries = related.length ? "current_with_related_alterations" : "current";
      const matched = new Set();
      wards = lad.map((w) => {
        const hit = affected.get(looseSlug(w.slug));
        if (hit) matched.add(looseSlug(w.slug));
        return { w, boundaries: hit ? "altered_2027" : "current", altered_by: hit?.order || null };
      });
      for (const [k, v] of affected) if (!matched.has(k)) row.notes.push(`${v.order} names ${v.name} district ward, which is not in the May 2026 ward set for this council.`);
      if (related.length) row.notes.push(`${related.map((o) => o.title).join("; ")}: a parish-led transfer of a small area between the wards marked altered_2027, from the 2027 elections. They are listed on their May 2026 boundaries.`);
    } else {
      row.boundaries = "unknown";
      row.notes.push("No May 2026 ward set found for this council in the ONS layer.");
    }

    let seatSum = 0, seatKnown = 0, listed = 0;
    row.wards_not_voting_2027 = [];
    // Does the council have any 2023 ordinary result on hand? Used to flag
    // wards with none in a council elected in parts.
    const council2023 = wards.some((x) => x.w && (ordinaryByCode.get(x.w.code) || []).some((r) => r.date.startsWith("2023")));
    for (const x of wards) {
      const name = x.w ? x.w.name : x.name;
      const wslug = slugify(name);
      const id = `${c.slug}/${wslug}`;
      const ward = {
        id, council_slug: c.slug, block: c.block, ward_name: name, ward_slug: wslug,
        gss_code: x.w ? x.w.code : null, boundaries: x.boundaries,
        seats_up: null, seats_up_basis: null, ward_source: x.w ? "wd26" : "order", notes: [],
      };
      if (!x.w && redraw) { ward.ward_source = "order"; ward.ward_order = redraw.title; ward.ward_source_url = redraw.url; }
      if (x.altered_by) ward.notes.push(`Boundary altered from 2027 by ${x.altered_by} (small area transfer).`);

      // Seats up.
      const rt = retire?.read.retirement_2027;
      const retireApplies = rt && x.w && drawnFor(retire) === firstSet(x.w.code);
      if (x.councillors != null && /all out/i.test(row.cycle || "")) {
        ward.seats_up = x.councillors; ward.seats_up_basis = "order_schedule_all_out";
        ward.seats_up_note = `${x.councillors} councillor(s) for this ${row.new_ward_unit || "ward"} in ${redraw.title}; whole council elected.`;
      } else if (retireApplies && rt.basis === "one_per_ward" && rt.councillors_per_ward === 3) {
        ward.seats_up = 1; ward.seats_up_basis = "order_retirement_2027";
        ward.seats_up_note = `${retire.title}, article 4: of the three councillors elected for each ward in ${rt.elected_in}, one retires at the 2027 ordinary election.`;
      } else if (retireApplies && rt.basis === "schedule" && rt.wards.find((q) => looseSlug(slugify(q.name)) === looseSlug(x.w.slug))) {
        ward.seats_up = rt.wards.find((q) => looseSlug(slugify(q.name)) === looseSlug(x.w.slug)).seats_2027; ward.seats_up_basis = "order_retirement_2027";
        ward.seats_up_note = `${retire.title}, ${rt.schedule_title}: column "Number of councillors to retire in 2027".`;
      } else if (x.w) {
        const res = ordinaryByCode.get(x.w.code) || [];
        const r2023 = res.find((r) => r.date.startsWith("2023") && r.elected > 0);
        const fs = firstSet(x.w.code);
        if (r2023 && fs <= 2023) {
          ward.seats_up = r2023.elected; ward.seats_up_basis = "elected_2023_same_ward";
          ward.seats_up_note = `${r2023.elected} elected on ${r2023.date} (${r2023.ballot_paper_id}); four-year terms end in 2027.`;
        } else if (/all out/i.test(row.cycle || "")) {
          const l19 = leap2019.get(x.w.code);
          if (l19 && fs <= 2022 && l19.elected > 0) {
            ward.seats_up = l19.elected; ward.seats_up_basis = "elected_2019_same_ward_code";
            ward.seats_up_note = `${l19.elected} elected in this ward (same ONS code) on 2 May 2019 (LEAP); inferred, checked against the council total below.`;
          }
        }
      }
      if (ward.seats_up === 0) {
        // The order says none of this ward's councillors retire in 2027.
        row.wards_not_voting_2027.push({ ward_name: name, gss_code: ward.gss_code, source: ward.seats_up_note });
        continue;
      }
      if (ward.seats_up == null && x.w && !/all out/i.test(row.cycle || "") && council2023 && firstSet(x.w.code) <= 2023) {
        ward.may_not_vote_2027 = true;
        ward.notes.push("No 2023 ordinary contest on record for this ward, though the council's other wards have one. It may not vote in 2027 (in a council elected in parts, a ward with fewer councillors skips some years), or the record is missing.");
      }
      if (ward.seats_up != null) { seatSum += ward.seats_up; seatKnown++; }
      listed++;
      wardRows.push(ward);

      // Baseline.
      const base = { id, council_slug: c.slug, block: c.block, gss_code: ward.gss_code, method: "none", baseline: null, notional: null, fallback_2019: null, last_by_election: null, note: null };
      const minDate = /all out/i.test(row.cycle || "") ? row.last_ordinary_poll : null;
      if (x.w) {
        const res = (ordinaryByCode.get(x.w.code) || []).filter((r) => !minDate || r.date >= minDate);
        if (res.length) {
          const r = res[0];
          base.method = "same_ward";
          if (x.altered_by) base.note = `Ward altered by a small area transfer from 2027 (${x.altered_by}); this baseline is on its May 2026 boundaries.`;
          base.baseline = { date: r.date, ballot_paper_id: r.ballot_paper_id || null, source: r.source.key, source_url: r.source_url || null, rows: r.rows, total_votes: r.total_votes, elected: r.elected, shares: r.shares, pooled: pooledShares(r.shares) };
        } else {
          // Notional: the ward is new since the council's last poll on hand,
          // and the old wards voted at that poll.
          const fs = firstSet(x.w.code);
          const pick = fs >= 2024 ? 2023 : null;
          if (pick && minDate === null) {
            const old = new Map();
            for (const [code, list] of ordinaryByCode) {
              const r = list.find((q) => q.date.startsWith(String(pick)) && q.council_slug === c.slug);
              if (r) old.set(code, r.shares);
            }
            const n = notionalShares(x.w.lsoas, sets[pick].lsoaToWard, old);
            if (n.shares && n.lsoas_used / n.lsoas_total >= 0.8) {
              base.method = "notional";
              base.baseline = { date: `${pick}-05-04`, source: "dc", shares: n.shares, pooled: pooledShares(n.shares) };
              base.notional = { from_ward_set: `ONS wards ${pick}`, lsoa_lookup_from: `lsoa21_to_ward_wd${String(pick).slice(2)}.csv`, lsoa_lookup_to: "lsoa21-to-wd26 (centroid best-fit)", ...withoutShares(n) };
            }
          }
          if (base.method === "none") {
            base.note = minDate
              ? `No result from this council's last ordinary poll (${minDate}) is on hand for this ward. For most such councils the Democracy Club file has no ${minDate.slice(0, 4)} ordinary results at all (see docs/wards-2027-method.md).`
              : "No ordinary result on hand for this ward since its boundaries were set.";
          }
        }
        // Context only: the 2019 result on these boundaries, or carried to them.
        if (base.method === "none") {
          const l19 = leap2019.get(x.w.code);
          if (l19?.shares && firstSet(x.w.code) <= 2022) {
            base.fallback_2019 = { method: "same_ward", date: "2019-05-02", source: "leap2019", rows: l19.rows, total_votes: l19.total_votes, shares: l19.shares, pooled: pooledShares(l19.shares) };
          } else {
            const old = new Map();
            for (const w of leap2019.values()) if (w.shares && wd22.wards.get(w.code)?.ladSlug === councilLadSlug(c.slug)) old.set(w.code, w.shares);
            if (old.size) {
              const n = notionalShares(x.w.lsoas, wd22.lsoaToWard, old);
              if (n.shares && n.lsoas_used / n.lsoas_total >= 0.8) base.fallback_2019 = { method: "notional", date: "2019-05-02", source: "leap2019", shares: n.shares, pooled: pooledShares(n.shares), notional: { from_ward_set: "ONS wards 2022 (taken as the 2019 set)", lsoa_lookup_to: "lsoa21-to-wd26 (centroid best-fit)", ...withoutShares(n) } };
            }
          }
        }
        const byes = (byeByWard.get(`${c.slug}/${x.w.slug}`) || []).filter((r) => Number(r.date.slice(0, 4)) >= firstSet(x.w.code));
        if (byes.length) base.last_by_election = byes[0];
      } else {
        base.note = "New ward from the 2027 order; ONS has not published its boundary, so there are no LSOAs to carry old results by. Needs the LGBCE final recommendations boundary to build a notional.";
      }
      baseRows.push(base);
      ward.baseline_method = base.method;
    }
    row.wards_listed = listed;
    if (!row.wards_not_voting_2027.length) delete row.wards_not_voting_2027;
    row.ward_seats_sum = seatKnown === listed && listed ? seatSum : null;
    row.ward_seats_known = seatKnown;
    const mineW = wardRows.filter((q) => q.council_slug === c.slug);
    const blank = (w, basis) => { w.seats_up = null; w.seats_up_basis = basis; delete w.seats_up_note; };
    const orderBased = mineW.length && mineW.every((w) => /^order_/.test(w.seats_up_basis || ""));
    if (row.council_seats_up != null && row.ward_seats_sum != null && row.ward_seats_sum !== row.council_seats_up) {
      if (orderBased) {
        row.notes.push(`The order gives ${row.ward_seats_sum} seats against ${row.council_seats_up} in councils-2027.json, which looks like the size of the council before the order; the order's figures are kept. For Tom: check councils-2027.json.`);
        row.ward_seats_check = "order_differs_from_councils_2027_json";
      } else {
        row.notes.push(`Ward seats sum to ${row.ward_seats_sum} against ${row.council_seats_up} in councils-2027.json; per-ward seats left blank.`);
        for (const w of mineW) blank(w, "blank_total_mismatch");
        row.ward_seats_sum = null; row.ward_seats_known = 0;
      }
    }
    // Seats inferred from 2019 stand only where they reconcile with a sourced total.
    if (mineW.some((w) => w.seats_up_basis === "elected_2019_same_ward_code") && row.ward_seats_check == null && !(row.council_seats_up != null && row.ward_seats_sum === row.council_seats_up)) {
      for (const w of mineW) if (w.seats_up_basis === "elected_2019_same_ward_code") blank(w, "blank_2019_unreconciled");
      row.notes.push("Per-ward seats from 2019 not kept: no sourced council total to check them against, or not every ward had one.");
      row.ward_seats_known = mineW.filter((w) => w.seats_up != null).length;
      row.ward_seats_sum = row.ward_seats_known === mineW.length && mineW.length ? mineW.reduce((t, w) => t + w.seats_up, 0) : null;
    }
    if (!row.ward_seats_check) row.ward_seats_check = row.council_seats_up != null && row.ward_seats_sum === row.council_seats_up ? "matches_council_total" : null;
  }

  // Unique ids.
  const seen = new Map();
  for (const w of wardRows) seen.set(w.id, (seen.get(w.id) || 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (dups.length) throw new Error(`Duplicate ward ids: ${dups.join(", ")}`);

  const validation = validateNotional(inputs);
  const summary = buildSummary(councilRows, wardRows, baseRows, councils27);
  const inputsBlock = buildInputs(orders);
  const generated = new Date().toISOString().slice(0, 10);

  const wardsOut = {
    generated_at: generated,
    generator: "scripts/build-wards-2027.mjs",
    polling_day: POLLING_DAY,
    status: "first_cut",
    scope: "England only. Scotland (STV) and Wales are out of scope for this cut. Councils are those in data/identity/councils-2027.json: the verified English councils, and the unverified ones as a separate, flagged block (block: \"unverified\").",
    method_doc: "docs/wards-2027-method.md",
    field_notes: {
      boundaries: "current: May 2026 ONS wards, no order changes them for 2027. altered_2027: a May 2026 ward that a related-alteration order changes by a small parish-led area transfer from 2027. new: an Electoral Changes Order redraws the council's wards or divisions from the 2027 ordinary elections; names and councillors come from its schedule and there is no ONS code yet. unknown: the ward set could not be read.",
      seats_up_basis: "elected_2023_same_ward: winners at the 2023 ordinary poll in the same ward, whose terms end in 2027. elected_2019_same_ward_code: all-out council, winners in the same ONS ward code in 2019, kept only where the council's wards sum to its sourced total. order_schedule_all_out: councillors per ward in the 2027 order, all-out council. order_retirement_2027: the order that drew the current wards says how many of each ward's councillors retire in 2027. blank_total_mismatch / blank_2019_unreconciled: a figure was found but did not reconcile, so it is withheld. null: not established.",
    },
    sources: SRC,
    inputs: inputsBlock,
    summary,
    councils: councilRows,
    wards: wardRows,
  };
  const baseOut = {
    generated_at: generated,
    generator: "scripts/build-wards-2027.mjs",
    polling_day: POLLING_DAY,
    status: "first_cut",
    convention: "Full-slate party shares, as scripts/score-may-2026-like-for-like.mjs: every candidate's votes summed by party over all votes cast in the ward. \"Labour and Co-operative Party\" counts as Labour, as in local-and-mayor.merged.json. pooled keeps Reform UK, Labour, Conservative, Liberal Democrats and Green Party and puts every other party and independent in Others.",
    methods: {
      same_ward: "The ward's own last ordinary result on the same boundaries (same ONS code). For an all-out council it must come from the council's last ordinary poll or later, so an older result is never passed off as current.",
      renamed: "An explicit old-to-new mapping from a source. None found in this cut.",
      notional: "Old wards' results carried to the new ward by the 2021 LSOAs they share (ONS best-fit lookups; a centroid best-fit for May 2026 wards), weights kept. Validated below.",
      none: "No baseline. The note says why.",
    },
    by_elections: "Kept out of every baseline. last_by_election is the most recent principal-council by-election in the ward on its current boundaries, from the Democracy Club file (to April 2026) and data/history/byelection-appends.json (since May 2026).",
    fallback_2019: "Context only, never a baseline: where a ward has no baseline, its 2 May 2019 result (LEAP) on the same code, or carried to it by LSOAs. Eight years old by polling day.",
    sources: SRC,
    inputs: inputsBlock,
    summary: summary.baselines,
    notional_validation: validation,
    wards: baseRows,
  };

  const wardsJson = compactJson(wardsOut, ["councils", "wards"]);
  const baseJson = compactJson(baseOut, ["wards"]);
  if (check) {
    const strip = (s) => s.replace(/"generated_at": "[^"]*"/, "");
    const same = existsSync(OUT_WARDS) && strip(readFileSync(OUT_WARDS, "utf8")) === strip(wardsJson) && strip(readFileSync(OUT_BASE, "utf8")) === strip(baseJson);
    console.log(same ? "wards-2027 files are up to date" : "wards-2027 files differ from a fresh build");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT_WARDS, wardsJson);
  writeFileSync(OUT_BASE, baseJson);
  printSummary(summary, validation);
}

function buildSummary(councilRows, wardRows, baseRows, councils27) {
  const block = (b) => {
    const cs = councilRows.filter((c) => c.block === b);
    const listed = cs.filter((c) => c.wards_listed > 0);
    const ws = wardRows.filter((w) => w.block === b);
    const bs = baseRows.filter((x) => x.block === b);
    const byMethod = { same_ward: 0, renamed: 0, notional: 0, none: 0 };
    for (const x of bs) byMethod[x.method]++;
    return {
      councils: cs.length,
      councils_with_wards_listed: listed.length,
      councils_not_listed: cs.filter((c) => !c.wards_listed).map((c) => c.slug),
      councils_by_boundaries: count(cs.map((c) => c.boundaries || "not_listed")),
      wards_listed: ws.length,
      wards_by_boundaries: count(ws.map((w) => w.boundaries)),
      wards_with_seats_up: ws.filter((w) => w.seats_up != null).length,
      ward_seats_up_sum: ws.reduce((s, w) => s + (w.seats_up || 0), 0),
      wards_by_baseline_method: byMethod,
      wards_with_no_baseline: byMethod.none,
      wards_with_no_baseline_but_2019_context: bs.filter((x) => x.method === "none" && x.fallback_2019).length,
      wards_with_a_by_election_on_current_boundaries: bs.filter((x) => x.last_by_election).length,
    };
  };
  const v = block("verified");
  const verifiedRows = councilRows.filter((c) => c.block === "verified");
  return {
    verified: v,
    unverified: block("unverified"),
    baselines: { verified: v.wards_by_baseline_method, unverified: block("unverified").wards_by_baseline_method },
    reconciliation: {
      councils_2027_json: {
        english_councils_verified: councils27.councils.filter((c) => c.nation === "E").length,
        english_councils_not_verified: councils27.not_verified.length,
        english_seats_up_sourced: verifiedRows.reduce((s, c) => s + (c.council_seats_up || 0), 0),
        english_councils_with_seats_up: verifiedRows.filter((c) => c.council_seats_up != null).length,
        councils_where_ward_seats_match_the_sourced_total: verifiedRows.filter((c) => c.ward_seats_check === "matches_council_total").length,
      },
      this_file: (() => {
        const listed = councilRows.filter((c) => c.wards_listed > 0);
        const best = (c) => (c.council_seats_up != null && c.ward_seats_check !== "order_differs_from_councils_2027_json" ? c.council_seats_up : c.ward_seats_sum);
        const known = listed.filter((c) => best(c) != null);
        return {
          english_councils_listed: listed.length,
          of_which_verified: listed.filter((c) => c.block === "verified").length,
          of_which_unverified_due_by_cycle: listed.filter((c) => c.block === "unverified").length,
          councils_with_seats_up_known: known.length,
          seats_up_known: known.reduce((t, c) => t + best(c), 0),
          councils_with_seats_up_unknown: listed.length - known.length,
          seats_rule: "Sourced seats_up in councils-2027.json where given (except where a 2027 order supersedes it), otherwise the sum of per-ward seats when every ward has one.",
        };
      })(),
      rivals: RIVAL_TOTALS,
    },
  };
}

// Pretty top level, one line per record in the long arrays, so the files stay
// readable in a diff without tripling in size.
function compactJson(obj, listKeys) {
  const parts = Object.entries(obj).map(([k, v]) => {
    if (listKeys.includes(k) && Array.isArray(v)) return ` ${JSON.stringify(k)}: [\n${v.map((x) => `  ${JSON.stringify(x)}`).join(",\n")}\n ]`;
    return ` ${JSON.stringify(k)}: ${JSON.stringify(v, null, 1).replace(/\n/g, "\n ")}`;
  });
  return `{\n${parts.join(",\n")}\n}\n`;
}

function withoutShares({ shares, ...rest }) {
  return rest;
}

function count(xs) {
  const o = {};
  for (const x of xs) o[x] = (o[x] || 0) + 1;
  return o;
}

function buildInputs(orders) {
  const f = (p) => (existsSync(p) ? sha256File(p) : null);
  return [
    { name: "ward_results_2016-2026_candidates.csv", ...SRC.dc, sha256: f(join(CACHE, "ward_results_2016-2026_candidates.csv")) },
    { name: "lsoa21_to_ward_wd23.csv / wd24 / wd25", label: "ONS LSOA (2021) to ward best-fit lookups, Drive library: DOGE/Elections & Demographics/03 Geography and lookups/", sha256: [23, 24, 25].map((y) => f(join(CACHE, `lsoa21_to_ward_wd${y}.csv`))) },
    { name: "lsoa21_population_weighted_centroids.csv", label: "ONS LSOA (2021) population-weighted centroids, Drive library: 03 Geography and lookups/", sha256: f(join(CACHE, "lsoa21_population_weighted_centroids.csv")) },
    { name: "leap-2019-05-02.csv", ...SRC.leap2019, sha256: f(join(CACHE, "leap-2019-05-02.csv")) },
    { name: "leap-2022-05-05.csv", ...SRC.leap2022, sha256: f(join(CACHE, "leap-2022-05-05.csv")) },
    { name: "data/geography/wd26-bgc.geojson", ...SRC.wd26, sha256: f(join(ROOT, "data/geography/wd26-bgc.geojson")) },
    { name: "data/features/lsoa21-to-ward.json", label: "ONS LSOA21 to WD22 lookup, committed", sha256: f(join(ROOT, "data/features/lsoa21-to-ward.json")) },
    { name: "data/results/may-2026/local-and-mayor.merged.json", ...SRC.may2026, sha256: f(join(ROOT, "data/results/may-2026/local-and-mayor.merged.json")) },
    { name: "data/identity/wards-may-2026.json", label: "May 2026 ballots with ONS codes", sha256: f(join(ROOT, "data/identity/wards-may-2026.json")) },
    { name: "data/history/byelection-appends.json", ...SRC.appends, sha256: f(join(ROOT, "data/history/byelection-appends.json")) },
    { name: "data/identity/councils-2027.json and councils-2027-cycle-evidence.json and councils-2027-baselines.json", label: "Council scope, cycle and last poll", sha256: ["councils-2027.json", "councils-2027-cycle-evidence.json", "councils-2027-baselines.json"].map((n) => f(join(ROOT, "data/identity", n))) },
    { name: "Electoral Changes Orders 2023 to 2026", label: "legislation.gov.uk, UK Statutory Instruments titled \"(Electoral Changes) Order\", made 2023 to 2026, article 1 of each, retrieved 27 November 2026", url: "https://www.legislation.gov.uk/uksi", orders: orders.length, in_force_2027_for_wards: orders.filter((o) => o.ward_change_years.includes(2027)).map((o) => ({ title: o.title, url: o.url })) },
  ];
}

function printSummary(s, v) {
  const line = (k, b) => console.log(`${k.padEnd(12)} councils ${b.councils} (wards listed for ${b.councils_with_wards_listed}), wards ${b.wards_listed}, by method ${JSON.stringify(b.wards_by_baseline_method)}, no baseline ${b.wards_with_no_baseline} (2019 context for ${b.wards_with_no_baseline_but_2019_context}), seats on wards ${b.ward_seats_up_sum} over ${b.wards_with_seats_up} wards`);
  line("verified", s.verified);
  line("unverified", s.unverified);
  console.log("boundaries (verified councils):", JSON.stringify(s.verified.councils_by_boundaries));
  console.log("reconciliation:", JSON.stringify(s.reconciliation));
  for (const p of v.pairs) console.log(`notional ${p.pair}: notional MAE ${p.notional_on_redrawn_wards.mae_raw} vs same_ward ${p.same_ward_on_unchanged_wards.mae_raw} vs shortcut ${p.council_shortcut_on_redrawn_wards.mae_raw}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

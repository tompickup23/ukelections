import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { localMetadata, localStatus, partyScorecard, roundupHref, loadLocalContests, archiveYears } from "../src/lib/byElections";
import { resultCard, byElectionResultCards } from "../src/lib/byElectionCards";
import { auditByElectionMetadata } from "../scripts/lib/by-election-seo.mjs";
const base = { slug: "sample", status: "upcoming", contest: {ward_name:"Town",council_name:"Example",polling_day:"2026-10-08",voting_system:"FPTP"}, field:{candidate_count:2} };
const result = {declared:true,winner_candidate:"Winner Name",winner_party:"Labour",majority_votes:57,shares:{Labour:.6,Conservative:.4}};
describe("contest state and search presentation",()=>{
  it("switches stale upcoming records to awaited, and declarations to a result",()=>{
    expect(localStatus(base,"2026-10-09")).toBe("Result awaited");
    expect(localMetadata(base,"2026-10-07").title).toContain("candidates");
    expect(localMetadata({...base,result},"2026-10-09")).toMatchObject({status:"Result declared"});
    expect(localMetadata({...base,result}).description).toContain("Winner Name (Labour) elected with a majority of 57");
  });
  it("never describes STV first preferences as a majority",()=>{
    const d={...base,contest:{...base.contest,voting_system:"STV"},declaration:result};
    expect(localMetadata(d).status).toBe("STV result declared");
    expect(localMetadata(d).description).toContain("under STV");
    expect(localMetadata(d).description).not.toContain("majority");
    expect(resultCard(d).shares).toBeUndefined();
    expect(resultCard(d).subline).not.toContain("57");
  });
  it("disambiguates matching ward names in different councils",()=>{
    expect(localMetadata(base).title).not.toBe(localMetadata({...base,contest:{...base.contest,council_name:"Another"}}).title);
  });
  it("counts every party and conserves gains/losses",()=>{
    const rows=partyScorecard([{winner:"Labour",previous:"Reform UK"},{winner:"Green Party",previous:"Conservative"},{winner:"Labour",previous:"Labour"}]);
    expect(rows.map(r=>r.party)).toEqual(["Conservative","Green Party","Labour","Reform UK"]);
    expect(rows.find(r=>r.party==="Labour")).toMatchObject({wins:2,gains:1,holds:1,losses:0,net:1});
    expect(rows.reduce((n,r)=>n+r.net,0)).toBe(0);
  });
  it("links all four checked October roundups and refuses ambiguous matches",()=>{
    const round=JSON.parse(readFileSync("data/results/local-byelections.json","utf8")).dates.find((d:any)=>d.date==="2026-10-08");
    const local=loadLocalContests();
    for(const row of round.contests) expect(roundupHref(round.date,row,local)).toMatch(/^\/by-elections\/local\//);
    expect(roundupHref(round.date,round.contests[0],[...local,...local])).toBeNull();
    expect(archiveYears("2026-10-12")).toContain("2026");
  });
  it("builds unique result cards from recorded winners, with complete share totals",()=>{
    const cards=byElectionResultCards();
    expect(new Set(cards.map(c=>c.slug)).size).toBe(cards.length);
    expect(cards.find(c=>c.slug==="by-elections/holborn-and-st-pancras")?.sharesCaption).toContain("Sagal Abdi-Wali elected · Majority 3,364");
    for(const c of cards) if(c.shares) expect(c.shares.reduce((n,s)=>n+s.pct,0)).toBeCloseTo(1,2);
  });
});
describe("rendered result regression gate",()=>{
  const html = (title:string,description:string,body:string,extra='')=>`<html><head><title>${title}</title><meta name="description" content="${description}">${extra}</head><body><main>${body}</main></body></html>`;
  it("rejects a stale title, an empty winner description, future tense and Event schema",()=>{
    expect(auditByElectionMetadata(html("Town by-election","Result declared","The seat is vacant",'<script type="application/ld+json">{"@type":"Event"}</script>'),{...base,result})).toHaveLength(4);
  });
  it("accepts a declared result with an archived forecast",()=>{
    expect(auditByElectionMetadata(html("Town by-election result","Winner Name elected","Result declared. The saved pre-poll forecast selected Labour."),{...base,result})).toEqual([]);
  });
});

describe('detail-page data accuracy',()=>{
  it('labels multi-seat baselines when the source records multiple elected candidates',()=>{
    for(const d of loadLocalContests()) {
      const elected=d.prior_result?.candidates?.filter((c:any)=>c.elected===true).length || 0;
      if(elected>1) expect(d.prior_result.seats_contested,d.slug).toBeGreaterThanOrEqual(elected);
    }
  });
  it('retains all 34 Clacton counts from the council declaration',()=>{
    const d=JSON.parse(readFileSync('data/predictions/by-elections/clacton-2026-08-13.json','utf8'));
    // Council order, including small candidates: verifies more than just the winner.
    const official=[42,49,9455,28,17,8,256,50,7,60,44,22239,126,347,432,59,14,18,159,46,100,19,65,202,21,16,192,9,132,492,15,371,10,11];
    expect(d.result.candidates.map((c:any)=>c.votes).sort((a:number,b:number)=>a-b)).toEqual([...official].sort((a,b)=>a-b));
    expect(d.result.candidates.find((c:any)=>c.candidate === "Martyn OBrien").votes).toBe(65);
    expect(d.result.candidates.find((c:any)=>c.candidate === "Michael Noel O'Keeffe").votes).toBe(19);
    expect(official.reduce((a,b)=>a+b,0)).toBe(d.result.valid_votes);
  });
  it('rejects future-tense candidate copy on a declared page',()=>{
    expect(auditByElectionMetadata('<title>Town result</title><meta name="description" content="Winner Name"><main>Two candidates are standing.</main>',{...base,result})).toContain('declared page still uses pre-result wording');
  });
});

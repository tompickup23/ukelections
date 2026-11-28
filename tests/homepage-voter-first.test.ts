import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDeclarationCheckedCount, loadMay7Headline } from "../src/lib/siteData";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("homepage postcode box", () => {
  const home = read("src/pages/index.astro");
  const form = home.slice(home.indexOf('<form id="home-lookup"'), home.indexOf("</form>"));

  it("gives the postcode input no name, so a form submit without JavaScript sends nothing", () => {
    expect(form).toContain('id="home-lookup-input"');
    expect(form).not.toMatch(/<input[^>]*\sname=/);
  });

  it("hands the query over in the URL fragment, never the query string", () => {
    expect(home).toContain("/your-area/#q=");
    expect(home).not.toMatch(/your-area\/\?/);
  });

  it("is cleared from the address bar by the lookup page once read", () => {
    const lookup = read("src/pages/your-area.astro");
    expect(lookup).toMatch(/\^#q=/);
    expect(lookup).toContain("history.replaceState(null, \"\", window.location.pathname)");
  });
});

describe("homepage record section", () => {
  const home = read("src/pages/index.astro");

  // Until Nov 2026 the homepage showed the polling day figure (55.2%) under the
  // words "Our locked, sha256-witnessed forecast". The locked forecast scored 49.6%.
  it("names the locked figure and the polling day figure separately", () => {
    expect(home).not.toMatch(/sha256-witnessed/);
    const locked = home.indexOf("may7.prereg_winner_accuracy");
    const live = home.indexOf("may7.live_winner_accuracy");
    expect(locked).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(locked);
    expect(home.slice(home.lastIndexOf("locked", locked), locked)).toMatch(/locked 11 days before polling/);
    expect(home.slice(locked, live)).toMatch(/on polling day/);
  });

  it("takes its counts from the scorecard and the results ledger", () => {
    const may7 = loadMay7Headline();
    expect(may7.ballots_evaluated).toBe(2903);
    expect(may7.prereg_winner_accuracy).toBeLessThan(may7.live_winner_accuracy);
    expect(loadDeclarationCheckedCount()).toBeGreaterThanOrEqual(40);
  });
});

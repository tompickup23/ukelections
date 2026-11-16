import { describe, expect, it } from "vitest";
import { classifyLead, wardLead } from "../src/lib/wardMargins";

describe("ward margins", () => {
  it("measures the lead between each party's best candidate", () => {
    const lead = wardLead([
      { party_name: "Labour Party", votes: 600 },
      { party_name: "Labour Party", votes: 550 },
      { party_name: "Reform UK", votes: 400 },
    ])!;
    expect(lead.topParty).toBe("Labour");
    expect(lead.secondParty).toBe("Reform UK");
    expect(lead.leadPts).toBeCloseTo(20);
    expect(lead.closeness).toBe("commanding");
  });

  it("classes a narrow result as close", () => {
    const lead = wardLead([
      { party_name: "Reform UK", votes: 510 },
      { party_name: "Labour Party", votes: 490 },
    ])!;
    expect(lead.leadPts).toBeCloseTo(2);
    expect(lead.closeness).toBe("close");
  });

  it("never pools independents into one party", () => {
    const lead = wardLead([
      { party_name: "Independent", votes: 500 },
      { party_name: "Independent", votes: 480 },
      { party_name: "Labour Party", votes: 100 },
    ])!;
    expect(lead.topParty).toBe("Independent");
    expect(lead.secondParty).toBe("Independent");
    expect(lead.closeness).toBe("close");
  });

  it("gives no lead where one party stood, and ignores uncounted candidates", () => {
    expect(wardLead([{ party_name: "Labour Party", votes: 300 }])!.leadPts).toBeNull();
    expect(wardLead([{ party_name: "Labour Party", votes: null }])).toBeNull();
  });

  it("uses the stated class boundaries", () => {
    expect(classifyLead(4.99)).toBe("close");
    expect(classifyLead(5)).toBe("clear");
    expect(classifyLead(15)).toBe("commanding");
  });
});

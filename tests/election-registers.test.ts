import { describe, expect, it } from "vitest";
import { MODEL_FAMILIES } from "../src/lib/modelFamilies";
import { SOURCE_REGISTER } from "../src/lib/sourceRegister";

describe("election model families", () => {
  it("covers the required election types", () => {
    const ids = new Set(MODEL_FAMILIES.map((family) => family.id));

    expect(ids.has("local_fptp_borough")).toBe(true);
    expect(ids.has("local_fptp_county")).toBe(true);
    expect(ids.has("local_fptp_unitary")).toBe(true);
    expect(ids.has("westminster_fptp")).toBe(true);
    expect(ids.has("senedd_closed_list_pr")).toBe(true);
    expect(ids.has("scottish_ams")).toBe(true);
    expect(ids.has("local_stv")).toBe(true);
  });

  it("requires review gates and inputs for every model family", () => {
    for (const family of MODEL_FAMILIES) {
      expect(family.firstGate.length).toBeGreaterThan(8);
      expect(family.requiredInputs.length).toBeGreaterThanOrEqual(4);
      expect(family.geography.length).toBeGreaterThan(4);
      expect(family.votingSystem.length).toBeGreaterThan(4);
    }
  });
});

describe("source register", () => {
  it("keeps primary and internal source review visible", () => {
    expect(SOURCE_REGISTER.some((source) => source.sourceType === "primary")).toBe(true);
    expect(SOURCE_REGISTER.some((source) => source.sourceType === "internal")).toBe(true);
    expect(SOURCE_REGISTER.some((source) => source.status === "Required")).toBe(true);
    expect(SOURCE_REGISTER.some((source) => source.status === "Review")).toBe(true);
  });

  it("keeps source names unique", () => {
    const names = SOURCE_REGISTER.map((source) => source.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

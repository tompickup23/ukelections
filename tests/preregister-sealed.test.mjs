import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildManifest } from "../scripts/preregister-sealed.mjs";

const files = { "pub.json": Buffer.from("published"), "/private/sealed.json": Buffer.from("sealed"), "in.json": Buffer.from("input") };
const read = (p) => files[p];
const sha = (s) => createHash("sha256").update(Buffer.from(s)).digest("hex");

describe("sealed pre-registration manifest", () => {
  it("hashes published, sealed and input files, and never writes a sealed file's location", () => {
    const m = buildManifest({ vintage: "2027-v1", published: ["pub.json"], sealed: ["7-may-engine=/private/sealed.json"], inputs: ["in.json"], read, now: new Date("2027-01-30T12:00:00Z") });
    expect(m.published[0]).toMatchObject({ path: "pub.json", sha256: sha("published") });
    expect(m.sealed[0]).toMatchObject({ label: "7-may-engine", sha256: sha("sealed"), size_bytes: 6 });
    expect(JSON.stringify(m)).not.toContain("/private/");
    expect(m.inputs[0].sha256).toBe(sha("input"));
    expect(m.pre_registered_at).toBe("2027-01-30T12:00:00.000Z");
  });

  it("refuses a malformed vintage, an empty lock and a sealed entry without a label", () => {
    expect(() => buildManifest({ vintage: "v1", published: ["pub.json"], read })).toThrow();
    expect(() => buildManifest({ vintage: "2027-v1", read })).toThrow();
    expect(() => buildManifest({ vintage: "2027-v1", sealed: ["/private/sealed.json"], read })).toThrow();
  });
});

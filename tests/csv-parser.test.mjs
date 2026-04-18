import { describe, it, expect } from "vitest";
import { parseCsv, hashId } from "../scripts/lib/csv-parser.mjs";

describe("parseCsv", () => {
  it("parses simple CSV", () => {
    const rows = parseCsv("name,age\nAlice,30\nBob,25\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Alice", age: "30" });
    expect(rows[1]).toEqual({ name: "Bob", age: "25" });
  });

  it("handles quoted fields with commas", () => {
    const rows = parseCsv('name,desc\n"Smith, John","Has a comma"\n');
    expect(rows[0].name).toBe("Smith, John");
    expect(rows[0].desc).toBe("Has a comma");
  });

  it("handles escaped quotes (doubled)", () => {
    const rows = parseCsv('val\n"He said ""hello"""\n');
    expect(rows[0].val).toBe('He said "hello"');
  });

  it("handles carriage returns", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ a: "1", b: "2" });
  });

  it("skips empty rows", () => {
    const rows = parseCsv("a,b\n1,2\n,,\n3,4\n");
    expect(rows).toHaveLength(2);
    expect(rows[0].a).toBe("1");
    expect(rows[1].a).toBe("3");
  });

  it("handles missing trailing newline", () => {
    const rows = parseCsv("x\nfoo");
    expect(rows).toHaveLength(1);
    expect(rows[0].x).toBe("foo");
  });

  it("returns empty array for header-only CSV", () => {
    const rows = parseCsv("a,b,c\n");
    expect(rows).toHaveLength(0);
  });
});

describe("hashId", () => {
  it("produces deterministic hex string", () => {
    const h1 = hashId(["foo", "bar"]);
    const h2 = hashId(["foo", "bar"]);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(h1)).toBe(true);
  });

  it("produces different hashes for different inputs", () => {
    expect(hashId(["a"])).not.toBe(hashId(["b"]));
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importHomeOfficeLocalAuthorityAsylum } from "../scripts/lib/home-office-local-authority-asylum-importer.mjs";

function cell(value) {
  if (typeof value === "number") {
    return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`;
  }
  return `<table:table-cell office:value-type="string"><text:p>${String(value)}</text:p></table:table-cell>`;
}

function row(values) {
  return `<table:table-row>${values.map(cell).join("")}</table:table-row>`;
}

function createOds() {
  const dir = mkdtempSync(path.join(tmpdir(), "home-office-ods-"));
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:spreadsheet>
      <table:table table:name="Reg_02">
        ${row(["Reg_02: Immigration groups, by Local Authority, as at 31 December 2025"])}
        ${row([
          "Local authority",
          "Region / Nation",
          "LTLA (ONS code)",
          "Homes for Ukraine - not including super sponsors (arrivals)",
          "Afghan Resettlement Programme (total) (population)",
          "of which, Afghan Resettlement Programme - transitional (population)",
          "of which, Afghan Resettlement Programme - settled in LA housing (population)",
          "of which, Afghan Resettlement Programme - settled in PRS housing (population)",
          "Supported Asylum (total) (population)",
          "of which, Supported Asylum - Initial Accommodation (population)",
          "of which, Supported Asylum - Dispersal Accommodation (population)",
          "of which, Supported Asylum - Contingency Accommodation (population)",
          "of which, Supported Asylum - Other Accommodation (population)",
          "of which, Subsistence only (population)",
          "All 3 pathways (total)",
          "Population"
        ])}
        ${row(["Burnley", "North West", "E07000117", 100, 20, 0, 0, 0, 250, 10, 200, 30, 0, 10, 370, 90000])}
        ${row(["Summary row", "North West", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"])}
      </table:table>
    </office:spreadsheet>
  </office:body>
</office:document-content>`;
  writeFileSync(path.join(dir, "content.xml"), contentXml, "utf8");
  writeFileSync(path.join(dir, "mimetype"), "application/vnd.oasis.opendocument.spreadsheet", "utf8");
  const odsPath = path.join(dir, "regional-la.ods");
  execFileSync("zip", ["-q", odsPath, "content.xml", "mimetype"], { cwd: dir });
  return odsPath;
}

describe("Home Office local authority asylum importer", () => {
  it("imports supported asylum rows from the Reg_02 ODS sheet", () => {
    const imported = importHomeOfficeLocalAuthorityAsylum({
      odsPath: createOds(),
      sourceUrl: "https://example.test/regional-la.ods",
      generatedAt: "2026-04-22T00:00:00.000Z"
    });

    expect(imported.snapshotDate).toBe("2025-12-31");
    expect(imported.areas).toHaveLength(1);
    expect(imported.areas[0]).toMatchObject({
      areaCode: "E07000117",
      areaName: "Burnley",
      regionOrNation: "North West",
      supportedAsylum: 250,
      population: 90000,
      asylumAccommodationBreakdown: {
        initial: 10,
        dispersal: 200,
        contingency: 30,
        subsistenceOnly: 10
      }
    });
    expect(imported.areas[0].supportedAsylumRate).toBeCloseTo(27.7778);
  });
});

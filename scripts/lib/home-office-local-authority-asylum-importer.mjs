import { spawnSync } from "node:child_process";

const TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";

function decodeXml(value) {
  return String(value || "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function stripXml(value) {
  return decodeXml(String(value || "")
    .replace(/<text:s(?:\s+[^>]*)?\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function attr(attrs, name) {
  const pattern = new RegExp(`(?:^|\\s)${name}="([^"]*)"`);
  return decodeXml(attrs.match(pattern)?.[1] || "");
}

function repeatedCount(attrs, attributeName, fallback = 1) {
  const value = Number(attr(attrs, attributeName));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function cellValue(attrs, body) {
  const typedValue = attr(attrs, "office:value");
  if (typedValue !== "") return typedValue;
  return stripXml(body);
}

function extractTableXml(contentXml, sheetName) {
  const tablePattern = /<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g;
  let match;
  while ((match = tablePattern.exec(contentXml)) !== null) {
    if (attr(match[1], "table:name") === sheetName) return match[2];
  }
  throw new Error(`Sheet ${sheetName} was not found in Home Office ODS workbook`);
}

function rowsFromTableXml(tableXml) {
  const rows = [];
  const rowPattern = /<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(tableXml)) !== null) {
    const rowRepeat = repeatedCount(rowMatch[1], "table:number-rows-repeated");
    const values = [];
    const cellPattern = /<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>|<table:table-cell\b([^>]*)\/>/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[2])) !== null) {
      const attrs = cellMatch[1] || cellMatch[3] || "";
      const repeat = repeatedCount(attrs, "table:number-columns-repeated");
      const value = cellMatch[1] ? cellValue(attrs, cellMatch[2]) : "";
      for (let index = 0; index < repeat; index += 1) values.push(value);
    }
    for (let index = 0; index < rowRepeat; index += 1) rows.push(values);
  }
  return rows;
}

export function parseOdsSheetRows(filePath, sheetName) {
  const result = spawnSync("unzip", ["-p", filePath, "content.xml"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`Unable to read ODS content.xml from ${filePath}: ${result.stderr || result.stdout}`);
  }
  return rowsFromTableXml(extractTableXml(result.stdout, sheetName));
}

function indexByHeader(headerRow) {
  return new Map(headerRow.map((name, index) => [String(name || "").trim(), index]));
}

function numeric(value) {
  if (value === "-" || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function parseSnapshotDate(title) {
  const match = String(title || "").match(/as at (\d{1,2}) ([A-Za-z]+) (\d{4})/i);
  if (!match) return null;
  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12"
  };
  const month = months[match[2].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${String(match[1]).padStart(2, "0")}`;
}

function requireColumn(header, name) {
  const index = header.get(name);
  if (!Number.isInteger(index)) throw new Error(`Home Office Reg_02 sheet is missing column: ${name}`);
  return index;
}

export function importHomeOfficeLocalAuthorityAsylum({ odsPath, sourceUrl = null, generatedAt = new Date().toISOString() }) {
  const rows = parseOdsSheetRows(odsPath, "Reg_02");
  const title = rows[0]?.[0] || "";
  const headerIndex = rows.findIndex((row) => row.includes("Local authority") && row.includes("LTLA (ONS code)"));
  if (headerIndex < 0) throw new Error("Home Office Reg_02 sheet header row was not found");
  const header = indexByHeader(rows[headerIndex]);
  const columns = {
    areaName: requireColumn(header, "Local authority"),
    region: requireColumn(header, "Region / Nation"),
    areaCode: requireColumn(header, "LTLA (ONS code)"),
    homesForUkraine: requireColumn(header, "Homes for Ukraine - not including super sponsors (arrivals)"),
    afghanResettlement: requireColumn(header, "Afghan Resettlement Programme (total) (population)"),
    supportedAsylum: requireColumn(header, "Supported Asylum (total) (population)"),
    initialAccommodation: requireColumn(header, "of which, Supported Asylum - Initial Accommodation (population)"),
    dispersalAccommodation: requireColumn(header, "of which, Supported Asylum - Dispersal Accommodation (population)"),
    contingencyAccommodation: requireColumn(header, "of which, Supported Asylum - Contingency Accommodation (population)"),
    otherAccommodation: requireColumn(header, "of which, Supported Asylum - Other Accommodation (population)"),
    subsistenceOnly: requireColumn(header, "of which, Subsistence only (population)"),
    allPathways: requireColumn(header, "All 3 pathways (total)"),
    population: requireColumn(header, "Population")
  };
  const snapshotDate = parseSnapshotDate(title);
  const areas = rows.slice(headerIndex + 1)
    .map((row) => {
      const areaCode = String(row[columns.areaCode] || "").trim();
      const population = numeric(row[columns.population]);
      const supportedAsylum = numeric(row[columns.supportedAsylum]);
      if (!/^[ENSW]\d{8}$/.test(areaCode) || supportedAsylum === null) return null;
      return {
        areaCode,
        areaName: String(row[columns.areaName] || "").trim(),
        regionOrNation: String(row[columns.region] || "").trim(),
        supportedAsylum,
        supportedAsylumRate: population && population > 0 ? (supportedAsylum / population) * 10000 : null,
        population,
        snapshotDate,
        homesForUkraine: numeric(row[columns.homesForUkraine]),
        afghanResettlement: numeric(row[columns.afghanResettlement]),
        asylumAccommodationBreakdown: {
          initial: numeric(row[columns.initialAccommodation]),
          dispersal: numeric(row[columns.dispersalAccommodation]),
          contingency: numeric(row[columns.contingencyAccommodation]),
          other: numeric(row[columns.otherAccommodation]),
          subsistenceOnly: numeric(row[columns.subsistenceOnly])
        },
        allPathways: numeric(row[columns.allPathways])
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.areaCode.localeCompare(right.areaCode));

  return {
    generatedAt,
    snapshotDate,
    source: {
      name: "Home Office immigration statistics regional and local authority data",
      sourceUrl,
      workbook: odsPath,
      sheet: "Reg_02",
      title
    },
    routeMetricFamilies: {
      supportedAsylum: "Quarter-end supported asylum population by local authority",
      homesForUkraine: "Homes for Ukraine arrivals by local authority",
      afghanResettlement: "Afghan Resettlement Programme population by local authority"
    },
    areas
  };
}

export { TABLE_NS };

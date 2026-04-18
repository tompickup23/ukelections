import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import xlsx from "xlsx";
import { fileSha256, readCsv } from "../lib/csv-parser.mjs";

const inputPaths = {
  nwrsmpMedia: path.resolve("data/raw/regional_sources/nwrsmp-media.json"),
  nwrsmpPage: path.resolve("data/raw/regional_sources/nwrsmp-data-page.json"),
  watchlist: path.resolve("data/manual/regional-source-watch.csv"),
  localRouteLatest: path.resolve("src/data/live/local-route-latest.json"),
  migrationYorkshireStatistics: path.resolve("data/raw/regional_sources/migration-yorkshire-statistics.html"),
  migrationYorkshireRefugeeDashboard: path.resolve(
    "data/raw/regional_sources/migration-yorkshire-refugee-dashboard.html"
  ),
  migrationYorkshireUkraineDashboard: path.resolve(
    "data/raw/regional_sources/migration-yorkshire-ukraine-dashboard.html"
  ),
  migrationYorkshireEussDashboard: path.resolve(
    "data/raw/regional_sources/migration-yorkshire-euss-dashboard.html"
  ),
  nempDataPage: path.resolve("data/raw/regional_sources/nemp-data-page.html"),
  wsmpDataObservatory: path.resolve("data/raw/regional_sources/wsmp-dataobservatory.html"),
  migrationObservatoryLocalGuide: path.resolve(
    "data/raw/regional_sources/migration-observatory-local-data-guide.html"
  )
};

const rawWorkbookDir = path.resolve("data/raw/regional_sources");
const canonicalDir = path.resolve("data/canonical/regional_sources");
const liveDir = path.resolve("src/data/live");

function ensureCleanDir(directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeNdjson(filePath, rows) {
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#038;", "&")
    .replaceAll("&#8211;", "-")
    .replaceAll("&#8217;", "'")
    .replaceAll("&#8220;", "\"")
    .replaceAll("&#8221;", "\"")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"");
}

function stripHtml(value) {
  return decodeEntities(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function cleanText(value) {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  const text = cleanText(value);
  return text.length > 0 ? text : null;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function splitPipeList(value) {
  return String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function priorityWeight(priority) {
  switch (priority) {
    case "high":
      return 0;
    case "medium":
      return 1;
    default:
      return 2;
  }
}

function sortByPriorityAndOrganisation(left, right) {
  return (
    priorityWeight(left.historicPriority) - priorityWeight(right.historicPriority) ||
    left.organisation.localeCompare(right.organisation)
  );
}

function extractParagraphs(html) {
  return [...String(html ?? "").matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
}

function dedupeBy(rows, getKey) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = getKey(row);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildWatchEntries(rows, group, defaultPriority = "medium") {
  return rows
    .filter((row) => row.group === group)
    .map((row) => ({
      entryId: row.entry_id,
      organisation: row.organisation,
      regionName: row.region_name,
      coverage: row.coverage,
      currentUrl: row.current_url,
      historicUrl: row.historic_url,
      historicPriority: row.historic_priority || defaultPriority,
      formats: splitPipeList(row.formats),
      routeFocus: splitPipeList(row.route_focus),
      recommendedUse: row.recommended_use,
      notes: row.notes
    }))
    .sort(sortByPriorityAndOrganisation);
}

function parseNumber(value) {
  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();
  if (!normalized || normalized === "-" || normalized.toLowerCase() === "n/a") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readSheetMatrix(filePath, sheetName) {
  const workbook = xlsx.readFile(filePath, { raw: false });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }

  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: ""
  });
}

function findHeaderRowIndex(rows, requiredHeaders) {
  return rows.findIndex((row) => {
    const headers = new Set(row.map((cell) => normalizeHeader(cell)));
    return requiredHeaders.every((header) => headers.has(header));
  });
}

function rowToObject(headerRow, row) {
  return Object.fromEntries(
    headerRow.map((header, index) => [normalizeHeader(header), row[index] ?? ""])
  );
}

function parseLongDate(value) {
  const match = /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/.exec(String(value).trim());
  if (!match) {
    return null;
  }

  const parsed = new Date(`${match[1]} ${match[2]} ${match[3]} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseSlashDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(value).trim());
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10);
}

function parseIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()) ? String(value).trim() : null;
}

function parseWorkbookDate(value) {
  return parseIsoDate(value) ?? parseSlashDate(value) ?? parseLongDate(value);
}

function formatIsoDate(value) {
  if (!value) {
    return null;
  }

  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractTitle(html) {
  const ogMatch = String(html).match(/<meta property="og:title" content="([^"]+)"/i);
  if (ogMatch?.[1]) {
    return cleanText(ogMatch[1]);
  }

  const titleMatch = String(html).match(/<title>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1] ? cleanText(titleMatch[1]) : null;
}

function extractAnchorLinks(html, baseUrl) {
  const links = [];

  for (const match of String(html).matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[2] ?? "").trim();
    const label = cleanText(match[3] ?? "");
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      continue;
    }

    try {
      links.push({
        label: label || href,
        url: new URL(href, baseUrl).toString()
      });
    } catch {
      continue;
    }
  }

  return dedupeBy(links, (row) => `${row.label}|${row.url}`);
}

function extractPowerBiUrls(html) {
  return dedupeBy(
    [...String(html).matchAll(/https:\/\/app\.powerbi\.com\/view\?r=[^"'&\s<]+/gi)].map((match) => ({
      url: decodeEntities(match[0])
    })),
    (row) => row.url
  ).map((row) => row.url);
}

function pickLink(links, predicate) {
  return links.find((link) => predicate(link.label, link.url)) ?? null;
}

function buildAssetRow({
  organisation,
  regionName,
  pageTitle,
  pageUrl,
  assetTitle,
  assetUrl,
  assetType,
  routeFocus,
  notes
}) {
  return {
    assetId: `regional_asset_${slugify([organisation, assetTitle, assetType].join("_"))}`,
    organisation,
    regionName,
    pageTitle,
    pageUrl,
    assetTitle,
    assetUrl,
    assetType,
    routeFocus,
    notes
  };
}

function extractSnapshotDateHint(rowsBeforeHeader) {
  const combinedText = rowsBeforeHeader
    .flat()
    .map((value) => cleanText(value))
    .join(" ");
  const match = /as at (\d{1,2} [A-Za-z]+ \d{4})/i.exec(combinedText);
  return match ? parseLongDate(match[1]) : null;
}

function buildWorkbookFileName(document, dateCounts) {
  const publishedAt = String(document.publishedAt || "undated").slice(0, 10);
  const suffix = dateCounts.get(publishedAt) > 1 ? `-${document.id}` : "";
  return `nwrsmp-workbook-${publishedAt}${suffix}.xlsx`;
}

function parseSupportedSheet(document, filePath) {
  const rows = readSheetMatrix(filePath, "Supported");
  const headerRowIndex = findHeaderRowIndex(rows, [
    "supporttype",
    "ukregion",
    "localauthority",
    "ladcode",
    "accommodationtype"
  ]);

  if (headerRowIndex === -1) {
    return [];
  }

  const headerRow = rows[headerRowIndex];
  const groupedRows = new Map();

  for (const row of rows.slice(headerRowIndex + 1)) {
    const record = rowToObject(headerRow, row);
    const areaCode = normalizeText(record.ladcode);
    const areaName = normalizeText(record.localauthority);
    const regionName = normalizeText(record.ukregion);
    const periodEnd = parseWorkbookDate(record.date ?? record.dateasat);
    const value = parseNumber(record.people ?? record.value);

    if (!areaCode || !areaName || !regionName || !periodEnd || value === null) {
      continue;
    }

    const groupKey = `${areaCode}|${periodEnd}`;
    if (!groupedRows.has(groupKey)) {
      groupedRows.set(groupKey, {
        areaCode,
        areaName,
        regionName,
        periodEnd,
        value: 0,
        sourceWorkbookTitle: document.title,
        sourceWorkbookPublishedAt: document.publishedAt,
        sourceWorkbookUrl: document.sourceUrl
      });
    }

    groupedRows.get(groupKey).value += value;
  }

  return [...groupedRows.values()].sort(
    (left, right) =>
      left.areaCode.localeCompare(right.areaCode) || left.periodEnd.localeCompare(right.periodEnd)
  );
}

function parseLatestGroupsSheet(document, filePath) {
  const rows = readSheetMatrix(filePath, "Latest Groups");
  const headerRowIndex = findHeaderRowIndex(rows, [
    "localauthority",
    "regionnation",
    "ltlaonscode"
  ]);

  if (headerRowIndex === -1) {
    return [];
  }

  const headerRow = rows[headerRowIndex];
  const snapshotDateHint = extractSnapshotDateHint(rows.slice(0, headerRowIndex));

  return rows
    .slice(headerRowIndex + 1)
    .map((row) => rowToObject(headerRow, row))
    .map((record) => ({
      areaCode: normalizeText(record.ltlaonscode),
      areaName: normalizeText(record.localauthority),
      regionName: normalizeText(record.regionnation),
      snapshotDateHint,
      supportedAsylum: parseNumber(record.supportedasylumtotalpopulation),
      contingencyAccommodation: parseNumber(
        record.ofwhichsupportedasylumcontingencyaccommodationpopulation
      ),
      dispersalAccommodation: parseNumber(
        record.ofwhichsupportedasylumdispersalaccommodationpopulation
      ),
      subsistenceOnly: parseNumber(record.ofwhichsubsistenceonlypopulation),
      allThreePathwaysTotal: parseNumber(record.all3pathwaystotal),
      population: parseNumber(record.population),
      shareOfPopulationPct: parseNumber(record.percentageofpopulation),
      sourceWorkbookTitle: document.title,
      sourceWorkbookPublishedAt: document.publishedAt,
      sourceWorkbookUrl: document.sourceUrl
    }))
    .filter((record) => record.areaCode && record.areaName && record.regionName);
}

function parseAuthoritySheet(document, filePath) {
  const rows = readSheetMatrix(filePath, "North West Authorities");
  const headerRowIndex = findHeaderRowIndex(rows, [
    "uppertierauthority",
    "utlacode",
    "measuretype",
    "attribute",
    "value"
  ]);

  if (headerRowIndex === -1) {
    return [];
  }

  const headerRow = rows[headerRowIndex];

  return rows
    .slice(headerRowIndex + 1)
    .map((row) => rowToObject(headerRow, row))
    .map((record) => ({
      areaCode: normalizeText(record.utlacode),
      areaName: normalizeText(record.uppertierauthority),
      authorityType: normalizeText(record.authoritytype),
      measureType: normalizeText(record.measuretype),
      attribute: normalizeText(record.attribute),
      value: parseNumber(record.value),
      proRataBasis: normalizeText(record.proratabasis),
      sourceWorkbookTitle: document.title,
      sourceWorkbookPublishedAt: document.publishedAt,
      sourceWorkbookUrl: document.sourceUrl
    }))
    .filter((record) => record.areaCode && record.areaName && record.attribute && record.value !== null);
}

function pickPreferredRows(rows, getKey) {
  const preferred = new Map();

  for (const row of [...rows].sort((left, right) => {
    const dateDelta = String(right.sourceWorkbookPublishedAt).localeCompare(String(left.sourceWorkbookPublishedAt));
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return String(left.sourceWorkbookTitle).localeCompare(String(right.sourceWorkbookTitle));
  })) {
    const key = getKey(row);
    if (!preferred.has(key)) {
      preferred.set(key, row);
    }
  }

  return [...preferred.values()];
}

ensureCleanDir(canonicalDir);
mkdirSync(liveDir, { recursive: true });

const nwrsmpMedia = readJson(inputPaths.nwrsmpMedia);
const [nwrsmpPage] = readJson(inputPaths.nwrsmpPage);
const watchlistRows = readCsv(inputPaths.watchlist);
const localRouteLatest = readJson(inputPaths.localRouteLatest);

const currentAreaMap = new Map(localRouteLatest.areas.map((area) => [area.areaCode, area]));

const nwrsmpParagraphs = extractParagraphs(nwrsmpPage?.content?.rendered ?? "");
const meaningfulNwrsmpParagraphs = nwrsmpParagraphs.filter(
  (paragraph) => paragraph.length > 20 && paragraph.toLowerCase() !== "home"
);
const dashboardMatch = String(nwrsmpPage?.content?.rendered ?? "").match(/<param name="name" value="([^"]+)"/i);
const dashboardPath = dashboardMatch?.[1] ?? null;
const dashboardUrl = dashboardPath ? `https://public.tableau.com/views/${dashboardPath}?:showVizHome=no` : null;

const nwrsmpDocumentsBase = dedupeBy(
  nwrsmpMedia
    .filter(
      (item) =>
        item?.mime_type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
        /north west public accessible/i.test(cleanText(item?.title?.rendered))
    )
    .map((item) => ({
      id: item.id,
      title: cleanText(item.title?.rendered),
      publishedAt: String(item.date_gmt || item.date || "").slice(0, 10),
      sourceUrl: item.source_url,
      fileSizeBytes: item.media_details?.filesize ?? null,
      format: "xlsx"
    }))
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || left.title.localeCompare(right.title)),
  (row) => `${row.title}|${row.fileSizeBytes ?? "na"}`
);

const dateCounts = new Map();
for (const document of nwrsmpDocumentsBase) {
  const key = document.publishedAt || "undated";
  dateCounts.set(key, (dateCounts.get(key) ?? 0) + 1);
}

const nwrsmpDocuments = nwrsmpDocumentsBase.map((document) => ({
  ...document,
  localFileName: buildWorkbookFileName(document, dateCounts)
}));

for (const document of nwrsmpDocuments) {
  const filePath = path.join(rawWorkbookDir, document.localFileName);
  if (!existsSync(filePath)) {
    throw new Error(`Missing expected workbook file: ${document.localFileName}`);
  }
}

const regionalPartners = buildWatchEntries(watchlistRows, "regional_partner", "medium");
const similarOrganisations = buildWatchEntries(watchlistRows, "similar_organisation", "medium");
const archiveTools = buildWatchEntries(watchlistRows, "archive_tool", "high");
const archivedResearchInputs = buildWatchEntries(watchlistRows, "archived_research_input", "high");

const migrationYorkshireStatisticsHtml = readText(inputPaths.migrationYorkshireStatistics);
const migrationYorkshireRefugeeDashboardHtml = readText(inputPaths.migrationYorkshireRefugeeDashboard);
const migrationYorkshireUkraineDashboardHtml = readText(inputPaths.migrationYorkshireUkraineDashboard);
const migrationYorkshireEussDashboardHtml = readText(inputPaths.migrationYorkshireEussDashboard);
const nempDataPageHtml = readText(inputPaths.nempDataPage);
const wsmpDataObservatoryHtml = readText(inputPaths.wsmpDataObservatory);
const migrationObservatoryLocalGuideHtml = readText(inputPaths.migrationObservatoryLocalGuide);

const migrationYorkshireStatisticsUrl = "https://www.migrationyorkshire.org.uk/statistics";
const migrationYorkshireRefugeeDashboardUrl =
  "https://www.migrationyorkshire.org.uk/statistics/refugee-and-asylum-seeker-dashboard";
const migrationYorkshireUkraineDashboardUrl =
  "https://www.migrationyorkshire.org.uk/statistics/ukraine-data-dashboard";
const migrationYorkshireEussDashboardUrl =
  "https://www.migrationyorkshire.org.uk/statistics/european-union-settlement-scheme-dashboard";
const nempDataPageUrl = "https://www.nemp.org.uk/data/";
const wsmpDataObservatoryUrl = "https://www.wsmp.wales/dataobservatory";
const migrationObservatoryLocalGuideUrl =
  "https://migrationobservatory.ox.ac.uk/projects/local-data-guide/";

const nempDataPageLinks = extractAnchorLinks(nempDataPageHtml, nempDataPageUrl);
const wsmpDataObservatoryLinks = extractAnchorLinks(wsmpDataObservatoryHtml, wsmpDataObservatoryUrl);
const migrationObservatoryGuideLinksRaw = extractAnchorLinks(
  migrationObservatoryLocalGuideHtml,
  migrationObservatoryLocalGuideUrl
);

const regionalPartnerAssets = dedupeBy(
  [
    buildAssetRow({
      organisation: "Migration Yorkshire",
      regionName: "Yorkshire and the Humber",
      pageTitle: extractTitle(migrationYorkshireStatisticsHtml) ?? "Statistics",
      pageUrl: migrationYorkshireStatisticsUrl,
      assetTitle: "Statistics hub",
      assetUrl: migrationYorkshireStatisticsUrl,
      assetType: "hub_page",
      routeFocus: ["asylum", "refugees", "ukraine", "migration"],
      notes: "Regional entry page linking out to Migration Yorkshire dashboards and local data explainers."
    }),
    buildAssetRow({
      organisation: "Migration Yorkshire",
      regionName: "Yorkshire and the Humber",
      pageTitle: extractTitle(migrationYorkshireRefugeeDashboardHtml) ?? "Refugee and asylum seeker dashboard",
      pageUrl: migrationYorkshireRefugeeDashboardUrl,
      assetTitle: "Refugee and asylum seeker dashboard page",
      assetUrl: migrationYorkshireRefugeeDashboardUrl,
      assetType: "dashboard_page",
      routeFocus: ["asylum", "refugees"],
      notes: "Explainer page for the Yorkshire and Humber refugee and asylum local dashboard."
    }),
    ...extractPowerBiUrls(migrationYorkshireRefugeeDashboardHtml).map((assetUrl) =>
      buildAssetRow({
        organisation: "Migration Yorkshire",
        regionName: "Yorkshire and the Humber",
        pageTitle: extractTitle(migrationYorkshireRefugeeDashboardHtml) ?? "Refugee and asylum seeker dashboard",
        pageUrl: migrationYorkshireRefugeeDashboardUrl,
        assetTitle: "Refugee and asylum seeker Power BI dashboard",
        assetUrl,
        assetType: "dashboard_embed",
        routeFocus: ["asylum", "refugees"],
        notes: "Direct Power BI view extracted from the Migration Yorkshire dashboard page."
      })
    ),
    buildAssetRow({
      organisation: "Migration Yorkshire",
      regionName: "Yorkshire and the Humber",
      pageTitle: extractTitle(migrationYorkshireUkraineDashboardHtml) ?? "Ukraine data dashboard",
      pageUrl: migrationYorkshireUkraineDashboardUrl,
      assetTitle: "Ukraine data dashboard page",
      assetUrl: migrationYorkshireUkraineDashboardUrl,
      assetType: "dashboard_page",
      routeFocus: ["ukraine", "refugees"],
      notes: "Migration Yorkshire humanitarian-route dashboard page for the Ukraine scheme."
    }),
    ...extractPowerBiUrls(migrationYorkshireUkraineDashboardHtml).map((assetUrl) =>
      buildAssetRow({
        organisation: "Migration Yorkshire",
        regionName: "Yorkshire and the Humber",
        pageTitle: extractTitle(migrationYorkshireUkraineDashboardHtml) ?? "Ukraine data dashboard",
        pageUrl: migrationYorkshireUkraineDashboardUrl,
        assetTitle: "Ukraine Power BI dashboard",
        assetUrl,
        assetType: "dashboard_embed",
        routeFocus: ["ukraine", "refugees"],
        notes: "Direct Power BI view extracted from the Migration Yorkshire Ukraine dashboard page."
      })
    ),
    buildAssetRow({
      organisation: "Migration Yorkshire",
      regionName: "Yorkshire and the Humber",
      pageTitle: extractTitle(migrationYorkshireEussDashboardHtml) ?? "European Union Settlement Scheme dashboard",
      pageUrl: migrationYorkshireEussDashboardUrl,
      assetTitle: "European Union Settlement Scheme dashboard page",
      assetUrl: migrationYorkshireEussDashboardUrl,
      assetType: "dashboard_page",
      routeFocus: ["migration"],
      notes: "Migration Yorkshire settlement dashboard page for EUSS local data."
    }),
    ...extractPowerBiUrls(migrationYorkshireEussDashboardHtml).map((assetUrl) =>
      buildAssetRow({
        organisation: "Migration Yorkshire",
        regionName: "Yorkshire and the Humber",
        pageTitle: extractTitle(migrationYorkshireEussDashboardHtml) ?? "European Union Settlement Scheme dashboard",
        pageUrl: migrationYorkshireEussDashboardUrl,
        assetTitle: "European Union Settlement Scheme Power BI dashboard",
        assetUrl,
        assetType: "dashboard_embed",
        routeFocus: ["migration"],
        notes: "Direct Power BI view extracted from the Migration Yorkshire EUSS dashboard page."
      })
    ),
    buildAssetRow({
      organisation: "North East Migration Partnership",
      regionName: "North East England",
      pageTitle: extractTitle(nempDataPageHtml) ?? "Data",
      pageUrl: nempDataPageUrl,
      assetTitle: "NEMP data page",
      assetUrl: nempDataPageUrl,
      assetType: "hub_page",
      routeFocus: ["asylum", "refugees", "ukraine", "migration"],
      notes: "Regional data landing page for the North East partnership."
    }),
    ...extractPowerBiUrls(nempDataPageHtml).map((assetUrl) =>
      buildAssetRow({
        organisation: "North East Migration Partnership",
        regionName: "North East England",
        pageTitle: extractTitle(nempDataPageHtml) ?? "Data",
        pageUrl: nempDataPageUrl,
        assetTitle: "North East regional Power BI dashboard",
        assetUrl,
        assetType: "dashboard_embed",
        routeFocus: ["asylum", "refugees", "ukraine", "migration"],
        notes: "Direct Power BI dashboard extracted from the NEMP data page."
      })
    ),
    ...[
      pickLink(
        nempDataPageLinks,
        (label, url) =>
          label.includes("Asylum data") && url.includes("asylum-and-resettlement-datasets#local-authority-data")
      ),
      pickLink(
        nempDataPageLinks,
        (label, url) => label.includes("Regional and local authority data on immigration groups") && url.includes("immigration-system-statistics-regional-and-local-authority-data")
      ),
      pickLink(
        nempDataPageLinks,
        (label, url) => label.includes("RASI") && url.includes("rasi-resettlement-asylum-support-and-integration-data")
      )
    ]
      .filter((link) => link !== null)
      .map((link) =>
        buildAssetRow({
          organisation: "North East Migration Partnership",
          regionName: "North East England",
          pageTitle: extractTitle(nempDataPageHtml) ?? "Data",
          pageUrl: nempDataPageUrl,
          assetTitle: link.label,
          assetUrl: link.url,
          assetType: "official_source_link",
          routeFocus:
            link.label.includes("RASI")
              ? ["asylum", "refugees", "integration"]
              : link.label.includes("immigration groups")
                ? ["asylum", "ukraine", "refugees", "migration"]
                : ["asylum", "refugees"],
          notes: "Official dataset or publication link exposed directly from the NEMP regional data page."
        })
      ),
    buildAssetRow({
      organisation: "Wales Strategic Migration Partnership",
      regionName: "Wales",
      pageTitle: extractTitle(wsmpDataObservatoryHtml) ?? "Data observatory",
      pageUrl: wsmpDataObservatoryUrl,
      assetTitle: "WSMP data observatory",
      assetUrl: wsmpDataObservatoryUrl,
      assetType: "hub_page",
      routeFocus: ["asylum", "refugees", "ukraine", "migration"],
      notes: "Welsh strategic migration partnership data-observatory landing page."
    }),
    ...[
      pickLink(wsmpDataObservatoryLinks, (_label, url) => url === "https://www.data.cymru/eng/")
    ]
      .filter((link) => link !== null)
      .map((link) =>
        buildAssetRow({
          organisation: "Wales Strategic Migration Partnership",
          regionName: "Wales",
          pageTitle: extractTitle(wsmpDataObservatoryHtml) ?? "Data observatory",
          pageUrl: wsmpDataObservatoryUrl,
          assetTitle: "Data Cymru",
          assetUrl: link.url,
          assetType: "data_partner",
          routeFocus: ["migration"],
          notes: "Linked Welsh data partner surfaced from the WSMP observatory page."
        })
      )
  ],
  (row) => `${row.organisation}|${row.assetTitle}|${row.assetUrl}`
).sort((left, right) => left.organisation.localeCompare(right.organisation) || left.assetTitle.localeCompare(right.assetTitle));

const migrationObservatoryGuideLinks = dedupeBy(
  [
    pickLink(
      migrationObservatoryGuideLinksRaw,
      (label, url) =>
        label.includes("Local Area Migration Indicators suite") &&
        url.includes("localareamigrationindicatorsunitedkingdom")
    ) &&
      buildAssetRow({
        organisation: "Migration Observatory",
        regionName: "United Kingdom",
        pageTitle: extractTitle(migrationObservatoryLocalGuideHtml) ?? "Local data guide",
        pageUrl: migrationObservatoryLocalGuideUrl,
        assetTitle: "Local Area Migration Indicators suite",
        assetUrl:
          pickLink(
            migrationObservatoryGuideLinksRaw,
            (label, url) =>
              label.includes("Local Area Migration Indicators suite") &&
              url.includes("localareamigrationindicatorsunitedkingdom")
          )?.url ?? migrationObservatoryLocalGuideUrl,
        assetType: "official_source_link",
        routeFocus: ["migration"],
        notes: "ONS local-area migration indicators traced from the Migration Observatory guide."
      }),
    pickLink(
      migrationObservatoryGuideLinksRaw,
      (label, url) =>
        label.includes("Asylum and refugee resettlement in the UK") &&
        url.includes("migration-to-the-uk-asylum")
    ) &&
      buildAssetRow({
        organisation: "Migration Observatory",
        regionName: "United Kingdom",
        pageTitle: extractTitle(migrationObservatoryLocalGuideHtml) ?? "Local data guide",
        pageUrl: migrationObservatoryLocalGuideUrl,
        assetTitle: "Asylum and refugee resettlement in the UK",
        assetUrl:
          pickLink(
            migrationObservatoryGuideLinksRaw,
            (label, url) =>
              label.includes("Asylum and refugee resettlement in the UK") &&
              url.includes("migration-to-the-uk-asylum")
          )?.url ?? migrationObservatoryLocalGuideUrl,
        assetType: "briefing_link",
        routeFocus: ["asylum", "refugees"],
        notes: "Migration Observatory briefing linked from the local data guide asylum section."
      }),
    pickLink(
      migrationObservatoryGuideLinksRaw,
      (label, url) =>
        label.includes("Download the source data in this chart from the Home Office") &&
        url.includes("asylum-and-resettlement-datasets#local-authority-data")
    ) &&
      buildAssetRow({
        organisation: "Migration Observatory",
        regionName: "United Kingdom",
        pageTitle: extractTitle(migrationObservatoryLocalGuideHtml) ?? "Local data guide",
        pageUrl: migrationObservatoryLocalGuideUrl,
        assetTitle: "Home Office local-authority asylum and resettlement data",
        assetUrl:
          pickLink(
            migrationObservatoryGuideLinksRaw,
            (label, url) =>
              label.includes("Download the source data in this chart from the Home Office") &&
              url.includes("asylum-and-resettlement-datasets#local-authority-data")
          )?.url ?? migrationObservatoryLocalGuideUrl,
        assetType: "official_source_link",
        routeFocus: ["asylum", "refugees"],
        notes: "Local-authority asylum and resettlement source table linked out from the guide."
      }),
    pickLink(
      migrationObservatoryGuideLinksRaw,
      (label, url) =>
        label.includes("Download the source data in this chart from the Department for Education") &&
        url.includes("children-looked-after")
    ) &&
      buildAssetRow({
        organisation: "Migration Observatory",
        regionName: "United Kingdom",
        pageTitle: extractTitle(migrationObservatoryLocalGuideHtml) ?? "Local data guide",
        pageUrl: migrationObservatoryLocalGuideUrl,
        assetTitle: "Department for Education UASC source table",
        assetUrl:
          pickLink(
            migrationObservatoryGuideLinksRaw,
            (label, url) =>
              label.includes("Download the source data in this chart from the Department for Education") &&
              url.includes("children-looked-after")
          )?.url ?? migrationObservatoryLocalGuideUrl,
        assetType: "official_source_link",
        routeFocus: ["asylum", "children"],
        notes: "UASC local-authority source table linked from the guide."
      }),
    pickLink(
      migrationObservatoryGuideLinksRaw,
      (label, url) =>
        label.includes("Download the source data in this chart from ONS") &&
        url.includes("localareamigrationindicatorsunitedkingdom")
    ) &&
      buildAssetRow({
        organisation: "Migration Observatory",
        regionName: "United Kingdom",
        pageTitle: extractTitle(migrationObservatoryLocalGuideHtml) ?? "Local data guide",
        pageUrl: migrationObservatoryLocalGuideUrl,
        assetTitle: "ONS local-area migration indicators source data",
        assetUrl:
          pickLink(
            migrationObservatoryGuideLinksRaw,
            (label, url) =>
              label.includes("Download the source data in this chart from ONS") &&
              url.includes("localareamigrationindicatorsunitedkingdom")
          )?.url ?? migrationObservatoryLocalGuideUrl,
        assetType: "official_source_link",
        routeFocus: ["migration"],
        notes: "Direct ONS source-data link surfaced from the guide."
      })
  ].filter(Boolean),
  (row) => row.assetUrl
).sort((left, right) => left.assetTitle.localeCompare(right.assetTitle));

const workbookExtractions = nwrsmpDocuments.map((document) => {
  const filePath = path.join(rawWorkbookDir, document.localFileName);
  return {
    document,
    authorityRows: parseAuthoritySheet(document, filePath),
    latestGroupRows: parseLatestGroupsSheet(document, filePath),
    supportedRows: parseSupportedSheet(document, filePath)
  };
});

const authorityObservationRows = workbookExtractions
  .flatMap((workbook) => workbook.authorityRows)
  .sort(
    (left, right) =>
      left.areaCode.localeCompare(right.areaCode) ||
      left.attribute.localeCompare(right.attribute) ||
      String(left.sourceWorkbookPublishedAt).localeCompare(String(right.sourceWorkbookPublishedAt))
  );

const latestGroupRows = workbookExtractions
  .flatMap((workbook) => workbook.latestGroupRows)
  .sort(
    (left, right) =>
      left.areaCode.localeCompare(right.areaCode) ||
      String(left.sourceWorkbookPublishedAt).localeCompare(String(right.sourceWorkbookPublishedAt))
  );

const supportedSeriesRows = workbookExtractions
  .flatMap((workbook) => workbook.supportedRows)
  .sort(
    (left, right) =>
      left.areaCode.localeCompare(right.areaCode) ||
      left.periodEnd.localeCompare(right.periodEnd) ||
      String(left.sourceWorkbookPublishedAt).localeCompare(String(right.sourceWorkbookPublishedAt))
  );

const preferredSupportedSeriesRows = pickPreferredRows(
  supportedSeriesRows,
  (row) => `${row.areaCode}|${row.periodEnd}`
).sort(
  (left, right) =>
    left.areaCode.localeCompare(right.areaCode) || left.periodEnd.localeCompare(right.periodEnd)
);

const liveAreaSeries = preferredSupportedSeriesRows
  .filter((row) => currentAreaMap.has(row.areaCode))
  .map((row) => ({
    areaCode: row.areaCode,
    areaName: currentAreaMap.get(row.areaCode)?.areaName ?? row.areaName,
    periodEnd: row.periodEnd,
    value: row.value,
    dataStatus: "official_anchor"
  }))
  .sort((left, right) => left.areaCode.localeCompare(right.areaCode) || left.periodEnd.localeCompare(right.periodEnd));

const liveSeriesAreaCount = new Set(liveAreaSeries.map((row) => row.areaCode)).size;
const liveSeriesPointCount = liveAreaSeries.length;
const liveSeriesFirstPeriod =
  [...new Set(liveAreaSeries.map((row) => row.periodEnd))].sort((left, right) => left.localeCompare(right))[0] ??
  null;
const liveSeriesLatestPeriod =
  [...new Set(liveAreaSeries.map((row) => row.periodEnd))].sort((left, right) => right.localeCompare(left))[0] ??
  null;

const contributorCounts = new Map();
for (const row of preferredSupportedSeriesRows) {
  const key = row.sourceWorkbookUrl;
  if (!contributorCounts.has(key)) {
    contributorCounts.set(key, {
      sourceWorkbookTitle: row.sourceWorkbookTitle,
      sourceWorkbookPublishedAt: row.sourceWorkbookPublishedAt,
      sourceWorkbookUrl: row.sourceWorkbookUrl,
      contributionCount: 0
    });
  }
  contributorCounts.get(key).contributionCount += 1;
}

const primarySeriesContributor =
  [...contributorCounts.values()].sort(
    (left, right) =>
      right.contributionCount - left.contributionCount ||
      String(right.sourceWorkbookPublishedAt).localeCompare(String(left.sourceWorkbookPublishedAt))
  )[0] ?? null;

const latestLatestGroupsWorkbook =
  [...latestGroupRows].sort(
    (left, right) => String(right.sourceWorkbookPublishedAt).localeCompare(String(left.sourceWorkbookPublishedAt))
  )[0] ?? null;
const latestAuthorityWorkbook =
  [...authorityObservationRows].sort(
    (left, right) => String(right.sourceWorkbookPublishedAt).localeCompare(String(left.sourceWorkbookPublishedAt))
  )[0] ?? null;

const liveOutput = {
  summary: {
    regionalPartnerCount: regionalPartners.length,
    similarOrganisationCount: similarOrganisations.length,
    archiveToolCount: archiveTools.length,
    archivedResearchInputCount: archivedResearchInputs.length,
    regionalPartnerAssetCount: regionalPartnerAssets.length,
    regionalPartnerDashboardCount: regionalPartnerAssets.filter((row) => row.assetType.includes("dashboard")).length,
    migrationObservatoryGuideLinkCount: migrationObservatoryGuideLinks.length,
    nwrsmpWorkbookCount: nwrsmpDocuments.length,
    nwrsmpHistoricWorkbookCount: Math.max(0, nwrsmpDocuments.length - 1),
    nwrsmpAuthorityObservationCount: authorityObservationRows.length,
    nwrsmpLatestGroupRowCount: latestGroupRows.length,
    nwrsmpSupportedSeriesAreaCount: liveSeriesAreaCount,
    nwrsmpSupportedSeriesPointCount: liveSeriesPointCount
  },
  nwrsmp: {
    pageTitle: cleanText(nwrsmpPage?.title?.rendered ?? "Data and insights"),
    pageUrl: nwrsmpPage?.link ?? "https://northwestrsmp.org.uk/data-and-insights/",
    dashboardUrl,
    dashboardName: dashboardPath,
    introNote:
      meaningfulNwrsmpParagraphs.find((paragraph) => /interactive|tableau|excel|data/i.test(paragraph)) ??
      meaningfulNwrsmpParagraphs[0] ??
      "",
    provenanceNote:
      meaningfulNwrsmpParagraphs.find((paragraph) => /source data owners|not provided by the rsmp/i.test(paragraph)) ??
      "",
    documents: nwrsmpDocuments,
    authorityObservations: {
      rowCount: authorityObservationRows.length,
      latestWorkbookPublishedAt: latestAuthorityWorkbook?.sourceWorkbookPublishedAt ?? null
    },
    latestGroups: {
      rowCount: latestGroupRows.length,
      latestWorkbookPublishedAt: latestLatestGroupsWorkbook?.sourceWorkbookPublishedAt ?? null,
      latestSnapshotDateHint: latestLatestGroupsWorkbook?.snapshotDateHint ?? null
    },
    supportedSeries: {
      areaCount: liveSeriesAreaCount,
      pointCount: liveSeriesPointCount,
      firstPeriodEnd: liveSeriesFirstPeriod,
      latestPeriodEnd: liveSeriesLatestPeriod,
      firstPeriodLabel: formatIsoDate(liveSeriesFirstPeriod),
      latestPeriodLabel: formatIsoDate(liveSeriesLatestPeriod),
      primaryWorkbookTitle: primarySeriesContributor?.sourceWorkbookTitle ?? null,
      primaryWorkbookPublishedAt: primarySeriesContributor?.sourceWorkbookPublishedAt ?? null,
      primaryWorkbookUrl: primarySeriesContributor?.sourceWorkbookUrl ?? null,
      contributingWorkbookCount: contributorCounts.size
    }
  },
  regionalPartners,
  regionalPartnerAssets,
  migrationObservatoryGuideLinks,
  similarOrganisations,
  archiveTools,
  archivedResearchInputs
};

writeNdjson(path.join(canonicalDir, "nwrsmp-workbooks.ndjson"), nwrsmpDocuments);
writeNdjson(path.join(canonicalDir, "nwrsmp-authority-observations.ndjson"), authorityObservationRows);
writeNdjson(path.join(canonicalDir, "nwrsmp-latest-groups.ndjson"), latestGroupRows);
writeNdjson(path.join(canonicalDir, "nwrsmp-supported-area-series.ndjson"), preferredSupportedSeriesRows);
writeNdjson(path.join(canonicalDir, "regional-partners.ndjson"), regionalPartners);
writeNdjson(path.join(canonicalDir, "regional-partner-assets.ndjson"), regionalPartnerAssets);
writeNdjson(path.join(canonicalDir, "migration-observatory-guide-links.ndjson"), migrationObservatoryGuideLinks);
writeNdjson(path.join(canonicalDir, "similar-organisations.ndjson"), similarOrganisations);
writeNdjson(path.join(canonicalDir, "archive-tools.ndjson"), archiveTools);
writeNdjson(path.join(canonicalDir, "archived-research-inputs.ndjson"), archivedResearchInputs);

writeJson(path.join(canonicalDir, "manifest.json"), {
  datasetId: "regional_sources",
  generatedAt: new Date().toISOString(),
  inputs: [
    {
      path: inputPaths.watchlist,
      fileSha256: fileSha256(inputPaths.watchlist)
    },
    {
      path: inputPaths.nwrsmpMedia,
      fileSha256: fileSha256(inputPaths.nwrsmpMedia)
    },
    {
      path: inputPaths.nwrsmpPage,
      fileSha256: fileSha256(inputPaths.nwrsmpPage)
    },
    {
      path: inputPaths.localRouteLatest,
      fileSha256: fileSha256(inputPaths.localRouteLatest)
    },
    {
      path: inputPaths.migrationYorkshireStatistics,
      fileSha256: fileSha256(inputPaths.migrationYorkshireStatistics)
    },
    {
      path: inputPaths.migrationYorkshireRefugeeDashboard,
      fileSha256: fileSha256(inputPaths.migrationYorkshireRefugeeDashboard)
    },
    {
      path: inputPaths.migrationYorkshireUkraineDashboard,
      fileSha256: fileSha256(inputPaths.migrationYorkshireUkraineDashboard)
    },
    {
      path: inputPaths.migrationYorkshireEussDashboard,
      fileSha256: fileSha256(inputPaths.migrationYorkshireEussDashboard)
    },
    {
      path: inputPaths.nempDataPage,
      fileSha256: fileSha256(inputPaths.nempDataPage)
    },
    {
      path: inputPaths.wsmpDataObservatory,
      fileSha256: fileSha256(inputPaths.wsmpDataObservatory)
    },
    {
      path: inputPaths.migrationObservatoryLocalGuide,
      fileSha256: fileSha256(inputPaths.migrationObservatoryLocalGuide)
    },
    ...nwrsmpDocuments.map((document) => ({
      path: path.join(rawWorkbookDir, document.localFileName),
      fileSha256: fileSha256(path.join(rawWorkbookDir, document.localFileName))
    }))
  ],
  outputs: {
    liveRegionalWatch: "src/data/live/regional-source-watch.json",
    liveAreaSeries: "src/data/live/area-series.json",
    nwrsmpWorkbookCount: nwrsmpDocuments.length,
    nwrsmpSupportedSeriesAreaCount: liveSeriesAreaCount,
    nwrsmpSupportedSeriesPointCount: liveSeriesPointCount,
    nwrsmpSupportedSeriesLatestPeriod: liveSeriesLatestPeriod,
    regionalPartnerAssetCount: regionalPartnerAssets.length,
    migrationObservatoryGuideLinkCount: migrationObservatoryGuideLinks.length
  }
});

writeJson(path.join(liveDir, "regional-source-watch.json"), liveOutput);
writeJson(path.join(liveDir, "area-series.json"), liveAreaSeries);

console.log(
  `Transformed ${nwrsmpDocuments.length} North West workbooks into ${liveSeriesPointCount} official supported-asylum history points across ${liveSeriesAreaCount} current areas, plus ${regionalPartnerAssets.length} partner assets and ${migrationObservatoryGuideLinks.length} Migration Observatory guide links.`
);

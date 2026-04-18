import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileSha256, hashId, readCsv } from "../lib/csv-parser.mjs";

const generatedAt = new Date().toISOString();

const sourceFiles = {
  contractLedger: path.resolve("data/manual/asylum-contract-ledger.csv"),
  hotelEntityLedger: path.resolve("src/data/live/hotel-entity-ledger.json"),
  followMoney: path.resolve("src/data/live/follow-money.json")
};

const canonicalDir = path.resolve("data/canonical/money_ledger");
const martsDir = path.resolve("data/marts/money_ledger");
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

function normalizeText(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function parseNumber(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function supplierIdFor(name, companyNumber) {
  if (companyNumber) {
    return `supplier_${slugify(companyNumber)}`;
  }

  return name ? `supplier_${slugify(name)}` : null;
}

function mapEntityRole(linkRole) {
  if (linkRole === "freeholder") {
    return "freeholder";
  }

  if (linkRole === "owner_group") {
    return "owner_group";
  }

  if (["operator", "manager"].includes(linkRole)) {
    return "hotel_operator";
  }

  if (linkRole === "brand_operator") {
    return "brand_operator";
  }

  return "other";
}

function riskLevelForProfile(profile) {
  if (profile.integritySignalCount >= 3) {
    return "high";
  }

  if (profile.integritySignalCount >= 1) {
    return "elevated";
  }

  if (
    profile.entityRole !== "prime_provider" &&
    profile.siteIds.length > 0 &&
    profile.publicContractCount === 0
  ) {
    return "medium";
  }

  return "low";
}

function moneyRecordSortValue(recordType) {
  const ranking = {
    prime_contract_scope: 1,
    scrutiny_estimate: 2,
    cost_indicator: 3,
    funding_instruction: 4,
    local_response_contract: 5,
    other: 6
  };

  return ranking[recordType] ?? 99;
}

const hotelLedger = readJson(sourceFiles.hotelEntityLedger);
const followMoney = readJson(sourceFiles.followMoney);

const siteIndex = new Map(hotelLedger.sites.map((site) => [site.siteId, site]));

const canonicalRecords = readCsv(sourceFiles.contractLedger).map((row) => {
  const siteIds = unique(
    String(row.site_ids ?? "")
      .split("|")
      .map((value) => normalizeText(value))
  );
  const supplierName = normalizeText(row.supplier_name);
  const supplierCompanyNumber = normalizeText(row.supplier_company_number);

  return {
    contract_id: `money_${row.record_id}`,
    record_type: row.record_type,
    title: row.title,
    buyer_name: row.buyer_name,
    buyer_body_id: normalizeText(row.buyer_body_id),
    supplier_id: supplierIdFor(supplierName, supplierCompanyNumber),
    supplier_name: supplierName,
    supplier_company_number: supplierCompanyNumber,
    supplier_role: normalizeText(row.supplier_role),
    route_family: normalizeText(row.route_family),
    scheme_label: normalizeText(row.scheme_label),
    scope_class: row.scope_class,
    status: row.status,
    notice_type: normalizeText(row.notice_type),
    award_date: normalizeText(row.award_date),
    published_date: normalizeText(row.published_date),
    period_label: normalizeText(row.period_label),
    value_gbp: parseNumber(row.value_gbp),
    value_kind: normalizeText(row.value_kind),
    geography_scope: normalizeText(row.geography_scope),
    site_ids: siteIds.length > 0 ? siteIds : null,
    source_title: normalizeText(row.source_title),
    source_url: normalizeText(row.source_url),
    confidence: normalizeText(row.confidence),
    generated_at: generatedAt,
    notes: normalizeText(row.notes)
  };
});

const liveRecords = canonicalRecords
  .map((record) => {
    const linkedSites = (record.site_ids ?? [])
      .map((siteId) => siteIndex.get(siteId))
      .filter(Boolean)
      .map((site) => ({
        siteId: site.siteId,
        siteName: site.siteName,
        areaName: site.areaName,
        regionName: site.regionName,
        entityCoverage: site.entityCoverage
      }));

    return {
      recordId: record.contract_id,
      recordType: record.record_type,
      title: record.title,
      buyerName: record.buyer_name,
      buyerBodyId: record.buyer_body_id,
      supplierId: record.supplier_id,
      supplierName: record.supplier_name,
      supplierCompanyNumber: record.supplier_company_number,
      supplierRole: record.supplier_role,
      routeFamily: record.route_family,
      schemeLabel: record.scheme_label,
      scopeClass: record.scope_class,
      status: record.status,
      noticeType: record.notice_type,
      awardDate: record.award_date,
      publishedDate: record.published_date,
      periodLabel: record.period_label,
      valueGbp: record.value_gbp,
      valueKind: record.value_kind,
      geographyScope: record.geography_scope,
      siteIds: record.site_ids ?? [],
      linkedSites,
      sourceTitle: record.source_title,
      sourceUrl: record.source_url,
      confidence: record.confidence,
      notes: record.notes
    };
  })
  .sort((left, right) => {
    const typeDelta = moneyRecordSortValue(left.recordType) - moneyRecordSortValue(right.recordType);
    if (typeDelta !== 0) {
      return typeDelta;
    }

    return String(right.publishedDate ?? "").localeCompare(String(left.publishedDate ?? ""));
  });

const supplierProfiles = new Map();

function ensureSupplierProfile({ supplierId, entityName, entityRole, companyNumber, sourceUrl }) {
  if (!supplierId) {
    return null;
  }

  if (!supplierProfiles.has(supplierId)) {
    supplierProfiles.set(supplierId, {
      supplierId,
      entityName,
      entityRole: entityRole ?? "other",
      companyNumber: companyNumber ?? null,
      routeFamilies: new Set(),
      siteIds: new Set(),
      publicContractCount: 0,
      disclosedAwardValueGbp: null,
      integritySignalCount: 0,
      sourceUrls: new Set(sourceUrl ? [sourceUrl] : []),
      notes: []
    });
  }

  const profile = supplierProfiles.get(supplierId);
  if (!profile.entityName && entityName) {
    profile.entityName = entityName;
  }
  if (!profile.companyNumber && companyNumber) {
    profile.companyNumber = companyNumber;
  }
  if (profile.entityRole === "other" && entityRole) {
    profile.entityRole = entityRole;
  }
  if (sourceUrl) {
    profile.sourceUrls.add(sourceUrl);
  }
  return profile;
}

for (const record of liveRecords) {
  if (!record.supplierId || !record.supplierName) {
    continue;
  }

  const profile = ensureSupplierProfile({
    supplierId: record.supplierId,
    entityName: record.supplierName,
    entityRole: record.supplierRole,
    companyNumber: record.supplierCompanyNumber,
    sourceUrl: record.sourceUrl
  });

  profile.publicContractCount += 1;
  if (record.routeFamily) {
    profile.routeFamilies.add(record.routeFamily);
  }
  for (const site of record.linkedSites) {
    profile.siteIds.add(site.siteId);
  }
  if (record.valueKind === "award_value" && typeof record.valueGbp === "number") {
    profile.disclosedAwardValueGbp =
      (profile.disclosedAwardValueGbp ?? 0) + record.valueGbp;
  }
  if (record.notes) {
    profile.notes.push(record.notes);
  }
}

for (const site of hotelLedger.sites) {
  if (site.primeProvider) {
    const supplierId = supplierIdFor(site.primeProvider.provider, null);
    const profile = ensureSupplierProfile({
      supplierId,
      entityName: site.primeProvider.provider,
      entityRole: "prime_provider",
      companyNumber: null,
      sourceUrl: site.primeProvider.sourceUrl
    });
    profile.routeFamilies.add("asylum_support");
    profile.siteIds.add(site.siteId);
  }

  for (const link of site.entityLinks) {
    const supplierId = supplierIdFor(link.entityName, link.companyNumber);
    const profile = ensureSupplierProfile({
      supplierId,
      entityName: link.entityName,
      entityRole: mapEntityRole(link.linkRole),
      companyNumber: link.companyNumber,
      sourceUrl: link.sourceUrls?.[0] ?? null
    });
    profile.routeFamilies.add("asylum_support");
    profile.siteIds.add(site.siteId);
    profile.integritySignalCount += site.integritySignals.length;
    for (const sourceUrl of link.sourceUrls ?? []) {
      profile.sourceUrls.add(sourceUrl);
    }
    if (link.notes) {
      profile.notes.push(link.notes);
    }
  }
}

const liveSupplierProfiles = [...supplierProfiles.values()]
  .map((profile) => ({
    supplier_id: profile.supplierId,
    entity_name: profile.entityName,
    entity_role: profile.entityRole,
    company_number: profile.companyNumber,
    country_of_registration: null,
    route_families: [...profile.routeFamilies],
    site_count: profile.siteIds.size,
    public_contract_count: profile.publicContractCount,
    public_contract_value_gbp: profile.disclosedAwardValueGbp,
    risk_level: riskLevelForProfile({
      entityRole: profile.entityRole,
      siteIds: [...profile.siteIds],
      publicContractCount: profile.publicContractCount,
      integritySignalCount: profile.integritySignalCount
    }),
    integrity_signal_count: profile.integritySignalCount,
    source_urls: [...profile.sourceUrls],
    generated_at: generatedAt,
    notes: unique(profile.notes).join(" | ") || null,
    siteIds: [...profile.siteIds],
    routeFamilies: [...profile.routeFamilies]
  }))
  .sort((left, right) => {
    if ((right.site_count ?? 0) !== (left.site_count ?? 0)) {
      return (right.site_count ?? 0) - (left.site_count ?? 0);
    }

    return left.entity_name.localeCompare(right.entity_name);
  });

const routeGroups = unique(liveRecords.map((record) => record.routeFamily)).map((routeFamily) => ({
  routeFamily,
  recordCount: liveRecords.filter((record) => record.routeFamily === routeFamily).length,
  rowsWithValue: liveRecords.filter(
    (record) => record.routeFamily === routeFamily && typeof record.valueGbp === "number"
  ).length
}));

const recordTypeGroups = unique(liveRecords.map((record) => record.recordType)).map((recordType) => ({
  recordType,
  recordCount: liveRecords.filter((record) => record.recordType === recordType).length
}));

const unresolvedCurrentSites = hotelLedger.sites.filter(
  (site) => site.status === "current" && site.entityCoverage !== "documented"
);

const primeRecordsMissingValue = liveRecords.filter(
  (record) => record.recordType === "prime_contract_scope" && typeof record.valueGbp !== "number"
);

const fundingRowsWithoutTariffBreakdown = liveRecords.filter(
  (record) => record.recordType === "funding_instruction" && typeof record.valueGbp !== "number"
);

const investigativeLeads = [
  {
    id: "prime-values-undisclosed",
    title: "Prime regional contracts are mapped, but values are still not normalized in the starter public ledger",
    detail: `${primeRecordsMissingValue.length} current prime-provider rows are linked to visible hotel geography without a disclosed contract value in this starter ledger.`,
    sourceUrl: "https://www.gov.uk/government/publications/asylum-accommodation-and-support-contracts",
    severity: "warning"
  },
  {
    id: "funding-rows-still-opaque",
    title: "Official funding instructions exist, but several tariff tables still need normalization",
    detail: `${fundingRowsWithoutTariffBreakdown.length} funding-instruction rows are in scope but still need machine-readable component tables before place-level funding comparisons are safe to publish.`,
    sourceUrl: "https://www.gov.uk/government/publications/uk-resettlement-programmes-funding-instructions-2025-to-2026/uk-resettlement-programmes-funding-instructions-2025-to-2026",
    severity: "info"
  },
  {
    id: "current-hotel-resolution-gap",
    title: "Current named hotels still outpace documented operator and owner chains",
    detail: `${unresolvedCurrentSites.length} current named hotel sites are visible in the live ledger but still sit in partial or unresolved entity coverage.`,
    sourceUrl: "https://www.eppingforestdc.gov.uk/news/joint-open-letter-bell-hotel-and-phoenix-hotel/",
    severity: "warning"
  },
  {
    id: "local-response-procurement-gap",
    title: "Local response contracts remain the biggest money gap",
    detail: "The public ledger has prime-provider scope, national cost indicators, and official funding instructions, but almost no normalized local response contracts tied to named hotels or refugee placement work.",
    sourceUrl: "https://github.com/tompickup23/tompickup23.github.io",
    severity: "warning"
  }
];

const moneyLedger = {
  generatedAt,
  summary: {
    totalRecords: liveRecords.length,
    primeContractRows: liveRecords.filter((record) => record.recordType === "prime_contract_scope").length,
    fundingInstructionRows: liveRecords.filter((record) => record.recordType === "funding_instruction").length,
    scrutinyOrCostRows: liveRecords.filter((record) =>
      ["scrutiny_estimate", "cost_indicator"].includes(record.recordType)
    ).length,
    rowsWithDisclosedValue: liveRecords.filter((record) => typeof record.valueGbp === "number").length,
    uniqueSuppliers: liveSupplierProfiles.length,
    linkedNamedSites: unique(liveRecords.flatMap((record) => record.siteIds)).length,
    routeFamiliesCovered: unique(liveRecords.map((record) => record.routeFamily)).length
  },
  records: liveRecords,
  supplierProfiles: liveSupplierProfiles.map((profile) => ({
    supplierId: profile.supplier_id,
    entityName: profile.entity_name,
    entityRole: profile.entity_role,
    companyNumber: profile.company_number,
    routeFamilies: profile.routeFamilies,
    siteCount: profile.site_count,
    publicContractCount: profile.public_contract_count,
    publicContractValueGbp: profile.public_contract_value_gbp,
    riskLevel: profile.risk_level,
    integritySignalCount: profile.integrity_signal_count,
    sourceUrls: profile.source_urls,
    siteIds: profile.siteIds,
    notes: profile.notes
  })),
  routeGroups,
  recordTypeGroups,
  investigativeLeads,
  supplierLayers: followMoney.supplierLayers,
  limitations: [
    "The starter money ledger deliberately mixes prime contract scope, funding instructions, and scrutiny cost rows so the public can see the whole accountability chain before local procurement ingestion is complete.",
    "Tariff or grant rows are not aggregate spend totals. They are rate components or official funding instructions that still need claimant or placement counts before place-level spending can be estimated safely.",
    "Prime-provider rows show current regional responsibility, not a site-specific newly awarded notice for each named hotel.",
    "Local response contracts, subcontractor rows, and council emergency procurement remain the biggest missing public layer."
  ],
  sources: [
    {
      name: "Starter asylum contract and funding ledger",
      sourceUrl: "https://www.gov.uk/government/publications/asylum-accommodation-and-support-contracts",
      type: "manual ledger"
    },
    {
      name: "Hotel entity ledger",
      sourceUrl: "https://www.eppingforestdc.gov.uk/news/joint-open-letter-bell-hotel-and-phoenix-hotel/",
      type: "linked site evidence"
    }
  ]
};

ensureCleanDir(canonicalDir);
ensureCleanDir(martsDir);

writeNdjson(path.join(canonicalDir, "money-records.ndjson"), canonicalRecords);
writeNdjson(
  path.join(canonicalDir, "supplier-profiles.ndjson"),
  liveSupplierProfiles.map((profile) => ({
    supplier_id: profile.supplier_id,
    entity_name: profile.entity_name,
    entity_role: profile.entity_role,
    company_number: profile.company_number,
    country_of_registration: profile.country_of_registration,
    route_families: profile.route_families,
    site_count: profile.site_count,
    public_contract_count: profile.public_contract_count,
    public_contract_value_gbp: profile.public_contract_value_gbp,
    risk_level: profile.risk_level,
    integrity_signal_count: profile.integrity_signal_count,
    source_urls: profile.source_urls,
    generated_at: profile.generated_at,
    notes: profile.notes
  }))
);

const manifest = {
  generated_at: generatedAt,
  dataset_id: "money_ledger",
  source_files: Object.entries(sourceFiles).map(([key, filePath]) => ({
    name: key,
    path: path.relative(path.resolve("."), filePath),
    sha256: fileSha256(filePath)
  })),
  counts: {
    record_rows: canonicalRecords.length,
    supplier_rows: liveSupplierProfiles.length
  }
};

writeJson(path.join(canonicalDir, "manifest.json"), manifest);
writeJson(path.join(martsDir, "money-ledger.json"), moneyLedger);
writeJson(path.join(liveDir, "money-ledger.json"), moneyLedger);

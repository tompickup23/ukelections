import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const bodyId = "lancashire_cc";
const rawDir = path.resolve("data/raw/lancashire_cc");
const canonicalDir = path.resolve("data/canonical/lancashire_cc");
const spendingDir = path.join(canonicalDir, "spending");
const budgetsDir = path.join(canonicalDir, "budgets");
const mappingsDir = path.join(canonicalDir, "mappings");
const martsDir = path.resolve("data/marts/lancashire_cc");

const sourceUrls = {
  spending: (filename) =>
    `https://raw.githubusercontent.com/tompickup23/lancashire/gh-pages/lancashirecc/data/${filename}`,
  budgets:
    "https://raw.githubusercontent.com/tompickup23/lancashire/gh-pages/lancashirecc/data/budgets.json",
  budgetsGovUk:
    "https://raw.githubusercontent.com/tompickup23/lancashire/gh-pages/lancashirecc/data/budgets_govuk.json",
  budgetsSummary:
    "https://raw.githubusercontent.com/tompickup23/lancashire/gh-pages/lancashirecc/data/budgets_summary.json",
  proposedBudget:
    "https://raw.githubusercontent.com/tompickup23/lancashire/gh-pages/lancashirecc/data/proposed_budget.json",
  budgetMapping:
    "https://raw.githubusercontent.com/tompickup23/lancashire/gh-pages/lancashirecc/data/budget_mapping.json"
};
const redactedSupplierPattern = /\bREDACT(?:ED)?\b/i;

function ensureCleanDir(directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

function readJson(filename) {
  return JSON.parse(readFileSync(path.join(rawDir, filename), "utf8"));
}

function writeJson(filename, value) {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function hashId(parts) {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function normalizeFinancialYear(value) {
  if (!value) {
    return null;
  }

  return value.replace("-", "/");
}

function inferQuarter(transactionDate) {
  const month = Number(transactionDate.slice(5, 7));
  return Math.floor((month - 1) / 3) + 1;
}

function toNumber(value) {
  return typeof value === "number" ? value : null;
}

function roundNumber(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function listExpectedMonths(startMonth, endMonth) {
  if (!startMonth || !endMonth) {
    return [];
  }

  const months = [];
  const cursor = new Date(`${startMonth}-01T00:00:00Z`);
  const limit = new Date(`${endMonth}-01T00:00:00Z`);

  while (cursor <= limit) {
    months.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

function calculateChangePct(fromValue, toValue, digits = 1) {
  if (typeof fromValue !== "number" || typeof toValue !== "number" || fromValue === 0) {
    return null;
  }

  return roundNumber(((toValue - fromValue) / fromValue) * 100, digits);
}

function sortFinancialYears(years) {
  return [...years].sort((a, b) => Number(String(a).slice(0, 4)) - Number(String(b).slice(0, 4)));
}

function transformSpending() {
  const filenames = readdirSync(rawDir)
    .filter((name) => /^spending-\d{4}-\d{2}\.json$/.test(name))
    .sort();

  ensureCleanDir(spendingDir);

  const monthlyManifest = [];
  const supplierTotals = new Map();
  const departmentTotals = new Map();
  const serviceAreaTotals = new Map();
  const financialYearTotals = new Map();
  const monthlyTotals = [];

  let totalRecords = 0;
  let totalSpend = 0;
  let firstDate = null;
  let lastDate = null;

  for (const filename of filenames) {
    const sourcePath = path.join(rawDir, filename);
    const rows = JSON.parse(readFileSync(sourcePath, "utf8"));
    const normalized = [];
    let monthSpend = 0;
    const month = filename.match(/\d{4}-\d{2}/)?.[0] || null;

    for (const row of rows) {
      const transactionDate = row.date;
      const amount = Number(row.amount || 0);
      const departmentRaw = row.department_raw || row.service_division || "Unknown";
      const supplierName = row.supplier || "Unknown supplier";
      const financialYear = row.financial_year || null;
      const serviceArea = row.service_area_raw || null;

      const record = {
        transaction_id: `tx_${hashId([
          bodyId,
          filename,
          transactionDate,
          row.reference || "",
          supplierName,
          String(amount),
          departmentRaw,
          serviceArea || ""
        ])}`,
        body_id: bodyId,
        source_id: "council_transparency_spend",
        transaction_date: transactionDate,
        financial_year: financialYear,
        quarter: row.quarter || inferQuarter(transactionDate),
        supplier_id: null,
        supplier_name_raw: supplierName,
        amount_gbp: amount,
        department_raw: departmentRaw,
        service_area_raw: serviceArea,
        service_division: row.service_division || null,
        expenditure_category: row.expenditure_category || null,
        reference: row.reference ? String(row.reference) : null,
        spend_type: row.type || null,
        currency: "GBP",
        source_url: sourceUrls.spending(filename),
        notes: null
      };

      normalized.push(record);
      totalRecords += 1;
      totalSpend += amount;
      monthSpend += amount;

      if (!firstDate || transactionDate < firstDate) {
        firstDate = transactionDate;
      }

      if (!lastDate || transactionDate > lastDate) {
        lastDate = transactionDate;
      }

      supplierTotals.set(supplierName, (supplierTotals.get(supplierName) || 0) + amount);
      departmentTotals.set(departmentRaw, (departmentTotals.get(departmentRaw) || 0) + amount);
      if (serviceArea) {
        serviceAreaTotals.set(serviceArea, (serviceAreaTotals.get(serviceArea) || 0) + amount);
      }
      if (financialYear) {
        financialYearTotals.set(financialYear, (financialYearTotals.get(financialYear) || 0) + amount);
      }
    }

    const outputPath = path.join(
      spendingDir,
      filename.replace(/^spending-/, "transactions-").replace(/\.json$/, ".ndjson")
    );
    writeFileSync(outputPath, normalized.map((row) => JSON.stringify(row)).join("\n") + "\n");

    monthlyManifest.push({
      month,
      source_file: filename,
      canonical_file: path.basename(outputPath),
      record_count: normalized.length,
      total_spend_gbp: roundNumber(monthSpend),
      source_sha256: fileSha256(sourcePath),
      source_url: sourceUrls.spending(filename)
    });

    monthlyTotals.push({
      month,
      record_count: normalized.length,
      total_spend_gbp: roundNumber(monthSpend)
    });
  }

  const spendingManifest = {
    generated_at: new Date().toISOString(),
    body_id: bodyId,
    total_records: totalRecords,
    total_spend_gbp: roundNumber(totalSpend),
    first_date: firstDate,
    last_date: lastDate,
    months: monthlyManifest
  };

  writeJson(path.join(canonicalDir, "spending_transactions_manifest.json"), spendingManifest);

  const byFinancialYear = [...financialYearTotals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([financial_year, spend]) => ({
      financial_year,
      total_spend_gbp: roundNumber(spend)
    }));

  const topSuppliers = [...supplierTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([supplier_name, total_spend_gbp]) => ({
      supplier_name,
      total_spend_gbp: roundNumber(total_spend_gbp)
    }));

  const topDepartments = [...departmentTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([department_raw, total_spend_gbp]) => ({
      department_raw,
      total_spend_gbp: roundNumber(total_spend_gbp)
    }));

  const topServiceAreas = [...serviceAreaTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([service_area_raw, total_spend_gbp]) => ({
      service_area_raw,
      total_spend_gbp: roundNumber(total_spend_gbp)
    }));

  const redactedSuppliers = [...supplierTotals.entries()].filter(([supplierName]) =>
    redactedSupplierPattern.test(supplierName)
  );
  const redactedSupplierSpend = redactedSuppliers.reduce((sum, [, spend]) => sum + spend, 0);
  const expectedMonths = listExpectedMonths(monthlyTotals[0]?.month, monthlyTotals.at(-1)?.month);
  const presentMonths = new Set(monthlyTotals.map((row) => row.month));
  const missingExpectedMonths = expectedMonths.filter((month) => !presentMonths.has(month));

  const summary = {
    generated_at: new Date().toISOString(),
    body_id: bodyId,
    source_file_count: filenames.length,
    total_records: totalRecords,
    total_spend_gbp: roundNumber(totalSpend),
    average_monthly_spend_gbp: filenames.length ? roundNumber(totalSpend / filenames.length) : 0,
    first_date: firstDate,
    last_date: lastDate,
    by_financial_year: byFinancialYear,
    monthly_totals: monthlyTotals,
    redacted_supplier_spend_gbp: roundNumber(redactedSupplierSpend),
    redacted_supplier_labels: redactedSuppliers.map(([supplierName]) => supplierName).sort(),
    missing_expected_months: missingExpectedMonths,
    top_suppliers: topSuppliers,
    top_departments: topDepartments,
    top_service_areas: topServiceAreas
  };

  writeJson(path.join(martsDir, "spending-summary.json"), summary);
  return summary;
}

function transformBudgets() {
  ensureCleanDir(budgetsDir);

  const budgets = readJson("budgets.json");
  const budgetsGovUk = readJson("budgets_govuk.json");
  const budgetsSummary = readJson("budgets_summary.json");
  const proposedBudget = readJson("proposed_budget.json");

  const records = [];

  for (const budgetYear of budgets.revenue_budgets || []) {
    const year = normalizeFinancialYear(budgetYear.financial_year);
    const breakdown = budgetYear.expenditure_breakdown || {};

    for (const [serviceName, netBudget] of Object.entries(budgetYear.departments || {})) {
      const detail = breakdown[serviceName] || {};
      records.push({
        budget_record_id: `bud_${hashId([bodyId, "local", year, serviceName])}`,
        body_id: bodyId,
        source_id: "council_local_budget_summary",
        financial_year: year,
        service_name: serviceName,
        budget_family: "local_revenue_budget",
        net_budget_gbp: toNumber(netBudget),
        gross_expenditure_gbp: toNumber(detail.total_expenditure),
        income_gbp: toNumber(detail.total_income),
        reserves_gbp: null,
        council_tax_requirement_gbp: null,
        data_status: "official",
        source_url: sourceUrls.budgets,
        notes: budgetYear.source || null
      });
    }
  }

  for (const year of budgetsGovUk.years || []) {
    const yearRecord = budgetsGovUk.by_year?.[year];
    const services = yearRecord?.revenue_summary?.service_expenditure || {};

    for (const [serviceName, serviceInfo] of Object.entries(services)) {
      records.push({
        budget_record_id: `bud_${hashId([bodyId, "govuk", year, serviceName])}`,
        body_id: bodyId,
        source_id: "mhclg_revenue_outturn_multi_year",
        financial_year: normalizeFinancialYear(year),
        service_name: serviceName,
        budget_family: "govuk_revenue_outturn",
        net_budget_gbp: toNumber(serviceInfo.value_pounds),
        gross_expenditure_gbp: null,
        income_gbp: null,
        reserves_gbp: null,
        council_tax_requirement_gbp: null,
        data_status: yearRecord?.certified ? "final" : "provisional",
        source_url: sourceUrls.budgetsGovUk,
        notes: yearRecord?.notes || null
      });
    }
  }

  for (const [directorateName, directorate] of Object.entries(proposedBudget.directorates || {})) {
    records.push({
      budget_record_id: `bud_${hashId([bodyId, "approved", proposedBudget.financial_year, directorateName])}`,
      body_id: bodyId,
      source_id: "council_proposed_budget",
      financial_year: normalizeFinancialYear(proposedBudget.financial_year),
      service_name: directorateName,
      budget_family: "approved_budget_plan",
      net_budget_gbp: toNumber(directorate.net_2026_27),
      gross_expenditure_gbp: null,
      income_gbp: null,
      reserves_gbp: null,
      council_tax_requirement_gbp: null,
      data_status: "official",
      source_url: sourceUrls.proposedBudget,
      notes: proposedBudget.status || null
    });

    for (const [serviceName, service] of Object.entries(directorate.services || {})) {
      records.push({
        budget_record_id: `bud_${hashId([
          bodyId,
          "approved_service",
          proposedBudget.financial_year,
          directorateName,
          serviceName
        ])}`,
        body_id: bodyId,
        source_id: "council_proposed_budget",
        financial_year: normalizeFinancialYear(proposedBudget.financial_year),
        service_name: `${directorateName} :: ${serviceName}`,
        budget_family: "approved_budget_plan_service",
        net_budget_gbp: toNumber(service.net_2026_27),
        gross_expenditure_gbp: null,
        income_gbp: null,
        reserves_gbp: null,
        council_tax_requirement_gbp: null,
        data_status: "official",
        source_url: sourceUrls.proposedBudget,
        notes: service.description || null
      });
    }
  }

  writeJson(path.join(budgetsDir, "budget-outturn.json"), records);

  const trendYears = budgetsSummary.years || [];
  const latestTrendYear = budgetsSummary.latest_year || trendYears.at(-1) || null;
  const firstTrendYear = trendYears[0] || null;
  const latestYearSummary = latestTrendYear ? budgetsSummary.year_summaries?.[latestTrendYear] : null;
  const firstYearSummary = firstTrendYear ? budgetsSummary.year_summaries?.[firstTrendYear] : null;
  const councilTaxYears = sortFinancialYears(
    Object.keys(budgetsSummary.council_tax?.band_d_by_year || {})
  );
  const latestCouncilTaxYear = councilTaxYears.at(-1) || null;
  const latestCouncilTaxBandD = latestCouncilTaxYear
    ? budgetsSummary.council_tax?.band_d_by_year?.[latestCouncilTaxYear]
    : null;
  const baseCouncilTaxBandD = budgetsSummary.council_tax?.band_d_by_year?.["2021/22"] || null;
  const serviceGrowth = Object.entries(budgetsSummary.trends?.service_trends || {})
    .filter(([serviceName]) => serviceName.endsWith("_change_pct"))
    .map(([serviceName, changePct]) => ({
      service_name: serviceName.replace(/_change_pct$/, ""),
      change_pct: toNumber(changePct)
    }))
    .filter((row) => row.change_pct !== null)
    .sort((a, b) => b.change_pct - a.change_pct);

  const summary = {
    generated_at: new Date().toISOString(),
    body_id: bodyId,
    source_years_local: (budgets.revenue_budgets || []).map((row) => normalizeFinancialYear(row.financial_year)),
    source_years_govuk: (budgetsGovUk.years || []).map(normalizeFinancialYear),
    latest_year: latestTrendYear,
    latest_summary: budgetsSummary.headline || null,
    local_service_breakdown_latest: budgetsSummary.service_breakdown || {},
    headline_trends: budgetsSummary.trends?.headline_trends || {},
    latest_reserves_total_gbp: latestYearSummary?.reserves_total || null,
    reserves_change_since_first_year_gbp:
      typeof latestYearSummary?.reserves_total === "number" &&
      typeof firstYearSummary?.reserves_total === "number"
        ? latestYearSummary.reserves_total - firstYearSummary.reserves_total
        : null,
    reserves_change_since_first_year_pct: calculateChangePct(
      firstYearSummary?.reserves_total,
      latestYearSummary?.reserves_total
    ),
    council_tax_band_d_latest: latestCouncilTaxBandD,
    council_tax_band_d_latest_year: latestCouncilTaxYear,
    council_tax_band_d_change_since_2021_22_pct: calculateChangePct(
      baseCouncilTaxBandD,
      latestCouncilTaxBandD
    ),
    service_growth_pct: serviceGrowth.slice(0, 12),
    approved_budget: {
      financial_year: normalizeFinancialYear(proposedBudget.financial_year),
      net_revenue_budget: proposedBudget.net_revenue_budget,
      council_tax_band_d: proposedBudget.council_tax?.band_d || null,
      status: proposedBudget.status
    },
    quality_flags: [
      ...(budgetsSummary.headline?.net_current_expenditure === 0
        ? [
            {
              code: "zero_net_current_expenditure",
              severity: "note",
              message:
                "The upstream budget summary publishes net current expenditure as zero; keep that field separate from other headline measures."
            }
          ]
        : [])
    ],
    record_count: records.length
  };

  writeJson(path.join(martsDir, "budget-summary.json"), summary);
  return summary;
}

function transformBudgetMapping(spendingSummary) {
  ensureCleanDir(mappingsDir);

  const mapping = readJson("budget_mapping.json");
  const rows = Object.entries(mapping.mappings || {}).map(([sourceLabel, entry]) => ({
    mapping_id: `map_${hashId([bodyId, sourceLabel])}`,
    body_id: bodyId,
    source_label: sourceLabel,
    mapped_budget_category: entry.budget_category || "Unmapped",
    confidence: entry.confidence || "none",
    mapping_method: "observed_budget_mapping_json",
    review_status: entry.confidence && entry.confidence !== "none" ? "reviewed" : "unreviewed",
    mapped_spend_gbp: toNumber(entry.spend),
    valid_from: null,
    valid_to: null,
    notes: null
  }));

  writeJson(path.join(mappingsDir, "budget-mapping.json"), rows);

  const categorySummary = mapping.category_summary || {};
  const topUnmapped = (mapping.unmapped_top || []).slice(0, 25);
  const mappingTotalSpend = toNumber(mapping.coverage?.total_spend);
  const mappedSpend = toNumber(mapping.coverage?.mapped_spend);
  const coveragePct = toNumber(mapping.coverage?.mapped_spend_pct);
  const canonicalTotalSpend = spendingSummary?.total_spend_gbp || null;
  const differenceFromCanonicalSpend =
    typeof mappingTotalSpend === "number" && typeof canonicalTotalSpend === "number"
      ? roundNumber(mappingTotalSpend - canonicalTotalSpend)
      : null;

  const summary = {
    generated_at: new Date().toISOString(),
    body_id: bodyId,
    total_departments: mapping.total_departments,
    mapped_departments: mapping.mapped_departments,
    unmapped_departments: mapping.unmapped_departments,
    coverage: mapping.coverage || null,
    unmapped_spend_gbp:
      typeof mappingTotalSpend === "number" && typeof mappedSpend === "number"
        ? roundNumber(mappingTotalSpend - mappedSpend)
        : null,
    canonical_total_spend_gbp: canonicalTotalSpend,
    difference_from_canonical_spend_gbp: differenceFromCanonicalSpend,
    category_summary: categorySummary,
    top_unmapped: topUnmapped,
    quality_flags: [
      ...(typeof coveragePct === "number" && coveragePct < 70
        ? [
            {
              code: "low_mapping_coverage",
              severity: "high",
              message: `Only ${coveragePct}% of spend in the upstream mapping layer is assigned to a budget category.`
            }
          ]
        : []),
      ...(typeof differenceFromCanonicalSpend === "number" && Math.abs(differenceFromCanonicalSpend) > 1000000
        ? [
            {
              code: "mapping_differs_from_canonical_spend",
              severity: "medium",
              message: `The upstream mapping layer total differs from the canonical transaction corpus by GBP ${differenceFromCanonicalSpend.toLocaleString()}.`
            }
          ]
        : [])
    ],
    record_count: rows.length
  };

  writeJson(path.join(martsDir, "budget-mapping-summary.json"), summary);
  return summary;
}

mkdirSync(canonicalDir, { recursive: true });
mkdirSync(martsDir, { recursive: true });

const spendingSummary = transformSpending();
const budgetSummary = transformBudgets();
const mappingSummary = transformBudgetMapping(spendingSummary);

writeJson(path.join(canonicalDir, "manifest.json"), {
  generated_at: new Date().toISOString(),
  body_id: bodyId,
  domains: ["spending", "budgets", "budget_mapping"],
  record_counts: {
    spending_transactions: spendingSummary.total_records,
    budget_records: budgetSummary.record_count,
    mapping_records: mappingSummary.record_count
  },
  outputs: [
    "spending/transactions-YYYY-MM.ndjson",
    "spending_transactions_manifest.json",
    "budgets/budget-outturn.json",
    "mappings/budget-mapping.json"
  ]
});

console.log("Transformed Lancashire CC spending, budgets, and budget mapping.");

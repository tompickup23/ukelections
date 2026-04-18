import { expect, test } from "@playwright/test";
import { disableMotion, stabilizePage } from "./layout-helpers";

const pages = [
  // home page excluded — redesigned with impact-first layout, no longer follows priority-section pattern
  { name: "places", path: "/places/", focus: "#place-search", hasPageContents: true },
  // north-west-region removed — page completely rewritten without priority-section pattern
  // hotels page disabled (renamed to _hotels.astro.disabled) — data pipeline intact
  { name: "spending", path: "/spending/", focus: "#money-findings", hasPageContents: true },
  { name: "entities", path: "/entities/", focus: "#entity-findings", hasPageContents: true },
  { name: "entity-serco", path: "/entities/supplier_serco/", focus: "#entity-findings", hasPageContents: true },
  { name: "compare", path: "/compare/", focus: "#compare-findings", hasPageContents: true },
  { name: "routes", path: "/routes/", focus: "#route-findings", hasPageContents: true },
  { name: "sources", path: "/sources/", focus: "#source-findings", hasPageContents: true },
  { name: "methodology", path: "/methodology/", focus: "#method-findings", hasPageContents: true }
] as const;

const placePages = [
  { name: "birmingham", path: "/places/birmingham/", focus: "#place-summary" },
  { name: "north-yorkshire", path: "/places/north-yorkshire/", focus: "#place-summary" }
] as const;

const filteredViews = [
  {
    name: "compare-filtered",
    path: "/compare/?compare_model=hotel-heavy&compare_focus=contingency&compare_limit=24#compare-explorer",
    root: "#compare-explorer",
    summary: "[data-compare-summary]",
    expectedSummary: /Showing \d+ of \d+ matching places/,
    expectedFocus: "contingency",
    expectedLocation: "compare_model=hotel-heavy"
  },
  // hotels-filtered removed — hotels page disabled
  {
    name: "spending-filtered",
    path: "/spending/?money_route=asylum_support&money_value=with_value&money_sort=value#money-explorer",
    root: "#money-explorer",
    summary: "[data-money-summary]",
    expectedSummary: /Showing \d+ of \d+ public ledger rows/,
    expectedFocus: "asylum_support",
    expectedLocation: "money_sort=value"
  },
  {
    name: "entities-filtered",
    path: "/entities/?entity_role=prime_provider&entity_footprint=named_estate&entity_sort=estate#entity-explorer",
    root: "#entity-explorer",
    summary: "[data-entity-summary]",
    expectedSummary: /Showing \d+ of \d+ matching profiles/,
    expectedFocus: "prime_provider",
    expectedLocation: "entity_footprint=named_estate"
  },
  // place-drilldown removed — section removed in place page trim
] as const;

test.describe("mobile evidence-first layout", () => {
  for (const pageConfig of pages) {
    test(`${pageConfig.name} keeps the priority section visible and stable`, async ({ page }, testInfo) => {
      await stabilizePage(page);

      await page.goto(pageConfig.path, { waitUntil: "networkidle" });
      await disableMotion(page);

      const prioritySection = page.locator(pageConfig.focus);
      const firstContentSection = page.locator("main > section.section").first();

      await expect(prioritySection).toBeVisible();
      await expect(prioritySection.locator("h1, h2").first()).toBeVisible();
      await expect(firstContentSection).toHaveAttribute("id", pageConfig.focus.slice(1));
      await expect(firstContentSection).toHaveClass(/priority-section/);

      if (pageConfig.hasPageContents) {
        const pageContents = page.locator(".page-contents").first();
        await expect(pageContents).toBeVisible();
        await expect(page.locator(".page-contents-links a").first()).toHaveAttribute("href", pageConfig.focus);

        const pageContentsPosition = await pageContents.evaluate((node) => getComputedStyle(node).position);
        expect(pageContentsPosition).toBe("static");
      }

      if ("hasRegionMapExplorer" in pageConfig && pageConfig.hasRegionMapExplorer) {
        await expect(page.locator("[data-region-map-explorer]")).toBeVisible();
        await expect(page.locator("[data-region-map-view-button]")).toHaveCount(3);
        await expect(page.locator("[data-region-map-legend]")).toBeVisible();

        if (!("hasRegionMapSummary" in pageConfig) || pageConfig.hasRegionMapSummary !== false) {
          await expect(page.locator(".region-map-summary-stats").first()).toBeVisible();
        }
      }

      if ("hasAuthorityStage" in pageConfig && pageConfig.hasAuthorityStage) {
        await expect(page.locator("[data-region-authority-stage]")).toBeVisible();
        await expect(page.locator("[data-region-authority-svg]")).toBeVisible();
        await expect(page.locator("[data-home-system]")).toBeVisible();
      }

      // home page tests removed — page redesigned with impact-first layout

      const overflowWidth = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflowWidth).toBeLessThanOrEqual(2);

      const screenshot = await page.screenshot({ fullPage: false });
      await testInfo.attach(`${pageConfig.name}-mobile`, {
        body: screenshot,
        contentType: "image/png"
      });
    });
  }
});

test.describe("mobile place pages", () => {
  for (const pageConfig of placePages) {
    test(`${pageConfig.name} keeps place navigation and stock logic stable`, async ({ page }, testInfo) => {
      await stabilizePage(page);

      await page.goto(pageConfig.path, { waitUntil: "networkidle" });
      await disableMotion(page);

      const pageContents = page.locator(".page-contents").first();
      const firstContentSection = page.locator("main > section.section").first();
      const stockLogicSection = page.locator(pageConfig.focus);

      await expect(pageContents).toBeVisible();
      await expect(stockLogicSection).toBeVisible();
      await expect(firstContentSection).toHaveAttribute("id", pageConfig.focus.slice(1));
      await expect(page.locator(".page-contents-links a").first()).toHaveAttribute("href", pageConfig.focus);

      const pageContentsPosition = await pageContents.evaluate((node) => getComputedStyle(node).position);
      expect(pageContentsPosition).toBe("static");

      const overflowWidth = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflowWidth).toBeLessThanOrEqual(2);

      const screenshot = await page.screenshot({ fullPage: false });
      await testInfo.attach(`${pageConfig.name}-place-mobile`, {
        body: screenshot,
        contentType: "image/png"
      });
    });
  }
});

test.describe("mobile filtered views", () => {
  for (const view of filteredViews) {
    test(`${view.name} keeps query state and layout stable`, async ({ page }, testInfo) => {
      await stabilizePage(page);

      await page.goto(view.path, { waitUntil: "networkidle" });
      await disableMotion(page);

      const root = page.locator(view.root);
      const summary = page.locator(view.summary);

      await expect(root).toBeVisible();
      await expect(summary).toContainText(view.expectedSummary);
      await expect(page).toHaveURL(new RegExp(view.expectedLocation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      if (view.name === "compare-filtered") {
        await expect(page.locator('select[name="compare_focus"]')).toHaveValue(view.expectedFocus);
        const visibleModels = await page
          .locator("[data-compare-item]:not([hidden])")
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-model") ?? ""));
        expect(visibleModels.length).toBeGreaterThan(0);
        expect(visibleModels.every((value) => value === "hotel-heavy")).toBe(true);
      }

      // hotels-filtered block removed — hotels page disabled

      if (view.name === "spending-filtered") {
        await expect(page.locator('select[name="money_route"]')).toHaveValue(view.expectedFocus);
        const visibleMoneyRows = await page
          .locator("[data-money-row]:not([hidden])")
          .evaluateAll((elements) =>
            elements.map((element) => ({
              route: element.getAttribute("data-route") ?? "",
              hasValue: element.getAttribute("data-has-value") ?? ""
            }))
          );
        expect(visibleMoneyRows.length).toBeGreaterThan(0);
        expect(visibleMoneyRows.every((row) => row.route === "asylum_support" && row.hasValue === "true")).toBe(
          true
        );
      }

      if (view.name === "entities-filtered") {
        await expect(page.locator('select[name="entity_role"]')).toHaveValue(view.expectedFocus);
        await expect(page.locator('select[name="entity_footprint"]')).toHaveValue("named_estate");
        const visibleEntityRows = await page
          .locator("[data-entity-item]:not([hidden])")
          .evaluateAll((elements) =>
            elements.map((element) => ({
              role: element.getAttribute("data-role") ?? "",
              currentSites: Number(element.getAttribute("data-current-sites") ?? "0")
            }))
          );
        expect(visibleEntityRows.length).toBeGreaterThan(0);
        expect(visibleEntityRows.every((row) => row.role === "prime_provider" && row.currentSites > 0)).toBe(true);
      }

      const overflowWidth = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflowWidth).toBeLessThanOrEqual(2);

      const screenshot = await page.screenshot({ fullPage: false });
      await testInfo.attach(`${view.name}-filtered-mobile`, {
        body: screenshot,
        contentType: "image/png"
      });
    });
  }
});

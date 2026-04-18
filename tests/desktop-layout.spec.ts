import { expect, test } from "@playwright/test";
import { disableMotion, limitToTopOfPage, stabilizePage, waitForFonts } from "./layout-helpers";

const shouldAssertScreenshots = !process.env.CI;

const desktopPages = [
  { name: "home", path: "/", focus: "#headline-stats", hasPageContents: false },
  { name: "places", path: "/places/", focus: "#place-search", hasPageContents: true },
  // north-west-region removed — page completely rewritten without priority-section pattern
  { name: "spending", path: "/spending/", focus: "#money-findings", hasPageContents: true },
  { name: "compare", path: "/compare/", focus: "#compare-findings", hasPageContents: true },
  { name: "routes", path: "/routes/", focus: "#route-findings", hasPageContents: true },
  { name: "entities", path: "/entities/", focus: "#entity-findings", hasPageContents: true },
  { name: "national", path: "/national/", focus: "#national-overview", hasPageContents: true },
  { name: "regional", path: "/regional/", focus: ".region-grid", hasPageContents: false },
  { name: "birmingham-place", path: "/places/birmingham/", focus: "#place-summary", hasPageContents: true }
] as const;

test.describe("desktop layout snapshots", () => {
  for (const pageConfig of desktopPages) {
    test(`${pageConfig.name} keeps the top-of-page hierarchy stable`, async ({ page }) => {
      await stabilizePage(page, { blockFonts: false });

      await page.goto(pageConfig.path, { waitUntil: "networkidle" });
      await waitForFonts(page);
      await disableMotion(page);
      await limitToTopOfPage(page, 5);

      const focusSection = page.locator(pageConfig.focus);

      await expect(page.locator("main")).toBeVisible();
      await expect(focusSection).toBeVisible();

      if (pageConfig.hasPageContents) {
        await expect(page.locator(".page-contents")).toBeVisible();
        await expect(page.locator(".page-contents-links a").first()).toHaveAttribute("href", pageConfig.focus);
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

      if (shouldAssertScreenshots) {
        await expect(page).toHaveScreenshot(`${pageConfig.name}-desktop.png`, {
          animations: "disabled",
          caret: "hide",
          fullPage: false,
          maxDiffPixelRatio: 0.04
        });
      }
    });
  }
});

test("home page renders hero and stats grid", async ({ page }) => {
  await stabilizePage(page, { blockFonts: false });

  await page.goto("/", { waitUntil: "networkidle" });
  await waitForFonts(page);
  await disableMotion(page);

  await expect(page.locator(".hero-section")).toBeVisible();
  await expect(page.locator(".hero-headline")).toBeVisible();
  await expect(page.locator("#headline-stats")).toBeVisible();
  await expect(page.locator(".sys-card")).toHaveCount(6);
  await expect(page.locator(".cost-item")).toHaveCount(3);
  await expect(page.locator("#your-area")).toBeVisible();
});

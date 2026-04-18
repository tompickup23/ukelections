import type { Page } from "@playwright/test";

export async function stabilizePage(page: Page, options?: { blockFonts?: boolean }) {
  if (options?.blockFonts ?? true) {
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  }
}

export async function waitForFonts(page: Page) {
  await page.evaluate(async () => {
    if (document.fonts) {
      await document.fonts.ready;
    }
  });
}

export async function disableMotion(page: Page) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    `
  });
}

export async function limitToTopOfPage(page: Page, keepTopLevelNodes = 5) {
  await page.addStyleTag({
    content: `
      main > :nth-child(n+${keepTopLevelNodes + 1}) {
        display: none !important;
      }
    `
  });
}

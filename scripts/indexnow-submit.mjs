import process from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SITE_URL = "https://ukelections.co.uk";
export const KEY = "a91c7dba7c9e4ce28d52336e9b1c76e9";

export function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function values(args, name) {
  return args.flatMap((arg, index) => arg === name && args[index + 1] ? [args[index + 1]] : []);
}

export function urlsFromSitemapXml(xml, cutoff) {
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?\s*<\/url>/g)]
    .filter(([, , lastmod]) => lastmod && lastmod >= cutoff)
    .map(([, url]) => url.replaceAll("&amp;", "&"));
}

export function validateUrls(urls, siteUrl = SITE_URL) {
  if (urls.length > 10_000) {
    throw new Error("IndexNow accepts at most 10,000 canonical URLs per notification.");
  }
  const unique = [...new Set(urls)];
  for (const value of unique) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`IndexNow URL is not absolute: ${value}`);
    }
    if (url.origin !== siteUrl || url.search || url.hash) {
      throw new Error(`IndexNow URL must be a same-host canonical URL without query or fragment: ${value}`);
    }
  }
  return unique;
}

function verifyPublicKeyFile(key) {
  const keyPath = resolve(process.cwd(), "public", `${key}.txt`);
  const published = readFileSync(keyPath, "utf8").trim();
  if (published !== key) throw new Error("The public IndexNow key file does not match the configured key.");
}

async function verifyLiveKey({ siteUrl, key, fetchImpl }) {
  const keyLocation = `${siteUrl}/${key}.txt`;
  const response = await fetchImpl(keyLocation, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok || (await response.text()).trim() !== key) {
    throw new Error(`The public verification file is not live at ${keyLocation}.`);
  }
}

async function urlsForArgs({ args, siteUrl, cutoff, fetchImpl }) {
  const manifest = option(args, "--file");
  if (manifest) return JSON.parse(readFileSync(resolve(process.cwd(), manifest), "utf8"));

  const localSitemap = option(args, "--sitemap-file");
  if (localSitemap) {
    return urlsFromSitemapXml(readFileSync(resolve(process.cwd(), localSitemap), "utf8"), cutoff);
  }
  if (args.includes("--sitemap")) {
    const sitemapUrl = `${siteUrl}/sitemap.xml`;
    const response = await fetchImpl(sitemapUrl);
    if (!response.ok) throw new Error(`Could not read ${sitemapUrl}: HTTP ${response.status}`);
    return urlsFromSitemapXml(await response.text(), cutoff);
  }
  return values(args, "--url");
}

export async function submitIndexNow({
  siteUrl = SITE_URL,
  key = KEY,
  args = process.argv.slice(2),
  fetchImpl = fetch,
} = {}) {
  if (args.includes("--help")) {
    console.log("Usage: node scripts/indexnow-submit.mjs [--dry-run] (--url URL ... | --file FILE | --sitemap | --sitemap-file FILE) [--lastmod YYYY-MM-DD]");
    console.log("Live submission additionally requires INDEXNOW_SUBMIT=1 and must run only after a successful production deploy.");
    return { submitted: false, urls: [], status: null };
  }

  const dryRun = args.includes("--dry-run");
  if (!dryRun && process.env.INDEXNOW_SUBMIT !== "1") {
    console.log("IndexNow disabled (use --dry-run locally, or set INDEXNOW_SUBMIT=1 after a successful production deploy).");
    return { submitted: false, urls: [], status: null };
  }

  verifyPublicKeyFile(key);
  const cutoff = option(args, "--lastmod") ?? new Date().toISOString().slice(0, 10);
  const urls = validateUrls(await urlsForArgs({ args, siteUrl, cutoff, fetchImpl }), siteUrl);
  if (!urls.length) {
    console.log(`IndexNow: no canonical URLs changed on or after ${cutoff}.`);
    return { submitted: false, urls, status: null };
  }

  if (dryRun) {
    console.log(`IndexNow dry run: validated ${urls.length} same-host canonical URL${urls.length === 1 ? "" : "s"}; no request sent.`);
    return { submitted: false, urls, status: null };
  }

  await verifyLiveKey({ siteUrl, key, fetchImpl });
  const response = await fetchImpl("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(siteUrl).host,
      key,
      keyLocation: `${siteUrl}/${key}.txt`,
      urlList: urls,
    }),
  });
  if (!response.ok) throw new Error(`IndexNow rejected ${urls.length} URLs: HTTP ${response.status}`);
  console.log(`IndexNow accepted ${urls.length} changed canonical URL${urls.length === 1 ? "" : "s"}: HTTP ${response.status}.`);
  return { submitted: true, urls, status: response.status };
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    await submitIndexNow();
  } catch (error) {
    // Search notification happens after deployment; log a transient failure
    // without turning an already successful production swap into a false
    // deployment failure.
    console.warn(`IndexNow warning: ${error instanceof Error ? error.message : String(error)}`);
  }
}

import { readFile } from "node:fs/promises";
import process from "node:process";

const SITE_URL = "https://ukelections.co.uk";
const KEY = "a91c7dba7c9e4ce28d52336e9b1c76e9";
const KEY_LOCATION = `${SITE_URL}/${KEY}.txt`;
const args = process.argv.slice(2);

if (process.env.INDEXNOW_SUBMIT !== "1") {
  console.log("IndexNow disabled (set INDEXNOW_SUBMIT=1 after production verification).");
  process.exit(0);
}

try {
  const urls = await urlsFromArgs(args);
  if (!urls.length) {
    console.log("IndexNow: no changed canonical URLs to notify.");
  } else {
    await assertLiveKey();
    for (const batch of chunk(urls, 10_000)) await notify(batch);
    console.log(`IndexNow notified of ${urls.length} changed canonical URL${urls.length === 1 ? "" : "s"}.`);
  }
} catch (error) {
  // A search-notification outage must not retrospectively fail an otherwise
  // verified production release. The cron log keeps the error actionable.
  console.warn(`IndexNow warning: ${error instanceof Error ? error.message : String(error)}`);
}

async function urlsFromArgs(argv) {
  const fileIndex = argv.indexOf("--file");
  const fromFile = fileIndex === -1 ? [] : JSON.parse(await readFile(argv[fileIndex + 1], "utf8"));
  const direct = argv.flatMap((arg, index) => arg === "--url" && argv[index + 1] ? [argv[index + 1]] : []);
  const urls = [...new Set([...fromFile, ...direct])];
  if (urls.some((url) => new URL(url).origin !== SITE_URL)) throw new Error("manifest contains a non-canonical host");
  return urls;
}

async function assertLiveKey() {
  const response = await fetch(KEY_LOCATION, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok || (await response.text()).trim() !== KEY) {
    throw new Error(`key file is not yet live at ${KEY_LOCATION}`);
  }
}

async function notify(urlList) {
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(SITE_URL).host, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });
  if (!response.ok) throw new Error(`IndexNow returned HTTP ${response.status}`);
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

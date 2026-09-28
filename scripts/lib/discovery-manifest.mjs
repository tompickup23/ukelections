import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse } from 'parse5';
const ORIGIN = 'https://ukelections.co.uk';
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
function nodes(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.childNodes || []) nodes(child, predicate, out);
  return out;
}
function visible(node) {
  if (['script', 'style', 'nav', 'footer'].includes(node.tagName) || attr(node, 'data-discovery-ignore') !== undefined) return '';
  if (node.nodeName === '#text') return node.value;
  const fields = node.namespaceURI === 'http://www.w3.org/2000/svg'
    ? ['aria-label', 'd', 'points', 'x', 'y', 'cx', 'cy', 'r', 'width', 'height', 'fill']
    : ['href', 'alt', 'aria-label'];
  const accessible = fields.map(k => attr(node, k) || '').join(' ');
  return ` ${accessible} ${(node.childNodes || []).map(visible).join(' ')} `;
}
/** Reader-visible content, title and description; excludes build assets and chrome. */
export function pageFingerprint(html, expectedUrl) {
  const doc = parse(html);
  const find = (tag) => nodes(doc, n => n.tagName === tag);
  const canonical = find('link').find(n => attr(n, 'rel') === 'canonical');
  if (attr(canonical || {}, 'href') !== expectedUrl) throw new Error(`Canonical mismatch: ${expectedUrl}`);
  const robots = find('meta').filter(n => ['robots', 'googlebot'].includes(attr(n, 'name')));
  if (robots.some(n => /noindex/i.test(attr(n, 'content') || ''))) throw new Error(`Not indexable: ${expectedUrl}`);
  const main = find('main')[0];
  if (!main) throw new Error(`Missing main content: ${expectedUrl}`);
  const description = find('meta').find(n => attr(n, 'name') === 'description');
  const ordered = value => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  const structured = find('script').filter(n => attr(n, 'type') === 'application/ld+json')
    .map(n => JSON.stringify(ordered(JSON.parse((n.childNodes || []).map(c => c.value || '').join(''))))).sort();
  const text = [visible(find('title')[0] || {}), attr(description || {}, 'content') || '', visible(main), ...structured]
    .join(' ').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(text).digest('hex');
}
export function planDiscovery(dist, previous = null) {
  const xml = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replaceAll('&amp;', '&'));
  const pages = {};
  for (const url of urls) {
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN || parsed.search || parsed.hash || !parsed.pathname.endsWith('/')) throw new Error(`Invalid sitemap URL: ${url}`);
    pages[url] = pageFingerprint(readFileSync(join(dist, parsed.pathname, 'index.html'), 'utf8'), url);
  }
  // A schema change or missing baseline establishes a baseline without submitting the site.
  const changed = previous?.version === 1 ? urls.filter(url => pages[url] !== previous.pages[url]) : [];
  return { version: 1, pages, changed, baselineOnly: previous?.version !== 1 };
}
export function readDiscoveryState(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
}
/** Call ONLY after deployment succeeds. Disabled runs do not build a submission backlog. */
export async function finishDiscovery({ plan, stateFile, enabled = false, submit }) {
  const old = readDiscoveryState(stateFile);
  const urls = enabled && !plan.baselineOnly ? [...new Set([...(old?.pending || []), ...plan.changed])].filter(u => plan.pages[u]) : [];
  const state = { version: 1, pages: plan.pages, pending: urls };
  atomicJson(stateFile, state); // retain pending work across a network failure
  if (!urls.length) return { submitted: false, urls };
  if (urls.length > 200) return { submitted: false, urls, reason: 'More than 200 changes; review this batch before submitting.' };
  try {
    const result = await submit(urls, plan.pages);
    if (result.submitted) atomicJson(stateFile, { ...state, pending: [] });
    return result;
  } catch (error) {
    return { submitted: false, urls, reason: String(error.message || error) };
  }
}

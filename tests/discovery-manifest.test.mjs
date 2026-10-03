import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pageFingerprint, planDiscovery, finishDiscovery, stampDiscoveryDates } from '../scripts/lib/discovery-manifest.mjs';
import { submitIndexNow } from '../scripts/indexnow-submit.mjs';
const origin = 'https://ukelections.co.uk';
const html = (route, text = 'Result: 10 votes', stamp = '2026-09-20', chrome = 'Old nav') => `<html><head><title>Election</title><link rel="canonical" href="${origin}${route}"><meta name="description" content="Result"></head><body><nav>${chrome}</nav><main><h1>Election</h1><p>${text}</p><span data-discovery-ignore>${stamp}</span><a href="/your-area/">Lookup</a></main></body></html>`;
describe('page discovery manifest', () => {
  it('ignores build dates and global chrome, but notices counts, source links and titles', () => {
    const url = origin + '/a/';
    const base = html('/a/');
    expect(pageFingerprint(base, url)).toBe(pageFingerprint(html('/a/', undefined, '2026-09-28', 'New nav'), url));
    for (const change of [base.replace('10 votes','11 votes'), base.replace('/your-area/', '/sources/'), base.replace('<title>Election','<title>New result')]) expect(pageFingerprint(change,url)).not.toBe(pageFingerprint(base,url));
    const schema = base.replace('</head>', '<script type="application/ld+json">{"@type":"WebPage"}</script></head>');
    expect(pageFingerprint(schema,url)).not.toBe(pageFingerprint(schema.replace('WebPage','Article'),url));
    expect(()=>pageFingerprint(base,origin+'/b/')).toThrow(/Canonical/);
    expect(()=>pageFingerprint(base.replace('</head>','<meta name="robots" content="noindex"></head>'),url)).toThrow(/indexable/);
  });
  it('creates a quiet baseline and selects only the one changed canonical route', () => {
    const root=mkdtempSync(join(tmpdir(),'uke-discovery-'));
    try {
      writeFileSync(join(root,'sitemap.xml'),`<urlset><url><loc>${origin}/a/</loc></url><url><loc>${origin}/b/</loc></url></urlset>`);
      for(const route of ['a','b']) { mkdirSync(join(root,route));writeFileSync(join(root,route,'index.html'),html(`/${route}/`)); }
      const first=planDiscovery(root);expect(first.changed).toEqual([]);expect(first.baselineOnly).toBe(true);
      writeFileSync(join(root,'a/index.html'),html('/a/','Result: 11 votes'));
      expect(planDiscovery(root,first).changed).toEqual([origin+'/a/']);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
  it('retains failed notifications for retry and never sends while disabled', async () => {
    const root=mkdtempSync(join(tmpdir(),'uke-discovery-'));
    const stateFile=join(root,'state.json'),url=origin+'/a/';
    const plan={version:1,pages:{[url]:'hash'},changed:[url]};
    const submit=vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValue({submitted:true});
    try {
      await finishDiscovery({plan,stateFile,enabled:true,submit});
      expect(JSON.parse(readFileSync(stateFile)).pending).toEqual([url]);
      await finishDiscovery({plan:{...plan,changed:[]},stateFile,enabled:true,submit});
      expect(submit).toHaveBeenCalledTimes(2);expect(JSON.parse(readFileSync(stateFile)).pending).toEqual([]);
      await finishDiscovery({plan,stateFile,enabled:false,submit});expect(submit).toHaveBeenCalledTimes(2);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
  it('requires review for batches over 200 URLs', async () => {
    const root=mkdtempSync(join(tmpdir(),'uke-discovery-'));const submit=vi.fn();
    const urls=Array.from({length:201},(_,i)=>`${origin}/${i}/`);
    try {const result=await finishDiscovery({plan:{pages:Object.fromEntries(urls.map(u=>[u,'hash'])),changed:urls},stateFile:join(root,'state.json'),enabled:true,submit});expect(result.reason).toMatch(/review/);expect(submit).not.toHaveBeenCalled();}
    finally{rmSync(root,{recursive:true,force:true});}
  });
  it('does not POST when production has a soft 404 or has not caught up', async () => {
    const previous=process.env.INDEXNOW_SUBMIT; process.env.INDEXNOW_SUBMIT='1';
    const {KEY}=await import('../scripts/indexnow-submit.mjs');
    try {
      for(const body of [html('/wrong/'),html('/a/','Old result')]) {
        const fetchImpl=vi.fn(async url=>String(url).endsWith('.txt')?new Response(KEY):new Response(body,{headers:{'content-type':'text/html'}}));
        await expect(submitIndexNow({args:['--url',origin+'/a/'],fetchImpl,expectedHashes:{[origin+'/a/']:pageFingerprint(html('/a/'),origin+'/a/')}})).rejects.toThrow();
        expect(fetchImpl.mock.calls.some(([,opts])=>opts?.method==='POST')).toBe(false);
      }
    } finally { if(previous===undefined)delete process.env.INDEXNOW_SUBMIT;else process.env.INDEXNOW_SUBMIT=previous; }
  });
});
describe('discovery dates', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'uke-dates-'));
    writeFileSync(join(root, 'sitemap.xml'), `<urlset>\n  <url>\n    <loc>${origin}/a/</loc>\n  </url>\n  <url>\n    <loc>${origin}/b/</loc>\n  </url>\n</urlset>\n`);
    for (const route of ['a', 'b']) { mkdirSync(join(root, route)); writeFileSync(join(root, route, 'index.html'), html(`/${route}/`)); }
    writeFileSync(join(root, 'rss.xml'), `<rss><channel>\n<item>\n<title>Old</title>\n<guid isPermaLink="false">urn:old</guid>\n</item>\n</channel></rss>\n`);
    return root;
  };
  const lastmods = (root) => Object.fromEntries([...readFileSync(join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map(m => [m[1], m[2] ?? null]));
  it('dates a route by the run that first deployed its current content, never the build clock', () => {
    const root = setup();
    try {
      const first = planDiscovery(root, null, '2026-10-01T04:40:00.000Z');
      expect(Object.values(first.changedAt)).toEqual([null, null]);
      stampDiscoveryDates(root, first);
      expect(lastmods(root)).toEqual({ [`${origin}/a/`]: null, [`${origin}/b/`]: null });

      writeFileSync(join(root, 'a/index.html'), html('/a/', 'Result: 11 votes'));
      const second = planDiscovery(root, first, '2026-10-02T04:40:00.123Z');
      expect(second.changedAt).toEqual({ [`${origin}/a/`]: '2026-10-02T04:40:00.123Z', [`${origin}/b/`]: null });

      const third = planDiscovery(root, second, '2026-10-03T04:40:00.000Z');
      expect(third.changed).toEqual([]);
      expect(third.changedAt[`${origin}/a/`]).toBe('2026-10-02T04:40:00.123Z');
      stampDiscoveryDates(root, third);
      expect(lastmods(root)).toEqual({ [`${origin}/a/`]: '2026-10-02T04:40:00Z', [`${origin}/b/`]: null });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('gives a feed item a pubDate only from the run that first published it', () => {
    const root = setup();
    try {
      const first = planDiscovery(root, null, '2026-10-01T04:40:00.000Z');
      const second = planDiscovery(root, first, '2026-10-02T04:40:00.000Z');
      expect(second.feedSeen).toEqual({ 'urn:old': null });
      writeFileSync(join(root, 'rss.xml'), `<rss><channel>\n<item>\n<title>New &amp; declared</title>\n<guid isPermaLink="false">urn:new&amp;1</guid>\n</item>\n<item>\n<title>Old</title>\n<guid isPermaLink="false">urn:old</guid>\n</item>\n</channel></rss>\n`);
      const third = planDiscovery(root, second, '2026-10-03T04:40:00.000Z');
      expect(third.feedSeen).toEqual({ 'urn:old': null, 'urn:new&1': '2026-10-03T04:40:00.000Z' });
      stampDiscoveryDates(root, third);
      const feed = readFileSync(join(root, 'rss.xml'), 'utf8');
      expect(feed).toContain('<guid isPermaLink="false">urn:new&amp;1</guid>\n<pubDate>Sat, 03 Oct 2026 04:40:00 GMT</pubDate>');
      expect(feed.match(/<pubDate>/g)).toHaveLength(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('keeps the dates in the saved state', async () => {
    const root = setup();
    try {
      const plan = planDiscovery(root, planDiscovery(root, null, '2026-10-01T00:00:00.000Z'), '2026-10-02T00:00:00.000Z');
      const stateFile = join(root, 'state.json');
      await finishDiscovery({ plan, stateFile, enabled: false, submit: vi.fn() });
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      expect(saved.changedAt).toEqual(plan.changedAt);
      expect(saved.feedSeen).toEqual({ 'urn:old': null });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

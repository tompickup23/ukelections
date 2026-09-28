import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import codes from '../data/identity/parliament-lookup-codes.json';
import { resolvePostcodeDestinations, searchElectionLookup, voterIntentLinks, type LookupEntry } from '../src/lib/electionLookup';
import { recentNewsArticles, validateEditorialRegistry, type EditorialArticle } from '../src/lib/editorial';
import { formatNextElection } from '../src/lib/siteData';
import { RELEASES, buildReleaseCollectionStructuredData } from '../src/lib/site';
import { GET as rss } from '../src/pages/rss.xml';

describe('lookup-only boundary crosswalk',()=>{
  it('accounts for all 650 unique official codes and resolves previously missing seats',()=>{
    const raw=readFileSync(codes.source);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(codes.source_sha256);
    const official=new Set(JSON.parse(raw.toString()).features.map((f:any)=>f.properties.PCON24CD));
    const entries=Object.values(codes.entries);expect(entries).toHaveLength(650);
    expect(new Set(entries.map(e=>e.code))).toEqual(official);
    const index: LookupEntry[]=Object.entries(codes.entries).map(([slug,seat])=>({kind:'constituency',name:seat.name,code:seat.code,href:`/seats/parliament/${slug}/`,secondary:'Constituency'}));
    const result=resolvePostcodeDestinations({codes:{parliamentary_constituency:'S14000060'}},{constituencies:index,wards:[]});
    expect(result[0].name).toBe('Aberdeen North');
  });
});
describe('area-first search',()=>{
  it('offers a relevant canonical destination for common voter questions',()=>{
    expect(voterIntentLinks('what elections are happening in 2027')[0].href).toBe('/elections/2027/');
    for(const query of ['who is my MP','who is my councillor','who is my mayor']) expect(voterIntentLinks(query)[0].href).toBe('/your-area/#representatives');
    expect(voterIntentLinks('2028')).toEqual([]);
    expect(voterIntentLinks('Burnley')).toEqual([]);
  });
  it('ranks exact entities above incidental matches and retains duplicate ward contexts',()=>{
    const entry=(name:string,secondary:string,href:string):LookupEntry=>({kind:'ward',name,secondary,href});
    const index={constituencies:[],councils:[entry('Burnley','Council','/seats/burnley/')],wards:[entry('North','Burnley ward','/seats/burnley/north/'),entry('Central','Town A ward','/seats/a/central/'),entry('Central','Town B ward','/seats/b/central/')]};
    expect(searchElectionLookup('Burnley',index)[0].href).toBe('/seats/burnley/');
    expect(searchElectionLookup('Central',index).map(x=>x.secondary)).toEqual(['Town A ward','Town B ward']);
    expect(searchElectionLookup('Unrepresented place',index)).toEqual([]);
  });
});
describe('publication provenance',()=>{
  const article:EditorialArticle={path:'/news/test/',title:'Test',summary:'Test summary',methodologyUrl:'https://ukelections.co.uk/methodology/',correctionsUrl:'https://ukelections.co.uk/contact/',author:{name:'Author',url:'https://example.org/author/'},firstPublishedAt:'2026-09-27T12:00:00Z',reviewedAt:'2026-09-27T11:00:00Z',reviewer:'Reviewer',primarySources:['https://example.gov.uk/result/']};
  const now=new Date('2026-09-28T12:00:00Z');
  it('uses original publication time and expires news after 48 hours',()=>{
    expect(recentNewsArticles([article],now)).toHaveLength(1);
    expect(recentNewsArticles([{...article,firstPublishedAt:'2026-09-25T12:00:00Z',modifiedAt:'2026-09-28T10:00:00Z',substantiveUpdate:'Corrected a count'}],now)).toEqual([]);
    for(const firstPublishedAt of ['2026-09-27','2026-10-01T12:00:00Z'])expect(()=>validateEditorialRegistry([{...article,firstPublishedAt}],now)).toThrow(/timestamp/);
    expect(()=>validateEditorialRegistry([{...article,path:'/by-elections/local/test/'}],now)).toThrow(/routes/);
    expect(()=>validateEditorialRegistry([{...article,primarySources:[]}],now)).toThrow(/source/);
  });
  it('omits unsupported RSS timestamps and uses unique release identities',async()=>{
    expect(new Set(RELEASES.map(r=>r.id)).size).toBe(RELEASES.length);
    const response=await (rss as any)({});const xml=await response.text();
    expect(xml).not.toContain('<pubDate>');
    const guids=[...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map(m=>m[1]);expect(new Set(guids).size).toBe(guids.length);
    expect(JSON.stringify(buildReleaseCollectionStructuredData(RELEASES,{canonicalUrl:'https://ukelections.co.uk/releases/',description:'Releases',socialImageUrl:'https://ukelections.co.uk/og-default.png'}))).not.toContain('NewsArticle');
  });
  it('does not promote stored cycle arithmetic to a verified election date',()=>{
    const unreviewed=formatNextElection({council_slug:'test',next_election:'2027-05-06',status:'scheduled'} as any);
    expect(unreviewed.date_iso).toBeNull();expect(unreviewed.status).toBe('expected');expect(unreviewed.checked_at).toBeNull();
    const burnley=formatNextElection({council_slug:'burnley'} as any);expect(burnley.label).toBe('May 2027 (scheduled)');expect(burnley.sources).toHaveLength(1);
  });
});

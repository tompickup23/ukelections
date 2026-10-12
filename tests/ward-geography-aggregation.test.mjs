import {it, expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
it('counts each neighbourhood once and selects one whole lookup vintage per ward',()=>{
  const output=execFileSync('python3',['-c',`
import importlib.util,json
spec=importlib.util.spec_from_file_location('agg','scripts/aggregate-lsoa-to-ward-demographics.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a={'wdcd':'A','wdnm':'Alpha','ladcd':'LA'}
b={'wdcd':'B','wdnm':'Beta','ladcd':'LA'}
lookups={'22':{'x':a,'y':a,'z':b},'23':{'x':a,'y':a},'25':{'x':a}}
tables={'ts021':{'x':{'total':100},'y':{'total':200},'z':{'total':50}}}
r=m.aggregate_wards(lookups,tables,{'x':{'decile':2},'y':{'decile':8}})
print(json.dumps(r))
`],{encoding:'utf8'});
  const r=JSON.parse(output);
  expect(r.A.totals.ts021.total).toBe(100); // not 700 (pooled) or 300 (union)
  expect(r.A.wd_year).toBe('25');
  expect(r.A.lsoa_count).toBe(1);
  expect(r.A.imd_sum/r.A.imd_count).toBe(2);
  expect(r.B.totals.ts021.total).toBe(50); // older ward remains covered
});
it('reconciles Myatts Fields to its six unique Census areas',()=>{
  // TS021 all-usual-residents cells, checked against the ONS source CSV.
  const population=[1601,1783,1606,1423,2315,1269].reduce((a,b)=>a+b,0);
  const d=JSON.parse(readFileSync('data/features/ward-demographics-2021.json','utf8')).wards.E05014107;
  expect(d.total_residents).toBe(population);
  expect(d.lsoa_count).toBe(6);
  expect(d.lookup_year).toBe('2025');
});

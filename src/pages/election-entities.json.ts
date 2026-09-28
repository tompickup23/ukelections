import type { APIRoute } from 'astro';
import { loadIdentity } from '../lib/predictions';
import codes from '../../data/identity/parliament-lookup-codes.json';
export const prerender = true;
export const GET: APIRoute = () => {
  const wards = loadIdentity().wards.filter(w => (w.tier === 'local' || w.tier === 'mayor') && w.ward_slug);
  const councils = [...new Map(wards.map(w => [w.council_slug, {
    kind: 'council', name: w.council_name, secondary: w.tier === 'mayor' ? 'Mayoralty' : 'Council', href: `/seats/${w.council_slug}/`,
  }])).values()];
  return new Response(JSON.stringify({
    constituencies: Object.entries(codes.entries).map(([slug, seat]) => ({kind:'constituency', name:seat.name, secondary:'Parliamentary constituency', href:`/seats/parliament/${slug}/`})),
    wards: wards.map(w => ({kind:'ward',name:w.ward_name || w.ward_slug,secondary:`${w.council_name} ward`,href:`/seats/${w.council_slug}/${w.ward_slug}/`})),
    councils,
  }), {headers:{'Content-Type':'application/json; charset=utf-8'}});
};

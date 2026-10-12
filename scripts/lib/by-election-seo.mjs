import { parse } from 'parse5';
const nodes = (node) => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(a=>a.name===name)?.value;
const visible = node => node.nodeName === '#text' ? node.value : ['script','style'].includes(node.tagName) ? '' : (node.childNodes || []).map(visible).join(' ');
/** Check the built page against its recorded result, not a second generated summary. */
export function auditByElectionMetadata(html, contest) {
  const all = nodes(parse(html));
  const title = visible(all.find(n=>n.tagName==='title') || {});
  const description = attr(all.find(n=>n.tagName==='meta' && attr(n,'name')==='description') || {}, 'content') || '';
  const text = visible(all.find(n=>n.tagName==='main') || {}).replace(/\s+/g,' ');
  const result = contest.result || contest.declaration;
  const declared = Boolean(contest.result?.declared || contest.declaration?.declared || (contest.status === 'concluded' && result));
  if (!declared) return [];
  const issues = [];
  if (!/\bresult\b/i.test(title)) issues.push('declared page title must say result');
  const winner = result.winner_candidate || result.winner_party || result.winner;
  if (winner && !description.includes(winner)) issues.push('result description must identify the recorded winner');
  if (/The seat is vacant|Who is defending it|votes on|result awaited|counts not published|candidates? (?:is|are) standing/i.test(text)) issues.push('declared page still uses pre-result wording');
  for (const n of all.filter(n=>n.tagName==='script' && attr(n,'type')==='application/ld+json')) {
    try { const schema = JSON.parse((n.childNodes || []).map(c=>c.value || '').join('')); if(schema['@type']==='Event') issues.push('declared page still advertises an upcoming event'); } catch { /* general SEO gate owns invalid JSON */ }
  }
  return issues;
}

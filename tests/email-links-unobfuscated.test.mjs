import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Cloudflare's Email Address Obfuscation rewrites every mailto link it serves
// on ukelections.co.uk, so the live page stops matching the build. The
// discovery step compares the two before it tells search engines a page has
// changed; the About page's two links made that comparison fail on every
// nightly run from 4 to 20 November 2026 and nothing was submitted. Cloudflare
// leaves a link alone when it sits between email_off comments.
function astroFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) astroFiles(path, out);
    else if (name.endsWith('.astro')) out.push(path);
  }
  return out;
}

describe('email links', () => {
  it('sit inside email_off comments so the served page matches the build', () => {
    const unguarded = [];
    for (const file of astroFiles('src')) {
      const source = readFileSync(file, 'utf8');
      const guarded = source.replace(/<!--email_off-->[\s\S]*?<!--\/email_off-->/g, '');
      if (/<a\b[^>]*href=[^>]*mailto:/.test(guarded)) unguarded.push(file);
    }
    expect(unguarded).toEqual([]);
  });
});

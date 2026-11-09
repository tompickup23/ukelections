# Council tax and council profile links on council seat pages (L3) | brief

**Do not build before 17 November 2026.** Results week first; the nightly publisher resets to `origin/main` and deploys whatever has merged, so this work neither starts nor opens a PR until then.

Prepared 9 November 2026 in Claude Code for a Codex build. Binding. It is the UK Elections instance of the template in UK Councils, `docs/SISTER-LINK-BRIEF-TEMPLATE.md` on branch `docs/sister-link-template` (read it with `git -C ~/ukcouncils show origin/docs/sister-link-template:docs/SISTER-LINK-BRIEF-TEMPLATE.md`). Where this brief and the template differ, this brief wins; where this repo's CLAUDE.md and either differ, CLAUDE.md wins, including its neutrality rules.

## 1. Authority

Decision 7, taken 9 November 2026: UK Elections council seat pages may carry a contextual line linking the council's page on UK Council Tax and on UK Councils. Council seat pages only, never ward pages or parliament pages. No footer change. The existing AI DOGE and UK Places cross links are untouched.

## 2. Parameters

| Parameter | Value |
|---|---|
| Repo and base | `ukelections` at `origin/main` `4c48f42a1b89a43c016665305dcdd956ee380d33`. Rebase onto the current `origin/main` on or after 17 November 2026 and rerun the dry run in section 5 before writing code |
| Worktree and branch | `~/wt/uke-links`, `feat/tax-site-links` |
| Route | `src/pages/seats/[council]/index.astro`, which renders `src/components/CouncilDetail.astro` (councils with a 7 May 2026 contest) or `src/components/CouncilStub.astro` (the rest). Both templates get the line. `src/pages/seats/[council]/[ward]/index.astro` does not |
| Pages built by that route | 360: 156 detail (council slugs of `local` and `mayor` wards in `data/identity/wards-may-2026.json`), 204 stub (records in `data/identity/council-next-elections.json` with a `lad24cd` and no such ward) |
| Join field | `data/identity/council-next-elections.json`, `councils[slug].lad24cd`, for both templates. Do not use `data/identity/council-slug-to-lad24.json` for this join: it covers only the 156 detail councils and carries the new Barnsley and Sheffield codes where the next elections file carries the old ones |
| Code aliases | `E08000016` to `E08000038` (Barnsley) and `E08000019` to `E08000039` (Sheffield). `src/lib/siteData.ts` already holds this pair as `AIDOGE_CODE_ALIASES` for the opposite direction; export one shared constant and use it in both places rather than writing a third copy |
| Name for the check | The name the H1 prints: `councilName` in `CouncilDetail.astro` (the wards file's `council_name`), `record.name` in `CouncilStub.astro`. On 9 November 2026 these equal the next elections file's `name` for every detail council |
| Name the line prints | The same H1 name |
| Placement | Detail: a cross link block after the UK Places block (`{ukPlacesLink && (...)}`) and before the "All councils" section, using the existing `dg-cross-link`, `dg-cross-inner`, `dg-cross-label` and `dg-cross-desc` classes, label "Council tax and the council". Stub: one `<li>` at the end of the "What you can do here" list, holding the same line |
| Known refusals | `surrey`, section 4 |
| Counts | 295 of 360 with the line (143 detail, 152 stub); 65 without: 32 Scottish (S12), 22 Welsh (W06), 10 with no `lad24cd` (East Surrey, East Sussex, Essex, Gloucestershire, Hampshire, Hertfordshire, Norfolk, Suffolk, West Surrey, West Sussex), 1 refused (`surrey`) |
| Unit test | `tests/tax-site-links.test.ts` |
| Dist check | A hard check in `scripts/audit-seo.mjs` (the rendered site gate the publisher runs as `node scripts/audit-seo.mjs dist`), with a failing fixture in `tests/audit-seo.test.ts`, as that file's header requires of every hard check |
| Text test | The unit test on the line string, and the new audit check refusing an em dash, en dash, their entities or a spaced hyphen inside the line. This repo has no published dash sweep of its own |
| Build hold | Not before 17 November 2026 |

## 3. The line

> Council tax bands and the 2026/27 Band D for Burnley on UK Council Tax; the council's profile on UK Councils.

Built from the crosswalk `year` and the H1 name, never typed. Links: "Burnley on UK Council Tax" to `https://ukcounciltax.co.uk/councils/burnley/`; "the council's profile on UK Councils" to `https://ukcouncils.co.uk/councils/burnley/`. Both URLs come from the crosswalk slug, which differs from this site's slug for seven councils (`bristol` is `bristol-city-of`, `herefordshire` is `herefordshire-county-of`, `kingston-upon-hull` is `kingston-upon-hull-city-of`, `kings-lynn-and-west-norfolk` is `king-s-lynn-and-west-norfolk`, `city-of-lincoln` is `lincoln`, `folkestone-and-hythe` is `shepway`, and the refused `surrey`). Never build a tax site URL from this site's slug.

No council tax figure on the page. The line is neutral information about the council, the same on every page.

**Reviewed links.** `data/identity/contextual-link-reviews.json` holds links reviewed one at a time (Burnley's AI DOGE link). These lines do not go through it: each is verified mechanically by the saved sitemaps, the GSS join and the name check, and the unit test and audit check enforce that on every build. Say so in one line of the PR body.

## 4. The Surrey refusal

`council-next-elections.json` record `surrey` is named "Surrey", status `abolished`, sourced to the Surrey (Structural Changes) Order 2026, SI 2026/264: the county council. Its `lad24cd` is `E07000214`, which is Surrey Heath. `council-slug-to-lad24.json` shows where it came from: `surrey` is one of three `fuzzy` matches in that file's "HP v7.0 area name match against DC council slugs" (generated 25 April 2026); the other two, `city-of-lincoln` and `kingston-upon-hull`, are right. A plain GSS join would print "Council tax bands and the 2026/27 Band D for Surrey on UK Council Tax" and link Surrey Heath. The name check refuses it ("Surrey" against "Surrey Heath" and "Surrey Heath Council"), and the unit test asserts it is the only refusal.

Surrey Heath has no council seat page of its own, so 295 is the count after this work. Correcting the `surrey` record's code is a data fix for its own PR, not this one: the same code is read by `src/components/CouncilControlMap.astro` and by the AI DOGE and UK Places candidates in `src/lib/siteData.ts` (the reviewed links file holds those back), and what they draw for Surrey was not checked here. Record it under follow ups in the PR body.

## 5. Join, as run on 9 November 2026

Crosswalk from UK Councils `151dc0f`, 296 English billing authorities; both sitemaps fetched 2026-11-09T10:02Z, 296 council URLs each, every crosswalk slug present in both.

| Step | Result |
|---|---|
| Council seat pages | 360 (156 detail, 204 stub) |
| Codes equal to a crosswalk code | 294 (including `surrey`) |
| Added by the Barnsley and Sheffield aliases | 2 |
| Name check refusals | 1 (`surrey`) |
| Joined | 295 (143 detail, 152 stub) |
| Crosswalk councils with no council seat page | 1 (Surrey Heath, `E07000214`) |
| Names that differ and pass | Bristol, City of Lincoln, Folkestone and Hythe (on the official name), London Borough of Hackney, Herefordshire, Kingston upon Hull, London Borough of Lewisham, London Borough of Newham, North Tyneside Council, Salford City Council, London Borough of Tower Hamlets, Watford Borough Council |

The plan's "296 of 3,796" counted the whole `/seats/` tree (ward and parliament pages included; not rebuilt here). The route this brief changes builds 360, and 295 join for the reason in section 4. Rerun this table after rebasing: the contest generator can add or drop detail councils, which moves pages between the two templates without changing the joined total unless a council gains or loses a code.

## 6. Data, tests and checks

Data and scripts as template section 4: `data/links/ukcounciltax-councils.json`, `data/links/ukcouncils-councils.json`, `data/links/tax-site-crosswalk.json`; `scripts/links/copy-tax-crosswalk.mjs <ukcouncils checkout>` and `scripts/links/fetch-tax-sitemaps.mjs`. Neither joins `scripts/publish-polling-update.mjs` or `refresh-pipeline.mjs`: a refresh is a deliberate run and a commit.

Unit test as template section 8, with this repo's numbers: 360 pages, 295 joined (143 detail, 152 stub), the 65 without broken down as in section 2, `surrey` the only refusal; Barnsley and Sheffield return links; Burnley's line string equals section 3 exactly.

Audit check in `scripts/audit-seo.mjs`: on every `seats/<council>/index.html` (not `seats/<council>/<ward>/` or `seats/parliament/`), exactly one link to the expected UK Council Tax URL and one to the UK Councils URL where the helper returns links, neither origin's `/councils/` links on the others; no such link on any ward page; no dash characters inside the line. Its fixture in `tests/audit-seo.test.ts` shows it failing on a page with the line missing and on a ward page carrying it.

Sources: one sentence on `src/pages/sources.astro`, as template section 11.

## 7. Gate

`npm test`, `npm run check`, `npm run build`, then `node scripts/audit-seo.mjs dist`. `BUILD_OG=1` is not needed to verify this change (the line is not on a card); say in the PR body which build was run. No horizontal scroll at 375 px on one detail page and one stub page with the line. Recount council seat pages in `dist/seats/` and report it.

## 8. Commits and PR

Four commits, in order: scripts and saved data; helper, shared alias constant and unit test; the line in both templates and the sources sentence; the audit check and its fixture. PR titled "Council tax and council profile links on council seat pages (L3)", opened on or after 17 November 2026, with the counts, the fetch time, the crosswalk commit, the Surrey follow up and 375 px captures of one detail and one stub page linked at a commit sha. End the body with "Built with Codex from a brief prepared in Claude Code." British English; no em dash, en dash or spaced hyphen, commit messages included; name no individual; stage named paths only; do not merge or deploy.

**Stop conditions:** template section 12, and any of: before 17 November 2026; the route builds other than 360 pages without a contest change that explains it; a refusal other than `surrey`; any line on a ward or parliament page.

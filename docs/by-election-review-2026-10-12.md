# By-election review — 12 October 2026

Local update prepared from origin/main `71df3b9`. No commit, push or deployment
was performed as part of this review. The live site remains unchanged until release.

## Checked results

| Poll on 8 October | Declared winner | Valid votes | Majority |
| --- | --- | ---: | ---: |
| Holborn and St Pancras | Sagal Abdi-Wali, Labour | 27,211 | 3,364 |
| Kilburn, Denby, Holbrook & Horsley, Amber Valley | Bess Saunders, Green | 2,287 | 57 |
| Myatt's Fields, Lambeth | Molly Hartill, Labour and Co-operative | 2,197 | 211 |
| Town, Newcastle-under-Lyme | Andrew Fox-Hewitt, Labour and Co-operative | 932 | 182 |
| Midstocket/Rosemount, Aberdeen | Jeff Diack, SNP | STV declaration | Not an FPTP margin |

### Primary evidence and reconciliation

- [Camden declaration](https://www.camden.gov.uk/holborn-and-st-pancras-by-election-2026-results): all 15 counts sum to 27,211 valid votes. Adding 108 rejected ballots gives 27,319 ballots. Council turnout is 38.76%. Camden gives Clare Fischer and Ben Walker 51 votes each; [Parliament](https://www.parliament.uk/business/news/2026/october-2026/sagal-abdi-wali-elected-as-member-of-parliament-for-holborn-and-st-pancras/) prints 54 each. Use the administering council and disclose the discrepancy on the page. Both agree on winner and majority.
- Amber Valley's [declaration](https://www.ambervalley.gov.uk/media/2363/declaration-of-result-of-poll-kilburn-denby-holbrook-horsley.pdf) gives five candidates, 2,287 valid votes and three rejected papers. Its [verification statement](https://www.ambervalley.gov.uk/media/2362/verification-statement-kilburn-denby-holbrook-horsley.pdf) gives 2,290 ballots from 6,678 electors, reconciling to 34.29% turnout. Former Conservative holding party is corroborated by the ALDC vacancy report and PollCheck, linked in the holder record.
- [Lambeth declaration](https://moderngov.lambeth.gov.uk/mgElectionAreaResults.aspx?ID=315&RPID=301356569): seven counts sum to the published 2,197 votes, with an electorate of 8,376. Seven rejected papers are retained from Democracy Club and explicitly distinguished from the council evidence. No turnout is inferred from an unexplained denominator.
- [Newcastle-under-Lyme declaration](https://www.newcastle-staffs.gov.uk/news/article/587/borough-council-by-election-result-declared): five counts sum to 932 valid votes; council confirms Labour gain from Reform UK and turnout of 23.2%. The 934 ballots, two rejected and 4,026 electorate fields come from Democracy Club, as stated in the record.
- [Aberdeen declaration](https://sites.aberdeencity.gov.uk/news/midstocketrosemount-aberdeen-city-council-ward-by-election-result): Jeff Diack elected under STV; 3,121 ballots and 26.5% turnout. The eight published first-preference counts sum to 3,088. The 33-ballot difference is unexplained in the article and is not labelled rejected ballots. No FPTP share, final margin or forecast grade is invented. SNP hold is separately corroborated by ALDC and PollCheck.

## Persistence and presentation

The three FPTP results are retained as hand-verified rows in the tracked history
sidecar. Aberdeen's declaration has a tracked override independent of the live
candidate feed. The generator must not treat complete STV first preferences as
a gradeable FPTP result. The local index now recognises existing declarations,
including nine older Scottish contests that incorrectly displayed “Awaited”.

The Holborn result replaces the pre-poll lead; the original ward signal remains
archived and is not counted as a successful forecast. The pre-poll builder exits
without overwriting a concluded record. Local grades use saved pre-poll snapshots.
Declared local contests no longer advertise stale forecast social cards.

Upcoming candidate fields and the newly listed Oldham Failsworth West contest
were refreshed from the production Democracy Club cache. Existing forecasts were
preserved. The model metadata was regenerated using the production history archive
plus the verified sidecar; its newest result date is now 8 October.

## Pre-deployment improvements

Result-specific titles and descriptions name the recorded winner and real margin;
STV declarations remain distinct. The hubs put recent results and upcoming polls
ahead of historical model analysis. Council/date filters include older records,
and the new year archive preserves existing URLs and states its coverage limits.

Weekly roundups run newest first and link matching individual contest pages.
The gains, holds and losses summary includes every recorded party. Saved pre-poll
forecasts (12 correct from 27 graded contests) are explicitly separated from the
239-contest retrospective backtest and the June–August forecaster comparison.

Breadcrumbs, 132 result social cards and archive sitemap entries are included.
Publication-ledger dates supply visible update dates and WebPage.dateModified
during publication; routine data refresh times cannot advance those dates.
New regression checks cover result metadata, STV presentation, source links,
all-party totals, card shares and stable publication dates.

## Validation

- 78 test files / 610 tests passed, including count arithmetic, snapshot grading,
  preservation of the Holborn result and a synthetic STV transfer-winner case.
- Astro check: zero errors and zero warnings; existing hints remain.
- Browser review: Holborn and all candidate counts; both hubs and the year archive;
  light and dark themes at desktop and 390px mobile widths. Council/date filters,
  combined filters, empty results, clearing and automatic expansion of matching
  older results passed. Wide tables scroll within their containers.
- The production build with the complete by-election OG scope passed: 3,988 pages
  generated and indexed by Pagefind. All 156 by-election pages have unique titles,
  one H1 and valid advertised image files; 132 advertise their own result card.
  Holborn, Amber Valley and Aberdeen STV card images were visually checked.
- Rendered SEO audit passed across all 3,988 pages, including the new stale-result
  hard gate. Final whitespace check passed. The final iteration build uses the
  supported default-image fallback; publication must use the normal publisher's
  BUILD_OG=1 with BUILD_OG_SCOPE unset to retain the whole site's social cards.

## Further detail-page fact check and fixes

The second review was verified against the rendered pages, input records and
source documents before editing:

- **Population duplication confirmed.** The four WD22–WD25 lookups assign the
  same six LSOAs to Myatt's Fields. Their TS021 all-usual-residents cells are
  1,601 + 1,783 + 1,606 + 1,423 + 2,315 + 1,269 = 9,997. The previous 39,988 was
  the same areas summed four times. This is a best-fit small-area aggregation,
  not an exact ward population. The page now says so and links the
  [ONS dataset](https://www.ons.gov.uk/datasets/TS021/editions/2021/versions/3).
  The builder selects the newest available complete lookup per ward code,
  retaining older codes only where needed. It never unions geography vintages.
- Rebuilt all six Census tables using the existing ONS CSV cache and the
  existing production IMD source cache. Across 8,732 populated ward records,
  7,175 population totals changed; **no stored percentage or IMD average
  changed**. Coverage remains 2,086 of 2,977 target wards. Refreshed 89 local
  contest profiles. Published forecasts and graded vote shares were not rerun.
  The input caches are configurable via UKE_CENSUS_CACHE and UKE_IMD_CACHE;
  the latter is required rather than silently erasing deprivation values.
- **Multi-seat labels confirmed missing:** 29 prior results recorded more than
  one elected candidate but omitted seats_contested. Restored the recorded
  elected count (67 records including single-seat cases) and fixed the
  generator. No baseline share or swing number was changed. Result summaries
  now explicitly say valid votes, keeping rejected ballots separate.
- **Clacton counts checked against Tendring's full published list:** all 34
  candidate counts agree and sum to 35,111 valid votes. The page now renders
  all 34, ranked by votes, with candidate names, ballot descriptions and
  valid-vote shares. The council's web list swaps the order of O'Brien and
  O'Keeffe relative to the stored declaration transcription; their counts are
  65 and 19 respectively, so the regression check is independent of ordering.
  [Official council list](https://www.tendringdc.gov.uk/news/clacton-by-election-result-declared-after-record-breaking-election).
- **Stale wording confirmed:** all 127 declared local pages used “are standing”.
  The template now uses past tense. Clacton's original call and analysis and
  Makerfield's frozen forecast remain intact inside labelled expandable
  archives; current results and full counts lead the pages.
- **Layout defects confirmed:** the old local template's undefined tokens
  produced zero table-cell padding. Aberdeen South measured 482px document
  width at a 390px viewport. Replaced the tokens, added native table captions,
  column-header scopes and keyboard-focusable scroll regions. Browser checks
  now show 390px document width on council, Aberdeen South, Clacton and
  Makerfield pages, including expanded archives.
- Added compact headings, direct section navigation, candidate vote shares,
  elected markers and shorter SEO text. The local result and candidate table
  now precede vacancy background and related-page links. Long names remain
  intact; 70 characters is an audit indicator, not a Google title-length rule.

New regression tests exercise repeated geography versions, changed membership,
older-code fallback, the Myatt's Fields source total, multi-seat metadata,
Clacton's full count vector and stale candidate wording. They are included in
release checks alongside the existing result and publication-date guards.

Final checks for the detail-page fixes: 610 tests pass; Astro check reports zero
errors and warnings; the 3,988-page build and rendered SEO gate pass. A separate
HTML audit verified all 156 by-election pages for unique titles, one H1 and valid
in-page anchors, and all 390 detail-page tables for captions and scroll wrappers.
There are 11 titles over 70 characters, down from 36 in the review; remaining long
place names are retained for clarity. No commit, push or deployment was performed.

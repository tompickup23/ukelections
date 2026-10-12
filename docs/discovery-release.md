# Search discovery release notes — 28 September 2026

## Local implementation

- The News register starts empty. Generated contests and changelog entries are not
  articles. See `data/editorial/README.md` for the editorial entry requirements.
- RSS omits unsupported publication times. Release GUIDs use permanent IDs.
- `data/identity/election-date-reviews.json` supplies reviewed date claims. The
  generated cycle table remains model context. Unreviewed dates are labelled as
  expected or unknown and have no purported source-check date. Add a primary
  source and retain the previous record in review history when changing a claim.
- The separate parliamentary lookup crosswalk accounts for all 650 ONS codes.
  It must not be copied into forecast inputs without a separate model review.
- Cross-site council links require an exact source-route/destination entry in
  `contextual-link-reviews.json`, plus an authoritative geographic match. Only
  Burnley → AI DOGE is retained from the council template after individual
  review. This is not an estate-wide link builder. Other portfolio opportunities
  need their own reader-purpose and source review.
- Published local contest files remain available when they leave the fetch
  window. A missed fetch is not a cancellation; deletions require an explicit
  redirect/archive decision. Recent result source reviews are carried from the
  protected history sidecar when its counts agree with the ingested result.

## Deployment and notification contract

`publish-polling-update.mjs` remains the production publisher. Its order is:
refresh → tests → build → rendered SEO gate → plan changed URLs → deploy immutable
snapshot → save deployed discovery state → optional notification.

The state file is `.cache/discovery/deployed.json` in the persistent publisher
checkout. The first successful deployment establishes a baseline and submits
nothing. Losing this file also establishes a quiet new baseline. `--no-deploy`
and failed deployments do not advance it. Preserve this directory across runs.

Fingerprinting uses each sitemap route's main content, title, description,
links, accessible labels, chart geometry and structured data. It excludes global navigation,
footer, asset scripts/styles and explicitly marked build-time text. Keep factual
polling dates, candidate counts and substantive source changes in the fingerprint.
Do not add `data-discovery-ignore` to substantive information.

IndexNow remains disabled unless the separately approved environment has
`INDEXNOW_SUBMIT=1`. The old inactive broad refresh no longer enables it itself.
After a successful deployment, enabled runs validate the live key and each URL:
HTTP 200 HTML, matching canonical, no noindex, and content matching the deployed
manifest. Soft 404s, redirects and stale production content fail closed.

Failed notifications remain pending and are retried once on the next successful
publication. The queue is deduplicated and filtered to current sitemap routes.
Batches over 1,000 URLs remain pending for manual review (`MAX_UNREVIEWED_BATCH`). The cap was 200 until October 2026; a polling refresh changes all 650 constituency pages, so every night exceeded it and nothing was ever sent. No historical bulk
bootstrap is supported. API acceptance is not proof of indexing or ranking.

Before authorising the first real notification, review the exact pending URL
file and a dry run. No submit request was sent during this implementation.

## Release validation and operating work

Local validation includes all tests, Astro checking, an isolated full build,
the rendered SEO gate, all-page canonical/robot comparisons, source-reviewed
results, preserved forecasts, lookup coverage and browser search journeys.
The local build uses the supported default OG fallback. A production release
must use the publisher's full OG build and an immutable snapshot.

Live release, IndexNow activation, Bing ownership/sitemap submission and
Cloudflare host/WAF changes require their separately scoped approval. The
existing Search Console and sampled analytics audit is the measurement baseline.
Real crawler-IP access is not proven by user-agent probes. Inspect actual CDN
request logs before claiming it is. Historical Search Console 404s need their
reported URL list before choosing redirects; do not redirect them all to home.

The canonical-host redirect is now active in Cloudflare as
`UK Elections www to canonical HTTPS` (28 September 2026): exact match
`http.host eq "www.ukelections.co.uk"`, target
`concat("https://ukelections.co.uk", http.request.uri.path)`, status 301,
query-string preservation enabled. Both HTTP and HTTPS deep-path probes retain
the path/query. The ineffective Pages host-source entry has been removed;
`/accuracy/` redirects remain unchanged. No DNS or WAF policy was changed.

## October 2026 additions

- Sitemap `lastmod` and RSS `pubDate` are written by the publisher, after the
  build and before deployment, from the discovery ledger
  (`stampDiscoveryDates`). A route is dated by the run that first deployed its
  current content; an RSS item by the run that first published it. Routes and
  items already live when dating began, and every route on a baseline run,
  stay undated. The build itself still emits neither.
- The ledger state gains `changedAt` and `feedSeen`. Losing the state file
  loses the dates as well as the fingerprints; the next run is a quiet,
  undated baseline.
- IndexNow has been enabled in the vps-main cron since 28 September 2026. The
  unreviewed batch cap is 1,000 (see above).

## By-election presentation update, 12 October 2026

- Declared council contests use result titles and descriptions naming the recorded
  winner. Upcoming and awaited contests have separate metadata. STV declarations
  use “STV result declared”; first preferences are never presented as an FPTP margin.
- The publisher stamps by-election `WebPage.dateModified` and the visible update
  date from the existing discovery ledger, alongside sitemap dates. A baseline
  with no recorded date remains undated. These output dates are excluded from
  fingerprints, so stamping cannot create a permanent update loop. Standalone
  Astro preview builds omit publication dates; the source-review date remains visible.
- The council hub has filters, two recent polling rounds, upcoming polls and
  expandable earlier results. Filters expand matching earlier results. With
  JavaScript disabled, controls stay hidden and all result links remain in HTML.
- `/by-elections/archive/` lists only years present in the coverage. Year pages
  retain individual contests and source-linked roundup-only records, explicitly
  labelled as incomplete historical coverage. Existing contest URLs are unchanged.
- Saved pre-poll forecasts are counted separately from retrospective model
  reconstructions. The weekly roundup shows every recorded party alphabetically.
- All recorded results have per-page OG entries. Normal publisher builds include
  them with `BUILD_OG=1`; `BUILD_OG_SCOPE=by-elections` can limit a local QA build
  to the result-card set. Leave that scope unset for a production release.
- The rendered SEO gate rejects stale local result metadata or upcoming Event
  markup on declared contests. The publisher test subset includes the new
  presentation and ledger-date regression tests.

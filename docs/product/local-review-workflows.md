# Local Review Workflows

The local audit now emits a review workflow bundle for every area still held out of publication.

Run:

```bash
npm run build:local-audit -- --output /tmp/ukelections-local-upstreams
```

Outputs:

- `/tmp/ukelections-local-upstreams/data-audit.json`
- `/tmp/ukelections-local-upstreams/review-workflows.json`
- `/tmp/ukelections-local-upstreams/review-workflows.md`

Then execute the source-acquisition pass:

```bash
npm run execute:review-workflows -- \
  --workflows /tmp/ukelections-local-upstreams/review-workflows.json \
  --output /tmp/ukelections-local-upstreams/review-workflow-execution.json \
  --markdown-output /tmp/ukelections-local-upstreams/review-workflow-execution.md \
  --raw-dir /tmp/ukelections-local-upstreams/raw-review-sources
```

Execution outputs:

- immutable raw source files under `/tmp/ukelections-local-upstreams/raw-review-sources`;
- source snapshots with SHA-256 hashes;
- per-area evidence status showing whether all source targets were fetched;
- promotion blockers that remain after acquisition.

Then verify the fetched and linked evidence against every review area:

```bash
npm run verify:review-workflows -- \
  --workflows /tmp/ukelections-local-upstreams/review-workflows.json \
  --execution /tmp/ukelections-local-upstreams/review-workflow-execution.json \
  --output /tmp/ukelections-local-upstreams/review-workflow-evidence.json \
  --markdown-output /tmp/ukelections-local-upstreams/review-workflow-evidence.md \
  --linked-raw-dir /tmp/ukelections-local-upstreams/raw-review-linked-sources
```

Verification outputs:

- linked official result pages discovered from council index pages;
- text extraction metadata for HTML and PDF sources;
- per-area confirmation that the area name appears in official or linked evidence;
- remaining blockers separating source discovery from accepted model-input rows.

Use `--crawl-linked-sources` only when a source target is an index page that cannot be replaced with a deterministic official result URL. Prefer direct official declaration, detailed ward-results, or PDF URLs in `data/local-review-source-targets.example.json` because generic council crawls can be slow and can pick up non-result pages.

Then turn the verified evidence into a row-level import manifest:

```bash
npm run build:review-import-manifest -- \
  --evidence /tmp/ukelections-local-upstreams/review-workflow-evidence.json \
  --output /tmp/ukelections-local-upstreams/review-import-manifest.json \
  --markdown-output /tmp/ukelections-local-upstreams/review-import-manifest.md
```

Import manifest outputs:

- the primary source and transformation route for every review area;
- acceptance checks that must pass before any official history rows are accepted;
- workflow-specific artifacts still required for promotion, such as notional boundary history, candidate/incumbency features, or a second current-boundary contest.

## Workflow Classes

| Workflow | Blocks publication because | Required evidence |
| --- | --- | --- |
| `investigate_vote_share_failure` | Vote-share error is too high or the local political break is not explained. | Official result rows, current-boundary or notional history, candidate/incumbency context, and a rerun passing strong elected-party validation. |
| `repair_winner_signal` | Vote-share or competitive-party calibration is usable, but elected-party validation is not. | Official elected flags, candidate rosters, party-label checks, incumbency/defending-party evidence, and another current-boundary contest where available. |
| `build_boundary_notional_history` | The area has one usable current-boundary contest and older rows are quarantined by boundary change. | LGBCE final recommendations, ONS codes, predecessor-boundary mappings, and official or documented notional results. |
| `wait_or_add_second_contest` | Only one current-boundary contest exists. | Another official result, or a reviewed notional comparator with documented method. |
| `extend_temporal_validation` | A limited temporal backtest exists but is not strong enough for publication. | Additional historical contests, official result declarations, or reviewed notional rows that increase leave-one-out validation. |

## Current Review Queue

The latest local run has 51 review areas:

- `P0`: 1 area needing vote-share failure investigation.
- `P1`: 23 areas needing boundary-notional history or winner-signal repair.
- `P2`: 27 areas needing more temporal validation or another current-boundary contest.

The source targets file at `data/local-review-source-targets.example.json` maps these workflows to official council pages, LGBCE boundary review evidence, ONS electoral code evidence, and verified secondary discovery sources.

Promotion rule: an area must leave the review workflow, pass through `elected_party_hit_rate`, carry `strong` backtest evidence, have `publication_gate: "publishable"`, and have no blockers or readiness tasks. Do not promote an area just because a vote-share-only or one-contest backtest looks plausible.

Fetching every source target is necessary but not sufficient. The fetched evidence still has to be parsed into reviewed official history, boundary-lineage, candidate, or notional rows before the publishable count can legitimately rise.

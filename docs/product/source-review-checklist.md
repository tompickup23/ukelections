# Source Review Checklist

Use this before promoting any source into a public UK Elections mart. It applies to public feeds and internal sources such as AI DOGE, Labour tracker, and UKD-derived demographic exports.

## Review Record

- Source name:
- Source owner or upstream publisher:
- Source type: `primary`, `verified_secondary`, `internal`, or `context`
- Licence:
- Retrieved at:
- Raw file path:
- SHA-256:
- Row count:
- Reviewer:
- Decision: `accepted`, `accepted_with_warnings`, or `quarantined`

## Required Checks

1. Licence and attribution are clear enough for public use.
2. The source URL or internal origin is recorded.
3. Raw data is immutable and hashable.
4. Rows contain stable area identifiers where possible.
5. Area names have a normalisation rule and preserve the original label.
6. Election type, date, authority, and geography generation are explicit.
7. Candidate rows preserve original party labels and normalised party labels.
8. Result rows preserve votes, rank, elected status, electorate, and turnout when available.
9. Derived demographic, deprivation, fiscal, or polling fields have transformation notes.
10. Known gaps and manual edits are listed in `review_notes`.

## AI DOGE And UKD Review

AI DOGE Burnley and Lancashire modelling is useful as the first internal pilot because it already combines ward-level election history, candidate availability, incumbency, UKD demographics, deprivation, and polling assumptions. Do not publish it directly until these points are resolved:

- Confirm each election result row against local authority, LEAP/Open Council Data/DCLEAPIL, or another named source.
- Separate borough ward histories from county division histories.
- Confirm the candidate list for the target borough election from Democracy Club or official statements of persons nominated.
- Record UKD demographic source version, field definitions, geography level, and any projection method.
- Store model parameters as a versioned snapshot, not only in code.
- Backtest the borough method separately from the county method.

## Labour Tracker Review

Labour tracker sources are most useful for constituency profile pages and provenance workflow. Treat them as context sources unless the data is directly required for an election model.

- Parliament Members API, Commons Votes, Hansard, IPSA, Electoral Commission finance, Companies House, and Register of Members' Financial Interests need source URLs and retrieval timestamps.
- Do not mix political-context signals into forecasts until the signal is defined, reviewed, and backtested.
- Keep profile claims separate from model features.

## Borough Election Gate

A borough forecast can move from `internal` to `review` only when:

- current borough wards are matched to official ward codes;
- wards up and defending councillors are known;
- candidates are sourced;
- the borough history baseline is available or the missing-history caveat is explicit;
- county results are marked as a feature rather than the baseline;
- demographic joins are reviewed at ward level;
- the model run records `input_snapshot_id`, `model_version`, and generated timestamp.

## County And Unitary Gate

County and unitary forecasts need their own gate:

- county models use divisions, not borough wards;
- unitary models identify whether the contest uses wards, divisions, all-out, halves, thirds, or STV;
- any predecessor-boundary mapping has weights and a mapping source;
- local-cycle retained seats and defending seats are represented before seat totals are aggregated.

# UK Places election-route plan

Status: proposed follow-on work, 11 September 2026. This is a planning record only; it does not authorise implementation, publication, deployment, forecasting, or a data refresh.

## Purpose

UK Elections should remain the detailed election product. UK Places should provide a neutral route from a local-authority or constituency geography record to the relevant UK Elections record, without reproducing election data or creating a political league table.

## Product shape

1. Keep the council route as the detailed destination for current control, chamber composition, ward results, next-election status, sources and accuracy information.
2. Keep the parliamentary-constituency route as the detailed destination for the result, representation and any forecast that meets the site's publication requirements.
3. Make the route from each supported UK Places record explicit and stable, with a clear action label such as "Explore election record".
4. Supply UK Places only with confirmed canonical destinations and a source snapshot date when the source contract supports one.

## Boundaries and neutrality

- Do not make a cross-council political ranking. Council election cycles, authority types and source cohorts differ, so such a table would imply comparability that may not exist.
- Do not use a party-specific acquisition feature. The route must preserve the site's strict-neutrality rules and surface the detailed record rather than a selective political headline.
- Do not expose a forecast through UK Places unless it has the required uncertainty, model version, input snapshot and publication timestamp.
- Preserve explicit boundary and reorganisation caveats. Where a next election is not confirmed, retain the existing honest unavailable state.

## UK Places hand-off

The integration remains link-only on UK Places. Its existing single UK Elections signal may continue to identify the detailed source record, but it must not gain a second election figure, a prediction, a ranking or copied party bars. The detailed record, sources and any later updates remain on UK Elections.

## Acceptance checks before implementation is considered complete

- every UK Places election destination resolves to the confirmed UK Elections route;
- local-authority and constituency routes are distinguished correctly;
- an absent or unconfirmed route is represented as unavailable, not guessed;
- live copy stays neutral and retains its source/update context; and
- the relevant test, check and build commands pass without publishing a deployment.

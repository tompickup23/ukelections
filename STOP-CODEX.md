# Codex paused — do not run autonomous Codex sessions on this repo

**Pause start:** 2026-04-25
**Pause end:** 2026-05-08 (post-election)
**Reason:** Tom directive — Claude takes control to ship national May 2026 coverage in 12 days.

Last Codex commit on `main`: `9920019` (2026-04-22).

## What Codex must not do

- Open new commits on `main` or any branch in this repo
- Spawn new review workflows
- Add new lib modules, scripts, or schemas
- Refetch or restructure existing data

## What Claude is doing instead

See `.claude/plans/ukelections-finish.md` in `~/clawd/`. National scope (England + Wales May 7 2026), 12-day push.

## Resume conditions

After 2026-05-08, Codex may resume importer work for Stage 3 (HoC Library 2024, Boundary-Line, Senedd / Holyrood post-election) per the same plan doc.

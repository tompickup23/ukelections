# Codex pause lifted — 2026-05-08

The pause originally ran 2026-04-25 through 2026-05-08 for the May 7 launch push.
Pause ended on schedule.

Last Claude-led campaign on this repo (concluded 2026-05-19): site-wide
elevation campaign — design tokens + dark mode + race-bar components +
per-place mini-maps + Pagefind search + Satori OG cards. See `CLAUDE.md`
for the current architecture snapshot.

## If you're Codex picking this back up

- Source of truth: `main` on `tompickup23/ukelections`.
- Architecture summary: `CLAUDE.md`.
- Design rules: `AGENTS.md` (12 rules, including "data is the visual" + "use tokens" + "verify in both modes").
- Shared components live in `src/components/`. Don't reimplement; extend.
- OG card pipeline is gated behind `BUILD_OG=1`. Iteration builds skip it.
- Boundary data committed at `data/geography/` — three GeoJSONs (PCON24, LAD24, WD25) + their raw sources + the static-weight TTFs in `data/fonts/`.

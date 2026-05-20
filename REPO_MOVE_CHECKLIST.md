# Repo identity move — UKE / UKD / AS

Prepared 2026-05-20 alongside the multi-tier UKE backlog sweep. **This work
is opt-in for Tom — nothing here has been committed beyond this checklist
file.** The GitHub UI steps must be done manually; the follow-up code edits
are listed below for a fast cleanup pass once the new org name is chosen.

## Why move

All three repos currently sit at `github.com/tompickup23/<repo>`. The
sister-site copy on each has been anonymised ("an independent X project"
rather than "by Tom Pickup"), but the public Git URLs and repo metadata
still expose Tom's personal handle. Moving to a non-personal organisation
brings the public-facing identity in line with the rest of the
anonymisation work landed 19-20 May.

## Step 1 — pick an org name

Suggested handles (any will work; just need one un-taken on GitHub):

- `ukelections-project`
- `ukpoliticsdata`
- `aidoge-public` (links the family to the AI DOGE brand)
- `independent-election-research`

Once you've picked, take note: it'll appear in every clone URL forever.

## Step 2 — create the org

GitHub → top-right avatar → **Your organizations** → **New organization** → Free
plan → set the slug to the chosen name. Email + display name don't have to be
personal.

## Step 3 — transfer the repos

For each repo (`ukelections`, `ukdemographics`, `asylumstats`):

1. Open repo → **Settings** → scroll to **Danger Zone** → **Transfer ownership**
2. Target the new org. Confirm with the repo name.
3. GitHub automatically rewrites the URL but adds a 301 redirect from the old
   path. **Don't delete the old path** — anything that still has the old URL
   (commit links in older PRs, my memory files, external bookmarks) will
   continue resolving via the redirect.

## Step 4 — update local clones

For each repo on Mac AND on vps-main:

```bash
cd ~/ukelections   # or ukdemographics, or asylumstats
git remote set-url origin git@github.com:<new-org>/<repo>.git
git remote -v   # verify
```

## Step 5 — update source code references

The following files contain literal `tompickup23/<repo>` URLs that should
be rewritten to point at the new org. Search-and-replace `tompickup23` →
`<new-org>` in each:

### UK Elections (`~/ukelections`)
- `src/pages/transparency/index.astro`
- `src/pages/by-elections/makerfield/index.astro`
- `src/pages/methodology/national-model/index.astro`
- `src/pages/past-results/indicators/index.astro`
- `src/pages/past-results/may-2025/index.astro`
- `src/pages/coverage/index.astro`
- Anywhere `tompickup23.github.io/lancashire/lancashirecc/` appears — this is
  a data-source URL, NOT an authorship URL, and may need to stay as-is
  unless that data is also rehosted.

### UK Demographics (`~/clawd/ukdemographics` or vps-main clone)
- `src/data/live/source-scope.json` — `tompickup23.github.io/lancashire/...`
  links. Same caveat as above.

### Asylum Stats (`~/clawd/asylumstats` or vps-main clone)
- Already fully anonymised in the 19-20 May sweep — no `tompickup23` refs
  in `src/`, but double-check at move time.

## Step 6 — Cloudflare Pages reconnect

If any of the three projects use **Cloudflare Pages → Git integration** for
auto-deploy, the connection needs to be re-pointed at the new org:

| Project | Project name | Custom domain | Current integration |
|---------|--------------|---------------|---------------------|
| UKE     | `ukelections` | `ukelections.co.uk` | Git Provider: **No** (manual wrangler deploy) |
| UKD     | `ukdemographics` | `ukdemographics.co.uk` | Git integration |
| AS      | `asylumstats` | `asylumstats.co.uk` | Git integration |

UKE deploys manually so it survives the move untouched.

For UKD and AS:
1. Cloudflare dash → **Workers & Pages** → project → **Settings** → **Builds & deployments**
2. Disconnect the existing GitHub integration
3. Reconnect, selecting the new org + repo
4. Verify auto-deploy on the next push

## Step 7 — verify

- `gh repo view <new-org>/ukelections` returns the repo
- `https://github.com/tompickup23/ukelections` redirects to the new path
- Clone of the new URL builds clean on Mac + vps-main
- One push lands a deployment in CF Pages
- All `tompickup23/<repo>` literal URLs in source have been rewritten

## What this is NOT

- Not a project rebrand — `ukelections.co.uk`, `ukdemographics.co.uk`,
  `asylumstats.co.uk` all stay the same.
- Not an attribution scrub — README/footer/methodology text was already
  anonymised in the 19-20 May sweep; this only addresses the public Git URL.
- Not a license change — repos stay under whatever license they already
  carry (or stay private if that's their current state).

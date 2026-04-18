# Deployment

UK Elections is currently deployed as a scaffold while `ukelections.co.uk` is pending purchase and DNS setup.

## Repositories and environments

- GitHub repository: `https://github.com/tompickup23/ukelections`
- GitHub Pages placeholder: `https://tompickup23.github.io/ukelections/`
- Cloudflare Pages project: `ukelections`
- Cloudflare Pages placeholder: `https://ukelections.pages.dev/`
- Production domain target: `https://ukelections.co.uk/`

## Current deployment path

The initial Cloudflare Pages deployment was created from a local build, then uploaded through `wrangler` on `vps-main` using the existing Cloudflare environment in `/opt/dashboard/.env`.

```sh
npm run build
rsync -az --delete dist/ vps-main:/tmp/ukelections-dist/
ssh vps-main 'set -a; . /opt/dashboard/.env; set +a; wrangler pages deploy /tmp/ukelections-dist --project-name ukelections --branch main'
```

## Domain setup

After `ukelections.co.uk` is registered, attach it to the Cloudflare Pages project and point DNS at Cloudflare Pages from the same Cloudflare account used on `vps-main`.

Keep `astro.config.mjs` set to `https://ukelections.co.uk` so canonical URLs and social metadata are already aligned with the intended production domain.

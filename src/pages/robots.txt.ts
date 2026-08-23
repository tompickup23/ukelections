import type { APIRoute } from "astro";
import { SITE_URL } from "../lib/site";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\nSitemap: ${SITE_URL}/sitemap-news.xml\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });

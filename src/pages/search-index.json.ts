import type { APIRoute } from "astro";
import { getPublicSearchEntries } from "../lib/site";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(JSON.stringify(getPublicSearchEntries()), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });

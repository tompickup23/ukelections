import type { APIRoute } from "astro";
import { loadAreaAnswerData } from "../lib/areaLookupData";

export const prerender = true;
export const GET: APIRoute = () =>
  new Response(JSON.stringify(loadAreaAnswerData()), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });

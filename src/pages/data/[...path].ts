/** Serve a deliberately small allowlist of generated polling artefacts. */
import type { APIRoute, GetStaticPaths } from "astro";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLISHED_DATA, contentTypeFor } from "../../lib/publishedData";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () =>
  PUBLISHED_DATA.map((file) => ({ params: { path: file.path } }));

export const GET: APIRoute = ({ params }) => {
  const entry = PUBLISHED_DATA.find((file) => file.path === params.path);
  if (!entry) return new Response("Not found", { status: 404 });
  return new Response(readFileSync(path.join(process.cwd(), "data", entry.path)), {
    headers: {
      "Content-Type": contentTypeFor(entry.path),
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
};

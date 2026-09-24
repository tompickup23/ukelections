/** Serve an explicit allowlist of repository data files as static assets. */
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

  const body = readFileSync(path.join(process.cwd(), "data", entry.path));
  return new Response(body, {
    headers: {
      "Content-Type": contentTypeFor(entry.path),
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
};

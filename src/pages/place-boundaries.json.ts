import fs from "node:fs/promises";
import path from "node:path";

import type { APIRoute } from "astro";

const dataPath = path.resolve(process.cwd(), "src/data/live/place-boundaries.json");

export const GET: APIRoute = async () => {
  const body = await fs.readFile(dataPath, "utf8");

  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600"
    }
  });
};

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,mjs,js}"],
    // Several suites call loadIdentity()/loadGePredictions(), which read tens of
    // MB of JSON off disk on first use. That is ~5s on an idle Mac — right on
    // vitest's 5s default — and 20s+ on vps-main while the nightly pipeline is
    // doing anything else. It gates the production deploy via step 8 of
    // scripts/refresh-pipeline.mjs, so a timeout there blocks the whole nightly
    // build. Raise the budget rather than let a loaded machine fail the deploy.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

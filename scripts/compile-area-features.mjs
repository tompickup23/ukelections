#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { compileAreaFeatureSnapshot } from "./lib/area-feature-compiler.mjs";

const areaCode = process.argv[2] || "E05000000";
const boundaries = JSON.parse(readFileSync("data/boundary-versions.example.json", "utf8"));
const history = JSON.parse(readFileSync("data/election-history.example.json", "utf8"));
const pollAggregate = JSON.parse(readFileSync("data/poll-aggregate.example.json", "utf8"));
const existingFeature = JSON.parse(readFileSync("data/model-features.example.json", "utf8"))[0];
const boundaryVersion = boundaries.find((boundary) => boundary.area_code === areaCode) || boundaries[0];

const compiled = compileAreaFeatureSnapshot({
  area: { area_code: boundaryVersion.area_code, area_name: boundaryVersion.area_name },
  modelFamily: existingFeature.model_family,
  boundaryVersion,
  historyRecords: history,
  pollAggregate,
  asylumContext: existingFeature.features.asylum_context,
  populationProjection: existingFeature.features.population_projection,
  provenance: existingFeature.provenance,
  asOf: existingFeature.as_of
});

console.log(JSON.stringify(compiled, null, 2));

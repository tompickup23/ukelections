#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { aggregatePolls } from "./lib/poll-aggregation.mjs";

const pollsPath = process.argv[2] || "data/poll-aggregate.example.json";
const input = JSON.parse(readFileSync(pollsPath, "utf8"));
const polls = Array.isArray(input) ? input : input.polls;

const aggregate = aggregatePolls(polls, {
  generatedAt: process.env.GENERATED_AT,
  geography: process.env.POLL_GEOGRAPHY || input.geography,
  population: process.env.POLL_POPULATION || input.population,
  halfLifeDays: process.env.POLL_HALF_LIFE_DAYS ? Number(process.env.POLL_HALF_LIFE_DAYS) : input.half_life_days,
  reviewStatus: "unreviewed"
});

console.log(JSON.stringify(aggregate, null, 2));

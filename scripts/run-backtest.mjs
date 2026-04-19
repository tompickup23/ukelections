#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runBacktest } from "./lib/backtest-runner.mjs";

const predictionPath = process.argv[2] || "data/prediction-output.example.json";
const historyPath = process.argv[3] || "data/election-history.example.json";

const result = runBacktest(
  JSON.parse(readFileSync(predictionPath, "utf8")),
  JSON.parse(readFileSync(historyPath, "utf8"))
);

console.log(JSON.stringify(result, null, 2));

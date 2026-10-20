import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { editCases, type EditCase } from "./fixtures.ts";
import {
  checkAdherence,
  judgeEdit,
  runRewriteStrategy,
  runSurgicalStrategy,
  sentencePreservation,
  validateFormat,
  wordJaccard,
  type EditStrategy,
  type StrategyResult,
} from "./strategies.ts";

type CaseResult = {
  strategy: EditStrategy;
  caseId: string;
  target: string;
  result: StrategyResult;
  formatOk: boolean;
  formatProblems: string[];
  adherenceOk: boolean;
  adherenceProblems: string[];
  judge?: { adherence: number; preservation: number; notes: string };
  judgeError?: string;
  wordJaccard: number;
  sentencePreservation: number;
  outputChars: number;
};

const apiKey: string = process.env.DEEPSEEK_API_KEY?.trim() ?? "";

if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is required.");
  process.exit(1);
}

const runs = Math.max(1, Number(process.argv[2] ?? 2));
const strategies: EditStrategy[] = ["rewrite", "surgical"];

async function evaluateCase(
  strategy: EditStrategy,
  testCase: EditCase,
): Promise<CaseResult> {
  const result =
    strategy === "rewrite"
      ? await runRewriteStrategy({ apiKey, testCase, temperature: 0.2 })
      : await runSurgicalStrategy({ apiKey, testCase, temperature: 0.2 });

  if (!result.ok) {
    return {
      strategy,
      caseId: testCase.id,
      target: testCase.target,
      result,
      formatOk: false,
      formatProblems: [result.error ?? "Generation failed."],
      adherenceOk: false,
      adherenceProblems: [],
      wordJaccard: 0,
      sentencePreservation: 0,
      outputChars: 0,
    };
  }

  const format = validateFormat(testCase.target, result.content, testCase);
  const adherence = checkAdherence(testCase, result.content);
  const entry: CaseResult = {
    strategy,
    caseId: testCase.id,
    target: testCase.target,
    result,
    formatOk: format.ok,
    formatProblems: format.problems,
    adherenceOk: adherence.ok,
    adherenceProblems: adherence.problems,
    wordJaccard: wordJaccard(testCase.content, result.content),
    sentencePreservation: sentencePreservation(
      testCase.content,
      result.content,
    ),
    outputChars: result.content.length,
  };

  try {
    entry.judge = await judgeEdit({ apiKey, testCase, edited: result.content });
  } catch (unknownError) {
    entry.judgeError =
      unknownError instanceof Error ? unknownError.message : "Judge failed.";
  }

  return entry;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(entries: CaseResult[], strategy: EditStrategy) {
  const rows = entries.filter((entry) => entry.strategy === strategy);

  return {
    strategy,
    runs: rows.length,
    successRate: average(rows.map((row) => (row.result.ok ? 1 : 0))),
    formatRate: average(rows.map((row) => (row.formatOk ? 1 : 0))),
    adherenceRate: average(rows.map((row) => (row.adherenceOk ? 1 : 0))),
    judgeAdherence: average(rows.map((row) => row.judge?.adherence ?? 0)),
    judgePreservation: average(rows.map((row) => row.judge?.preservation ?? 0)),
    wordJaccard: average(rows.map((row) => row.wordJaccard)),
    sentencePreservation: average(rows.map((row) => row.sentencePreservation)),
    avgLatencyMs: average(rows.map((row) => row.result.latencyMs)),
    avgRetries: average(rows.map((row) => row.result.retries)),
    avgOutputChars: average(rows.map((row) => row.outputChars)),
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function main() {
  const entries: CaseResult[] = [];

  for (let run = 1; run <= runs; run += 1) {
    for (const testCase of editCases) {
      for (const strategy of strategies) {
        process.stderr.write(
          `run ${run}/${runs}  ${strategy.padEnd(8)}  ${testCase.id}\n`,
        );
        entries.push(await evaluateCase(strategy, testCase));
      }
    }
  }

  const summaries = strategies.map((strategy) => summarize(entries, strategy));

  console.log("\n## Aggregate\n");
  console.log(
    "| Strategy | Success | Format | Det. adherence | Judge adherence | Judge preservation | Word Jaccard | Sentence preservation | Latency | Retries |",
  );
  console.log(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const summary of summaries) {
    console.log(
      `| ${summary.strategy} | ${percent(summary.successRate)} | ${percent(
        summary.formatRate,
      )} | ${percent(summary.adherenceRate)} | ${summary.judgeAdherence.toFixed(
        2,
      )}/5 | ${summary.judgePreservation.toFixed(2)}/5 | ${summary.wordJaccard.toFixed(
        2,
      )} | ${percent(summary.sentencePreservation)} | ${Math.round(
        summary.avgLatencyMs,
      )}ms | ${summary.avgRetries.toFixed(2)} |`,
    );
  }

  console.log("\n## Per case\n");
  console.log(
    "| Case | Strategy | OK | Format | Adherence | Judge A/P | Jaccard | Sentences | Latency | Notes |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of entries) {
    const notes = [
      ...entry.formatProblems,
      ...entry.adherenceProblems,
      ...(entry.result.error ? [entry.result.error] : []),
      ...(entry.judgeError ? [entry.judgeError] : []),
    ]
      .join("; ")
      .replace(/\|/g, "/")
      .slice(0, 160);

    console.log(
      `| ${entry.caseId} | ${entry.strategy} | ${
        entry.result.ok ? "yes" : "no"
      } | ${entry.formatOk ? "yes" : "no"} | ${
        entry.adherenceOk ? "yes" : "no"
      } | ${entry.judge ? `${entry.judge.adherence}/${entry.judge.preservation}` : "-"} | ${entry.wordJaccard.toFixed(
        2,
      )} | ${percent(entry.sentencePreservation)} | ${entry.result.latencyMs}ms | ${notes} |`,
    );
  }

  const outputPath = join(
    tmpdir(),
    `character-card-edit-ab-${Date.now()}.json`,
  );
  writeFileSync(outputPath, JSON.stringify({ summaries, entries }, null, 2));
  console.log(`\nRaw results: ${outputPath}`);
}

await main();

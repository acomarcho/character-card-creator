import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText } from "ai";

import {
  buildOpeningFormatRepairPrompt,
  buildOpeningMessageSystemPrompt,
  buildOpeningMessageUserPrompt,
  stripAsterisks,
} from "../lib/reference-prompts.ts";
import {
  firstHeaderLine,
  hasPresetColors,
  hasPresetHeader,
  validateOpeningFormat,
} from "../lib/opening-format.ts";
import {
  formattingOffCase,
  openingFormatCases,
  type OpeningFormatCase,
} from "./opening-format-fixtures.ts";
import { weatherConsistent } from "./checks.ts";

const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";

if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is required.");
  process.exit(1);
}

const runs = Math.max(1, Number(process.argv[2] ?? 3));
const provider = createDeepSeek({ apiKey });

type Judge = {
  headerScene: number;
  colors: number;
  prose: number;
  notes: string;
};

type RunResult = {
  caseId: string;
  run: number;
  formatting: boolean;
  ok: boolean;
  error?: string;
  output: string;
  latencyMs: number;
  repairUsed: boolean;
  repairSucceeded: boolean;
  initialProblems: string[];
  formatOk: boolean;
  formatProblems: string[];
  timeOk: boolean;
  locationOk: boolean;
  monthOk: boolean;
  weatherOk: boolean;
  weatherConsistencyOk: boolean;
  colorsOk: boolean;
  distinctColors: number;
  mustOk: boolean;
  judge?: Judge;
  judgeError?: string;
};

function countDistinctColors(output: string): number {
  const colors = new Set<string>();

  for (const match of output.matchAll(
    /<font\s+color="#([0-9A-Fa-f]{6})"\s*>/g,
  )) {
    colors.add(match[1].toUpperCase());
  }

  return colors.size;
}

async function generateFormattedOpening(
  testCase: OpeningFormatCase,
  formatting: boolean,
): Promise<{
  output: string;
  latencyMs: number;
  repairUsed: boolean;
  repairSucceeded: boolean;
  initialProblems: string[];
}> {
  const startedAt = Date.now();
  const system = buildOpeningMessageSystemPrompt({
    presetFormatting: formatting,
  });
  const prompt = buildOpeningMessageUserPrompt({
    characterName: testCase.characterName,
    characterCard: testCase.characterCard,
    openingContext: testCase.openingContext,
  });

  const first = await generateText({
    model: provider("deepseek-chat"),
    system,
    prompt,
    temperature: 0.7,
  });

  let output = stripAsterisks(first.text);
  let repairUsed = false;
  let repairSucceeded = false;
  let initialProblems: string[] = [];

  if (formatting) {
    initialProblems = validateOpeningFormat(output).problems;

    if (initialProblems.length > 0) {
      repairUsed = true;

      try {
        const repair = await generateText({
          model: provider("deepseek-chat"),
          system,
          prompt: buildOpeningFormatRepairPrompt(prompt, initialProblems, output),
          temperature: 0.7,
        });
        const repaired = stripAsterisks(repair.text);
        repairSucceeded = validateOpeningFormat(repaired).ok;
        output = repaired;
      } catch {
        // Production keeps the first output when the repair call fails.
      }
    }
  }

  return {
    output,
    latencyMs: Date.now() - startedAt,
    repairUsed,
    repairSucceeded,
    initialProblems,
  };
}

async function judge(
  testCase: OpeningFormatCase,
  output: string,
  formatting: boolean,
): Promise<Judge> {
  const result = await generateText({
    model: provider("deepseek-chat"),
    system:
      "You grade SillyTavern opening messages. Return JSON only with integer scores from 1 to 5. " +
      'Shape: {"headerScene":1-5,"colors":1-5,"prose":1-5,"notes":"short reason"}',
    prompt: [
      `Character card:\n${testCase.characterCard}`,
      "",
      `Opening context:\n${testCase.openingContext}`,
      "",
      `Opening message:\n${output}`,
      "",
      formatting
        ? [
            "Score these dimensions:",
            "headerScene = does the header describe the same moment as the story (time, place, weather), and is the date an in-scene date rather than the real-world current date? If the narration shows rain, snow, fog or sun, the header weather must agree.",
            "colors = is every spoken line wrapped in a palette color tag, does each speaker have a unique color, and is narration uncolored?",
            "prose = does this still work as a good opening: one moment, character voice, no control of {{user}}?",
          ].join("\n")
        : "The user turned formatting off. Score headerScene as 5 if there is no header, colors as 5 if there are no color tags, and prose on its own merits.",
    ].join("\n"),
    temperature: 0,
  });

  const match = result.text.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error("Judge returned no JSON.");
  }

  const parsed = JSON.parse(match[0]) as Partial<Judge>;

  return {
    headerScene: Number(parsed.headerScene) || 0,
    colors: Number(parsed.colors) || 0,
    prose: Number(parsed.prose) || 0,
    notes: parsed.notes ?? "",
  };
}

async function evaluateCase(
  testCase: OpeningFormatCase,
  run: number,
  formatting: boolean,
): Promise<RunResult> {
  try {
    const generation = await generateFormattedOpening(testCase, formatting);
    const header = firstHeaderLine(generation.output);
    const format = formatting
      ? validateOpeningFormat(generation.output)
      : { ok: true, problems: [] };
    const distinctColors = countDistinctColors(generation.output);
    const mustOk = (testCase.mustInclude ?? []).every((pattern) =>
      pattern.test(generation.output),
    ) && !(testCase.mustNotInclude ?? []).some((pattern) =>
      pattern.test(generation.output),
    );

    const result: RunResult = {
      caseId: testCase.id,
      run,
      formatting,
      ok: true,
      output: generation.output,
      latencyMs: generation.latencyMs,
      repairUsed: generation.repairUsed,
      repairSucceeded: generation.repairSucceeded,
      initialProblems: generation.initialProblems,
      formatOk: formatting
        ? format.ok
        : !hasPresetHeader(generation.output) &&
          !hasPresetColors(generation.output),
      formatProblems: format.problems,
      timeOk: formatting
        ? testCase.expectedTime.test(header)
        : !hasPresetHeader(generation.output),
      locationOk: formatting
        ? testCase.expectedLocation.test(header)
        : !hasPresetHeader(generation.output),
      monthOk: formatting
        ? (testCase.expectedMonth?.test(header) ?? true)
        : !hasPresetHeader(generation.output),
      weatherOk: formatting
        ? (testCase.expectedWeather?.test(header) ?? true)
        : !hasPresetHeader(generation.output),
      weatherConsistencyOk: formatting
        ? weatherConsistent(header, generation.output)
        : true,
      colorsOk: formatting
        ? distinctColors >= testCase.minDistinctColors
        : !hasPresetColors(generation.output),
      distinctColors,
      mustOk,
    };

    try {
      result.judge = await judge(testCase, generation.output, formatting);
    } catch (unknownError) {
      result.judgeError =
        unknownError instanceof Error ? unknownError.message : "Judge failed.";
    }

    return result;
  } catch (unknownError) {
    return {
      caseId: testCase.id,
      run,
      formatting,
      ok: false,
      error:
        unknownError instanceof Error
          ? unknownError.message
          : "Generation failed.",
      output: "",
      latencyMs: 0,
      repairUsed: false,
      repairSucceeded: false,
      initialProblems: [],
      formatOk: false,
      formatProblems: [],
      timeOk: false,
      locationOk: false,
      monthOk: false,
      weatherOk: false,
      weatherConsistencyOk: false,
      colorsOk: false,
      distinctColors: 0,
      mustOk: false,
    };
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function summarize(entries: RunResult[], formatting: boolean) {
  const rows = entries.filter((entry) => entry.formatting === formatting);

  return {
    formatting,
    runs: rows.length,
    successRate: average(rows.map((row) => (row.ok ? 1 : 0))),
    formatRate: average(rows.map((row) => (row.formatOk ? 1 : 0))),
    timeRate: average(rows.map((row) => (row.timeOk ? 1 : 0))),
    locationRate: average(rows.map((row) => (row.locationOk ? 1 : 0))),
    monthRate: average(rows.map((row) => (row.monthOk ? 1 : 0))),
    weatherRate: average(rows.map((row) => (row.weatherOk ? 1 : 0))),
    weatherConsistencyRate: average(
      rows.map((row) => (row.weatherConsistencyOk ? 1 : 0)),
    ),
    colorsRate: average(rows.map((row) => (row.colorsOk ? 1 : 0))),
    mustRate: average(rows.map((row) => (row.mustOk ? 1 : 0))),
    judgeHeaderScene: average(rows.map((row) => row.judge?.headerScene ?? 0)),
    judgeColors: average(rows.map((row) => row.judge?.colors ?? 0)),
    judgeProse: average(rows.map((row) => row.judge?.prose ?? 0)),
    repairRate: average(rows.map((row) => (row.repairUsed ? 1 : 0))),
    repairSuccessRate: average(
      rows.filter((row) => row.repairUsed).map((row) => (row.repairSucceeded ? 1 : 0)),
    ),
    avgLatencyMs: average(rows.map((row) => row.latencyMs)),
  };
}

async function main() {
  const entries: RunResult[] = [];

  for (let run = 1; run <= runs; run += 1) {
    for (const testCase of openingFormatCases) {
      process.stderr.write(
        `run ${run}/${runs}  on   ${testCase.id}\n`,
      );
      entries.push(await evaluateCase(testCase, run, true));
    }

    process.stderr.write(`run ${run}/${runs}  off  ${formattingOffCase.id}\n`);
    entries.push(await evaluateCase(formattingOffCase, run, false));
  }

  const summaries = [summarize(entries, true), summarize(entries, false)];

  console.log("\n## Aggregate\n");
  console.log(
    "| Mode | Runs | Success | Format | Time | Location | Month | Weather | Weather match | Colors | Must | Judge header/scene | Judge colors | Judge prose | Repair used | Repair success | Latency |",
  );
  console.log(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );

  for (const summary of summaries) {
    console.log(
      `| ${summary.formatting ? "on" : "off"} | ${summary.runs} | ${percent(
        summary.successRate,
      )} | ${percent(summary.formatRate)} | ${percent(
        summary.timeRate,
      )} | ${percent(summary.locationRate)} | ${percent(
        summary.monthRate,
      )} | ${percent(summary.weatherRate)} | ${percent(
        summary.weatherConsistencyRate,
      )} | ${percent(summary.colorsRate)} | ${percent(
        summary.mustRate,
      )} | ${summary.judgeHeaderScene.toFixed(
        2,
      )}/5 | ${summary.judgeColors.toFixed(2)}/5 | ${summary.judgeProse.toFixed(
        2,
      )}/5 | ${percent(summary.repairRate)} | ${percent(
        summary.repairSuccessRate,
      )} | ${Math.round(summary.avgLatencyMs)}ms |`,
    );
  }

  console.log("\n## Per case\n");
  console.log(
    "| Case | Run | Mode | OK | Format | Time | Location | Month | Weather | Weather match | Colors | Must | Judge H/C/P | Repair | Notes |",
  );
  console.log(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );

  for (const entry of entries) {
    const notes = [
      ...(entry.repairUsed && entry.initialProblems.length > 0
        ? [`Initial: ${entry.initialProblems.join(" ")}`]
        : []),
      ...entry.formatProblems,
      ...(entry.error ? [entry.error] : []),
      ...(entry.judgeError ? [entry.judgeError] : []),
    ]
      .join("; ")
      .replace(/\|/g, "/")
      .slice(0, 180);
    const judge = entry.judge
      ? `${entry.judge.headerScene}/${entry.judge.colors}/${entry.judge.prose}`
      : "-";

    console.log(
      `| ${entry.caseId} | ${entry.run} | ${entry.formatting ? "on" : "off"} | ${
        entry.ok ? "yes" : "no"
      } | ${entry.formatOk ? "yes" : "no"} | ${
        entry.timeOk ? "yes" : "no"
      } | ${entry.locationOk ? "yes" : "no"} | ${
        entry.monthOk ? "yes" : "no"
      } | ${entry.weatherOk ? "yes" : "no"} | ${
        entry.weatherConsistencyOk ? "yes" : "no"
      } | ${entry.colorsOk ? "yes" : "no"} | ${
        entry.mustOk ? "yes" : "no"
      } | ${judge} | ${
        entry.repairUsed
          ? entry.repairSucceeded
            ? "fixed"
            : "failed"
          : "-"
      } | ${notes} |`,
    );
  }

  const outputPath = join(
    process.env.TMPDIR ?? "/tmp/opencode",
    `opening-format-eval-${Date.now()}.json`,
  );
  writeFileSync(outputPath, JSON.stringify({ summaries, entries }, null, 2));
  console.log(`\nRaw results: ${outputPath}`);
}

await main();

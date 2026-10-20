import assert from "node:assert/strict";

import {
  characterCardFixture,
  openingMessageFixture,
} from "../evals/fixtures.ts";

const baseUrl = process.env.APP_URL ?? "http://localhost:3010";
const apiKey: string = process.env.DEEPSEEK_API_KEY?.trim() ?? "";

if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is required.");
  process.exit(1);
}

type StreamEvent =
  | { type: "status"; phase: string; message: string }
  | { type: "text-delta"; delta: string }
  | { type: "reset-output" }
  | { type: "done"; output: string; usedWebTools: boolean }
  | { type: "error"; error: string };

async function edit(payload: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/edit-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deepseekApiKey: apiKey, ...payload }),
  });

  const text = await response.text();
  assert.equal(response.ok, true, text);
  const events = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StreamEvent);

  return events;
}

function doneOutput(events: StreamEvent[]): string {
  const done = events.find((event) => event.type === "done");

  assert.ok(done && done.type === "done", "No done event in the stream.");
  return done.output;
}

function tags(content: string): string[] {
  return Array.from(
    content.matchAll(/<(\/?)([^/\n>][^>\n]*)>/g),
    (match) => `${match[1]}${match[2]}`,
  );
}

async function main() {
  const cardEvents = await edit({
    target: "character-card",
    content: characterCardFixture,
    instruction:
      "Add a detail that she secretly loves pandas. Keep it consistent with her personality.",
    characterName: "Sae Niijima",
  });
  const cardOutput = doneOutput(cardEvents);

  assert.match(cardOutput, /panda/i);
  assert.ok(cardOutput.trimStart().startsWith("<setting>"));
  assert.deepEqual(tags(cardOutput), tags(characterCardFixture));
  assert.ok(cardOutput.includes("{{char}}"));
  assert.ok(!cardOutput.includes("```"));
  assert.ok(
    !cardEvents.some(
      (event) =>
        event.type === "status" && /web-search|web search|Exa/i.test(event.message),
    ),
    "Edit should not connect web tools.",
  );

  const openingEvents = await edit({
    target: "opening-message",
    content: openingMessageFixture,
    instruction: "Add that heavy rain is hitting the office windows.",
    characterName: "Sae Niijima",
    characterCard: characterCardFixture,
  });
  const openingOutput = doneOutput(openingEvents);

  assert.match(openingOutput, /rain/i);
  assert.ok(!openingOutput.includes("*"));
  assert.ok(openingOutput.split(/\n\s*\n/).filter(Boolean).length <= 3);

  const emptyInstruction = await fetch(`${baseUrl}/api/edit-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deepseekApiKey: apiKey,
      target: "character-card",
      content: "Some card",
      instruction: "   ",
    }),
  });
  assert.equal(emptyInstruction.status, 400);

  const emptyContent = await fetch(`${baseUrl}/api/edit-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deepseekApiKey: apiKey,
      target: "character-card",
      content: "   ",
      instruction: "Add pandas.",
    }),
  });
  assert.equal(emptyContent.status, 400);

  console.log("Card edit:", cardOutput.slice(0, 160).replace(/\n/g, " "));
  console.log("Opening edit:", openingOutput.slice(0, 160).replace(/\n/g, " "));
  console.log("Integration edit checks passed.");
}

await main();

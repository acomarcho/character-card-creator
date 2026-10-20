import assert from "node:assert/strict";
import { test } from "node:test";

import type { GenerationStreamEvent } from "../lib/ai-generation.ts";
import {
  createEditStream,
  type EditGenerator,
} from "../lib/edit-generation.ts";

const CARD = "<setting>\nTokyo.\n</setting>";

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<GenerationStreamEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: GenerationStreamEvent[] = [];
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        events.push(JSON.parse(line) as GenerationStreamEvent);
      }
    }
  }

  return events;
}

function doneOutput(events: GenerationStreamEvent[]): string {
  const done = events.find((event) => event.type === "done");

  assert.ok(done && done.type === "done", "expected a done event");
  return done.output;
}

test("retries once after an unapplicable edit and then succeeds", async () => {
  const prompts: string[] = [];
  let call = 0;

  const generate: EditGenerator = async ({ prompt }) => {
    prompts.push(prompt);
    call += 1;

    if (call === 1) {
      return [{ find: "Not in the card", replace: "x" }];
    }

    return [{ find: "Tokyo", replace: "Osaka" }];
  };

  const events = await collect(
    createEditStream(
      {
        apiKey: "test",
        target: "character-card",
        content: CARD,
        instruction: "Change the city.",
      },
      generate,
    ),
  );

  assert.match(doneOutput(events), /Osaka/);
  assert.ok(
    events.some(
      (event) => event.type === "status" && event.message === "Retrying edit...",
    ),
  );
  assert.ok(prompts[1].includes("not found"));
});

test("retries after a structural validation failure", async () => {
  let call = 0;

  const generate: EditGenerator = async () => {
    call += 1;

    if (call === 1) {
      return [{ find: "<setting>", replace: "<settings>" }];
    }

    return [{ find: "Tokyo", replace: "Kyoto" }];
  };

  const events = await collect(
    createEditStream(
      {
        apiKey: "test",
        target: "character-card",
        content: CARD,
        instruction: "Rename the setting tag.",
      },
      generate,
    ),
  );

  const output = doneOutput(events);
  assert.match(output, /Kyoto/);
  assert.ok(output.startsWith("<setting>"));
});

test("sanitizes the replacement but leaves untouched opening text alone", async () => {
  const content = "Rain fell. *Sae looked up.*";

  const generate: EditGenerator = async () => [
    { find: "Rain", replace: "*Snow*" },
  ];

  const events = await collect(
    createEditStream(
      {
        apiKey: "test",
        target: "opening-message",
        content,
        instruction: "Change rain to snow.",
      },
      generate,
    ),
  );

  const output = doneOutput(events);
  assert.match(output, /^Snow fell\./);
  assert.ok(output.includes("*Sae looked up.*"));
  assert.ok(!output.includes("*Snow*"));
});

test("emits an error when both attempts fail", async () => {
  const generate: EditGenerator = async () => [
    { find: "Not in the card", replace: "x" },
  ];

  const events = await collect(
    createEditStream(
      {
        apiKey: "test",
        target: "character-card",
        content: CARD,
        instruction: "Nope.",
      },
      generate,
    ),
  );

  assert.ok(!events.some((event) => event.type === "done"));
  const error = events.find((event) => event.type === "error");

  assert.ok(error && error.type === "error");
  assert.match(error.error, /not found/);
});

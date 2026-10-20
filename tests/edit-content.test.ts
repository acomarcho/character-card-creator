import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applySurgicalEdits,
  buildEditSystemPrompt,
  buildEditUserPrompt,
  validateEditedContent,
} from "../lib/edit-content.ts";

const CARD = [
  "<setting>",
  "Tokyo.",
  "</setting>",
  "",
  "<{{char}}'s overview>",
  "Sae, 24, a prosecutor. She loves {{user}}.",
  "</{{char}}'s overview>",
  "",
  "<{{char}}'s personality>",
  "- Cold.",
  "</{{char}}'s personality>",
].join("\n");

const OPENING = [
  "Rain hit the window. Sae looked up.",
  "",
  '"Sit," she said.',
].join("\n");

test("applySurgicalEdits replaces an exact unique span", () => {
  const result = applySurgicalEdits(CARD, [
    { find: "Cold.", replace: "Cold but secretly soft." },
  ]);

  assert.equal(result.ok, true);
  assert.ok(result.ok && result.content.includes("Cold but secretly soft."));
  assert.ok(result.ok && !result.content.includes("\n- Cold.\n"));
});

test("applySurgicalEdits supports deletion", () => {
  const result = applySurgicalEdits(CARD, [
    { find: "Sae, 24, a prosecutor. ", replace: "" },
  ]);

  assert.equal(result.ok, true);
  assert.ok(result.ok && result.content.includes("She loves {{user}}."));
});

test("applySurgicalEdits applies multiple edits in order", () => {
  const result = applySurgicalEdits(CARD, [
    { find: "24", replace: "29" },
    { find: "- Cold.", replace: "- Cold, but kind to {{user}}." },
  ]);

  assert.equal(result.ok, true);
  assert.ok(result.ok && result.content.includes("29"));
  assert.ok(result.ok && result.content.includes("kind to {{user}}"));
});

test("applySurgicalEdits rejects a missing find string", () => {
  const result = applySurgicalEdits(CARD, [
    { find: "Not in the card", replace: "x" },
  ]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /not found/);
});

test("applySurgicalEdits rejects a duplicate find string", () => {
  const result = applySurgicalEdits("same same", [
    { find: "same", replace: "different" },
  ]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /more than once/);
});

test("applySurgicalEdits rejects an empty edit list", () => {
  const result = applySurgicalEdits(CARD, []);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /no edits/);
});

test("applySurgicalEdits rejects a no-op edit", () => {
  const result = applySurgicalEdits(CARD, [{ find: "Cold.", replace: "Cold." }]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /did not change/);
});

test("validateEditedContent keeps a valid card edit", () => {
  const edited = CARD.replace("Cold.", "Cold but secretly soft.");
  const result = validateEditedContent("character-card", CARD, edited);

  assert.deepEqual(result, { ok: true, problems: [] });
});

test("validateEditedContent rejects changed card sections", () => {
  const edited = CARD.replace("<{{char}}'s personality>", "<personality>");
  const result = validateEditedContent("character-card", CARD, edited);

  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("structure")));
});

test("validateEditedContent rejects an unbalanced closing tag", () => {
  const edited = CARD.replace("</{{char}}'s personality>", "");
  const result = validateEditedContent("character-card", CARD, edited);

  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("structure")));
});

test("validateEditedContent rejects an introduced markdown fence", () => {
  const fenced = validateEditedContent(
    "character-card",
    CARD,
    `\`\`\`\n${CARD}\n\`\`\``,
  );

  assert.equal(fenced.ok, false);
});

test("validateEditedContent rejects a removed placeholder", () => {
  const edited = CARD.replace("{{user}}", "the detective");
  const result = validateEditedContent("character-card", CARD, edited);

  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("{{user}}")));
});

test("validateEditedContent requires placeholders named in the instruction", () => {
  const original = "<setting>\nTokyo.\n</setting>";
  const missing = validateEditedContent(
    "character-card",
    original,
    "<setting>\nTokyo.\n</setting>",
    'Add that she calls {{user}} "counsel".',
  );
  const present = validateEditedContent(
    "character-card",
    original,
    '<setting>\nTokyo. She calls {{user}} "counsel".\n</setting>',
    'Add that she calls {{user}} "counsel".',
  );

  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((problem) => problem.includes("{{user}}")));
  assert.equal(present.ok, true);
});

test("validateEditedContent allows untouched wording and caps paragraphs", () => {
  const untouched = validateEditedContent(
    "opening-message",
    OPENING,
    "Rain hit the window. *Sae looked up.*",
  );
  const tooManyParagraphs = validateEditedContent(
    "opening-message",
    OPENING,
    "One.\n\nTwo.\n\nThree.\n\nFour.",
  );
  const threeParagraphs = validateEditedContent(
    "opening-message",
    OPENING,
    "One.\n\nTwo.\n\nThree.",
  );

  assert.equal(untouched.ok, true);
  assert.equal(tooManyParagraphs.ok, false);
  assert.equal(threeParagraphs.ok, true);
});

test("validateEditedContent does not blame untouched pasted text", () => {
  const original = "Here is the file you asked for. Sae set it down.";
  const edited = "Here is the folder you asked for. Sae set it down.";
  const fenced = `\`\`\`\nSae, 24, a prosecutor.\n\`\`\``;

  assert.equal(
    validateEditedContent("opening-message", original, edited).ok,
    true,
  );
  assert.equal(
    validateEditedContent(
      "character-card",
      fenced,
      fenced.replace("prosecutor", "detective"),
    ).ok,
    true,
  );
});

test("validateEditedContent lets a long pasted opening stay long", () => {
  const longOriginal = "One.\n\nTwo.\n\nThree.\n\nFour.";
  const result = validateEditedContent(
    "opening-message",
    longOriginal,
    "One.\n\nTwo.\n\nThree.\n\nFour.",
  );

  assert.equal(result.ok, true);
});

test("edit prompts carry the target rules, content and instruction", () => {
  const system = buildEditSystemPrompt("character-card");
  const prompt = buildEditUserPrompt({
    target: "character-card",
    content: CARD,
    instruction: "Add that she likes pandas.",
    characterName: "Sae",
    retryReason: "find text was not found",
  });

  assert.match(system, /JSON only/);
  assert.match(system, /exact substring/);
  assert.match(system, /XML-like section structure/);
  assert.ok(prompt.includes(CARD));
  assert.ok(prompt.includes("Add that she likes pandas."));
  assert.ok(prompt.includes("find text was not found"));
});

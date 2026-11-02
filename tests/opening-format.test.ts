import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESET_PALETTE,
  hasPresetColors,
  hasPresetHeader,
  validateOpeningFormat,
  validatePreservedOpeningFormat,
} from "../lib/opening-format.ts";
import { buildOpeningMessageSystemPrompt } from "../lib/reference-prompts.ts";
import { validateEditedContent } from "../lib/edit-content.ts";
import { weatherConsistent } from "../evals/checks.ts";

const header =
  "[ Time: 11:47 PM | Monday, October 20 | Sae's office, Tokyo | Clear ]";

const valid = [
  header,
  "",
  "The clock on the wall read 11:47. Sae Niijima did not look up from the file open in front of her.",
  "",
  '<font color="#56B4E9">"Close the door and sit,"</font> she said, pen still moving. <font color="#56B4E9">"The report is missing pages three and four."</font>',
].join("\n");

test("accepts a valid formatted opening", () => {
  assert.deepEqual(validateOpeningFormat(valid), { ok: true, problems: [] });
});

test("detects a missing header", () => {
  const result = validateOpeningFormat(
    valid.replace(`${header}\n\n`, ""),
  );

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /Header must be exactly/);
});

test("detects an invalid header date", () => {
  const result = validateOpeningFormat(
    valid.replace("Monday, October 20", "Monday, October 32"),
  );

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /not valid for October/);
});

test("detects a color outside the palette", () => {
  const result = validateOpeningFormat(
    valid.replace("#56B4E9", "#123456"),
  );

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /not in the preset palette/);
});

test("detects colored narration", () => {
  const result = validateOpeningFormat(
    valid.replace(
      "The clock on the wall read 11:47.",
      '<font color="#56B4E9">The clock on the wall read 11:47.</font>',
    ),
  );

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /spoken dialogue/);
});

test("detects uncolored dialogue", () => {
  const result = validateOpeningFormat(
    valid.replace(
      '<font color="#56B4E9">"Close the door and sit,"</font>',
      '"Close the door and sit,"',
    ),
  );

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /wrapped in a color tag/);
});

test("allows characters to mention {{user}} in their own dialogue", () => {
  const result = validateOpeningFormat(
    valid.replace(
      '<font color="#56B4E9">"Close the door and sit,"</font>',
      '<font color="#56B4E9">"{{user}}, close the door."</font>',
    ),
  );

  assert.deepEqual(result, { ok: true, problems: [] });
});

test("detects a time-skip phrase", () => {
  const result = validateOpeningFormat(
    valid.replace(
      "The clock on the wall read 11:47.",
      "An hour later, the clock on the wall read 12:47.",
    ),
  );

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /time-skip/);
});

test("detects too many story paragraphs", () => {
  const story = [
    header,
    "",
    "One.",
    "",
    "Two.",
    "",
    "Three.",
    "",
    '<font color="#56B4E9">"Four."</font>',
  ].join("\n");
  const result = validateOpeningFormat(story);

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /4 paragraphs/);
});

test("present-format checks only enforce what the original had", () => {
  const plain = "Plain opening with no formatting.";

  assert.deepEqual(validatePreservedOpeningFormat(plain, plain), {
    ok: true,
    problems: [],
  });

  const removedFormatting = validatePreservedOpeningFormat(
    valid,
    valid.replace(/<font[^>]*>|<\/font>/g, ""),
  );

  assert.equal(removedFormatting.ok, false);
  assert.match(removedFormatting.problems.join(" "), /color tag/);
});

test("edit validation keeps formatting when the original had it", () => {
  const edited = valid.replace("The report is missing", "The report is gone");

  assert.deepEqual(
    validateEditedContent("opening-message", valid, edited).problems,
    [],
  );

  const stripped = validateEditedContent(
    "opening-message",
    valid,
    valid.replace(/<font[^>]*>|<\/font>/g, ""),
  );

  assert.equal(stripped.ok, false);
  assert.match(stripped.problems.join(" "), /color tag/);
});

test("formatting prompt is opt-in", () => {
  const plain = buildOpeningMessageSystemPrompt();
  const formatted = buildOpeningMessageSystemPrompt({
    presetFormatting: true,
  });

  assert.equal(plain.includes("Formatting addendum"), false);
  assert.equal(formatted.includes("Formatting addendum"), true);
  assert.equal(formatted.includes(PRESET_PALETTE[0]), true);
});

test("detects header weather that contradicts the story", () => {
  const result = validateOpeningFormat(
    valid.replace(
      "The clock on the wall read 11:47.",
      "Rain streaked the window behind her.",
    ),
  );

  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /weather does not match/);
});

test("does not treat sun-up or steam as weather", () => {
  assert.equal(
    validateOpeningFormat(
      valid.replace(
        "The clock on the wall read 11:47.",
        "She was awake before the sun's up, watching the steam fog the glass.",
      ),
    ).ok,
    true,
  );
});

test("format detection helpers", () => {
  assert.equal(hasPresetHeader(valid), true);
  assert.equal(hasPresetColors(valid), true);
  assert.equal(hasPresetHeader("Plain text"), false);
  assert.equal(hasPresetColors("Plain text"), false);
});

test("weather consistency ignores steam and matches real weather", () => {
  const clearHeader =
    "[ Time: 5:42 AM | Tuesday, October 21 | Sae's Apartment | Clear, cold dawn ]";

  assert.equal(
    weatherConsistent(
      clearHeader,
      `${clearHeader}\n\nThe steam fogged the faint shadows under her eyes.`,
    ),
    true,
  );

  assert.equal(
    weatherConsistent(
      clearHeader,
      `${clearHeader}\n\nRain streaked the window behind her.`,
    ),
    false,
  );

  assert.equal(
    weatherConsistent(
      "[ Time: 5:42 AM | Tuesday, October 21 | The trail | Cold morning mist ]",
      "The mist hung low between the pines.",
    ),
    true,
  );

  assert.equal(
    weatherConsistent(
      clearHeader,
      `${clearHeader}\n\nThe rain had stopped an hour ago; the pavement was still wet.`,
    ),
    true,
  );
});

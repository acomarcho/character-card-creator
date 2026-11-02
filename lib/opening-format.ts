// Formatting rules vendored from acomarcho/st-preset @ 9531ec9
// (simplified-preset.json: "Time and Place" and "Colored Dialogue").
// Update references/preset-formatting.md when the preset changes.

export const PRESET_PALETTE = [
  "#56B4E9",
  "#E69F00",
  "#009E73",
  "#CC79A7",
  "#D55E00",
  "#F0E442",
  "#B39DDB",
  "#80CBC4",
  "#FFAB91",
  "#B0BEC5",
] as const;

const PALETTE = new Set<string>(PRESET_PALETTE.map((color) => color.toUpperCase()));

const WEEKDAY_PATTERN =
  "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
const MONTH_PATTERN =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const HEADER_PATTERN = new RegExp(
  `^\\[\\s*Time:\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)\\s*\\|\\s*(${WEEKDAY_PATTERN}),\\s*(${MONTH_PATTERN})\\s+(\\d{1,2})\\s*\\|\\s*([^|\\]\\n]+?)\\s*\\|\\s*([^|\\]\\n]+?)\\s*\\]$`,
);

const TIME_SKIP_PATTERN =
  /\b(later that (day|night|evening|morning)|(an|one) hour later|hours later|(a few|several) (minutes|hours|days) later|moments later|seconds later|the next (day|morning|evening|night)|after (a while|some time)|soon after(wards)?|meanwhile)\b/i;

const FONT_OPEN_PATTERN = /<font\b([^>]*)>/gi;
const FONT_CLOSE_PATTERN = /<\/font\s*>/gi;
const ANY_FONT_TAG_PATTERN = /<\/?font\b([^>]*)>/gi;
const COLOR_ATTRIBUTE_PATTERN = /^\s*color\s*=\s*"([^"]+)"\s*$/i;

export function weatherConsistent(header: string, output: string): boolean {
  const weather = header.split("|")[3] ?? "";
  const lines = output.split("\n");
  const body = /^\[\s*Time:/i.test(lines[0]?.trim() ?? "")
    ? lines.slice(1).join("\n")
    : output;
  const story = stripColoredDialogue(body);
  const rainStopped =
    /\brain(s)? (had )?(stopped|thinned|eased|let up|died down|ended)\b|\bthe rain was over\b/i.test(
      story,
    );
  const checks: Array<[RegExp, RegExp, boolean]> = [
    [
      /\brain(s|ing|ed|y)?\b|\bdownpour\b|\bdrizzl(e|ing|y)\b|\bsleet\b/i,
      /rain|downpour|drizzle|storm|wet|sleet/i,
      !rainStopped,
    ],
    [
      /\bsnow(s|ing|ed|y)?\b|\bblizzard\b|\bflurr(y|ies)\b/i,
      /snow|blizzard|flurr/i,
      true,
    ],
  ];

  return checks.every(
    ([storyPattern, headerPattern, enabled]) =>
      !enabled || !storyPattern.test(story) || headerPattern.test(weather),
  );
}

export function stripColoredDialogue(text: string): string {
  return text.replace(/<font\s+[^>]*>[\s\S]*?<\/font\s*>/gi, "");
}

export type FormatCheck = {
  ok: boolean;
  problems: string[];
};

export function firstHeaderLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

export function hasPresetHeader(text: string): boolean {
  return validateHeaderLine(firstHeaderLine(text)).ok;
}

export function hasHeaderLikeLine(text: string): boolean {
  return /^\[\s*Time:.*\|.*\|.*\|.*\]$/i.test(firstHeaderLine(text));
}

export function hasPresetColors(text: string): boolean {
  for (const match of text.matchAll(/<font\b([^>]*)>/gi)) {
    const color = match[1]
      ?.match(COLOR_ATTRIBUTE_PATTERN)?.[1]
      ?.toUpperCase();

    if (color && PALETTE.has(color)) {
      return true;
    }
  }

  return false;
}

export function validateHeaderLine(line: string): FormatCheck {
  const problems: string[] = [];
  const match = line.match(HEADER_PATTERN);

  if (!match) {
    return {
      ok: false,
      problems: [
        `Header must be exactly [ Time: HH:MM AM/PM | Weekday, Month DD | Location | Weather ], got: ${line || "(empty)"}`,
      ],
    };
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const month = match[5];
  const day = Number(match[6]);
  const location = match[7].trim();
  const weather = match[8].trim();

  if (hour < 1 || hour > 12) {
    problems.push(`Header hour must be between 1 and 12, got ${hour}.`);
  }

  if (minute > 59) {
    problems.push(`Header minute must be between 0 and 59, got ${minute}.`);
  }

  const maxDay = MONTH_DAYS[new Date(`${month} 1, 2000`).getMonth()];
  if (day < 1 || day > maxDay) {
    problems.push(`Header day ${day} is not valid for ${month}.`);
  }

  if (!location) {
    problems.push("Header location is empty.");
  }

  if (!weather) {
    problems.push("Header weather is empty.");
  }

  return { ok: problems.length === 0, problems };
}

function validateColorTags(text: string): FormatCheck {
  const problems: string[] = [];
  const opens = Array.from(text.matchAll(FONT_OPEN_PATTERN));
  const closes = Array.from(text.matchAll(FONT_CLOSE_PATTERN));

  if (opens.length !== closes.length) {
    problems.push(
      `Dialogue color tags are unbalanced: ${opens.length} opening and ${closes.length} closing tags.`,
    );
  }

  let depth = 0;
  for (const tag of text.matchAll(ANY_FONT_TAG_PATTERN)) {
    if (tag[0].startsWith("</")) {
      depth -= 1;
      if (depth < 0) {
        problems.push("Found a closing color tag without an opening tag.");
        depth = 0;
      }
      continue;
    }

    depth += 1;
    if (depth > 1) {
      problems.push("Color tags must not be nested.");
    }

    const attributes = tag[1] ?? "";
    const colorMatch = attributes.match(COLOR_ATTRIBUTE_PATTERN);
    const color = colorMatch?.[1]?.toUpperCase() ?? "";

    if (!colorMatch || !/^#[0-9A-F]{6}$/.test(color)) {
      problems.push(
        `Color tag must use color="#HEX" with a six-digit hex value, got: ${tag[0]}`,
      );
      continue;
    }

    if (!PALETTE.has(color)) {
      problems.push(`Color ${color} is not in the preset palette.`);
    }
  }

  return { ok: problems.length === 0, problems };
}

function countPaletteTags(text: string): number {
  let count = 0;

  for (const match of text.matchAll(FONT_OPEN_PATTERN)) {
    const color = match[1]
      ?.match(COLOR_ATTRIBUTE_PATTERN)?.[1]
      ?.toUpperCase();

    if (color && PALETTE.has(color)) {
      count += 1;
    }
  }

  return count;
}

function validateColors(text: string): FormatCheck {
  const problems = [...validateColorTags(text).problems];

  const withoutColors = text.replace(
    /<font\s+[^>]*>([\s\S]*?)<\/font\s*>/gi,
    (whole, inner: string) => {
      const content = inner.trim();

      if (!/^["“]/.test(content) || !/["”]$/.test(content)) {
        problems.push(
          `Colored text must be spoken dialogue in double quotes, got: ${content.slice(0, 60)}`,
        );
      }

      return "";
    },
  );

  if (/["“”]/.test(withoutColors)) {
    problems.push("Every line of spoken dialogue must be wrapped in a color tag.");
  }

  return { ok: problems.length === 0, problems };
}

export function validateOpeningFormat(text: string): FormatCheck {
  const problems: string[] = [];
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const header = lines[0]?.trim() ?? "";

  const headerCheck = validateHeaderLine(header);
  problems.push(...headerCheck.problems);

  if (headerCheck.ok && !weatherConsistent(header, trimmed)) {
    problems.push(
      "Header weather does not match the weather shown in the story.",
    );
  }

  const headerLines = lines.filter((line) => /^\[\s*Time:/i.test(line.trim()));
  if (headerLines.length > 1) {
    problems.push("Only the first line may contain the time header.");
  }

  const story = lines.slice(1).join("\n").trim();

  if (!story) {
    problems.push("The opening message needs story text after the header.");
  }

  if (/<font\b/i.test(story)) {
    problems.push(...validateColors(story).problems);
  } else if (/"/.test(story)) {
    problems.push("Every line of spoken dialogue must be wrapped in a color tag.");
  }

  if (/`/.test(trimmed)) {
    problems.push("Do not use backticks or code formatting.");
  }

  return { ok: problems.length === 0, problems };
}

export function validateOpeningNarrative(text: string): FormatCheck {
  const problems: string[] = [];
  const story = stripColoredDialogue(text.trim().split("\n").slice(1).join("\n"));

  const paragraphs = story
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim().length > 0).length;

  if (paragraphs > 3) {
    problems.push(`Story has ${paragraphs} paragraphs after the header (max 3).`);
  }

  if (TIME_SKIP_PATTERN.test(story)) {
    problems.push(
      "Narration contains a time-skip phrase. The opening must cover one moment.",
    );
  }

  return { ok: problems.length === 0, problems };
}

export function chooseFormatRepairOutput(input: {
  firstOutput: string;
  firstProblems: string[];
  repairedOutput: string;
  problems: string[];
}): { output: string; formatWarning?: string } {
  if (input.problems.length === 0) {
    return { output: input.repairedOutput };
  }

  const useFirst = input.firstOutput.trim().length > 0;
  const chosenProblems = useFirst ? input.firstProblems : input.problems;

  return {
    output: useFirst ? input.firstOutput : input.repairedOutput,
    formatWarning: `Formatting check still failing: ${chosenProblems.join(" ")}`,
  };
}

// Used by the AI edit path: only enforce the formatting that was already present,
// so pasted plain-text openings keep working exactly as before.
export function validatePreservedOpeningFormat(
  original: string,
  edited: string,
): FormatCheck {
  const problems: string[] = [];
  const originalTrimmed = original.trim();
  const editedTrimmed = edited.trim();

  if (hasPresetHeader(originalTrimmed)) {
    const header = firstHeaderLine(editedTrimmed);
    problems.push(...validateHeaderLine(header).problems);

    if (editedTrimmed.split("\n").filter((line) => /^\[\s*Time:/i.test(line.trim())).length > 1) {
      problems.push("Only the first line may contain the time header.");
    }
  } else if (hasHeaderLikeLine(originalTrimmed)) {
    if (!hasHeaderLikeLine(editedTrimmed)) {
      problems.push("Edit removed the time/place header.");
    }
  }

  if (hasPresetColors(originalTrimmed)) {
    problems.push(...validateColorTags(editedTrimmed).problems);

    if (countPaletteTags(editedTrimmed) === 0) {
      problems.push("Edit removed the colored dialogue.");
    }
  }

  return { ok: problems.length === 0, problems };
}

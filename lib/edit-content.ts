import { stripAsterisks, stripCodeFence } from "./reference-prompts.ts";

export const EDIT_TARGETS = ["character-card", "opening-message"] as const;

export type EditTarget = (typeof EDIT_TARGETS)[number];

export type SurgicalEdit = {
  find: string;
  replace: string;
};

const PLACEHOLDERS = ["{{char}}", "{{user}}"] as const;

function labelFor(target: EditTarget): string {
  return target === "character-card" ? "character card" : "opening message";
}

function tagSequence(content: string): string[] {
  return Array.from(
    content.matchAll(/<(\/?)([^/\n>][^>\n]*)>/g),
    (match) => `${match[1]}${match[2]}`,
  );
}

function hasFence(content: string): boolean {
  return content.includes("```");
}

function paragraphs(content: string): string[] {
  return content
    .trim()
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim().length > 0);
}

export function buildEditSystemPrompt(target: EditTarget): string {
  const formatRules =
    target === "character-card"
      ? [
          "You are editing an existing SillyTavern character card.",
          "",
          "Format contract:",
          "- Keep the exact XML-like section structure, tag names and section order from the current card.",
          "- Do not add, remove or rename sections.",
          "- Keep {{char}} and {{user}} placeholders exactly as placeholders.",
          "- Output plain text only. No markdown fences, no preamble, no explanations.",
        ]
      : [
          "You are editing an existing SillyTavern opening message.",
          "",
          "Format contract:",
          "- Output exactly one opening message.",
          "- Keep it to two paragraphs; never exceed three.",
          "- Write narration as normal text. Put dialogue in double quotes.",
          "- Never use asterisks, italics or any markdown.",
          "- No preamble, no bullet points, no commentary.",
        ];

  return [
    ...formatRules,
    "",
    "Editing contract:",
    "- Return surgical replacements instead of rewriting the whole document.",
    '- Respond with JSON only: {"edits":[{"find":"exact text from the current content","replace":"replacement text"}]}',
    "- Each `find` must be an exact substring of the current content and must occur exactly once.",
    "- Use the smallest replacement that applies the requested change. Use an empty string to delete.",
    "- Do not include the full document. Do not touch unaffected text.",
    "- Apply only what the instruction asks. Preserve every other fact, phrase and formatting detail.",
  ].join("\n");
}

export function buildEditUserPrompt(input: {
  target: EditTarget;
  content: string;
  instruction: string;
  characterName?: string;
  characterCard?: string;
  retryReason?: string;
}): string {
  const parts = [
    input.characterName ? `Character name: ${input.characterName}` : null,
    input.characterCard
      ? ["Character card context:", input.characterCard.trim()].join("\n")
      : null,
    `Current ${labelFor(input.target)}:`,
    input.content.trim(),
    "",
    "Edit instruction:",
    input.instruction.trim(),
    "",
    "Task: Return the JSON edit list now.",
  ].filter((part): part is string => part !== null);

  if (input.retryReason) {
    parts.push(
      "",
      `Previous attempt failed: ${input.retryReason}`,
      "Return a valid edit list this time.",
    );
  }

  return parts.join("\n");
}

export function applySurgicalEdits(
  content: string,
  edits: SurgicalEdit[],
): { ok: true; content: string } | { ok: false; error: string } {
  if (edits.length === 0) {
    return { ok: false, error: "Model returned no edits." };
  }

  let next = content;

  for (const [index, edit] of edits.entries()) {
    if (!edit.find) {
      return { ok: false, error: `Edit ${index + 1} has an empty find string.` };
    }

    const firstIndex = next.indexOf(edit.find);
    const lastIndex = next.lastIndexOf(edit.find);

    if (firstIndex === -1) {
      return {
        ok: false,
        error: `Edit ${index + 1} text was not found in the current content.`,
      };
    }

    if (firstIndex !== lastIndex) {
      return {
        ok: false,
        error: `Edit ${index + 1} text occurs more than once in the current content.`,
      };
    }

    next =
      next.slice(0, firstIndex) + edit.replace + next.slice(firstIndex + edit.find.length);
  }

  if (next === content) {
    return { ok: false, error: "Edits did not change the content." };
  }

  return { ok: true, content: next };
}

export function sanitizeEditText(target: EditTarget, text: string): string {
  return target === "character-card" ? stripCodeFence(text) : stripAsterisks(text);
}

export function validateEditedContent(
  target: EditTarget,
  original: string,
  edited: string,
  instruction = "",
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const trimmedOriginal = original.trim();
  const trimmedEdited = edited.trim();

  if (!trimmedEdited) {
    return { ok: false, problems: ["Edit produced empty content."] };
  }

  if (hasFence(trimmedEdited) && !hasFence(trimmedOriginal)) {
    problems.push("Edit introduced a markdown fence.");
  }



  for (const placeholder of PLACEHOLDERS) {
    const mustAppear =
      trimmedOriginal.includes(placeholder) || instruction.includes(placeholder);

    if (mustAppear && !trimmedEdited.includes(placeholder)) {
      problems.push(`Edit is missing the ${placeholder} placeholder.`);
    }
  }

  if (target === "character-card") {
    const originalTags = tagSequence(trimmedOriginal);
    const editedTags = tagSequence(trimmedEdited);

    if (originalTags.join("|") !== editedTags.join("|")) {
      problems.push("Edit changed the section structure or tag order.");
    }

    if (trimmedOriginal.startsWith("<") && !trimmedEdited.startsWith("<")) {
      problems.push("Edited card no longer starts with its first section tag.");
    }
  } else {
    const maxParagraphs = Math.max(3, paragraphs(trimmedOriginal).length);

    if (paragraphs(trimmedEdited).length > maxParagraphs) {
      problems.push(`Edit produced more than ${maxParagraphs} paragraphs.`);
    }
  }

  return { ok: problems.length === 0, problems };
}

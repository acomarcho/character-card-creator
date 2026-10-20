import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateObject, generateText } from "ai";
import { z } from "zod";

import {
  applySurgicalEdits,
  buildEditSystemPrompt,
  buildEditUserPrompt,
  sanitizeEditText,
  validateEditedContent,
} from "../lib/edit-content.ts";
import type { EditCase, EditTarget } from "./fixtures.ts";

export type EditStrategy = "rewrite" | "surgical";

export type StrategyResult = {
  ok: boolean;
  content: string;
  error?: string;
  latencyMs: number;
  retries: number;
};

const CARD_TAGS = [
  "setting",
  "{{char}}'s overview",
  "{{char}}'s personality",
  "{{char}}'s speech",
  "{{char}}'s appearance",
  "{{char}}'s outfits",
  "{{char}}'s intimacy",
];

const labelFor = (target: EditTarget) =>
  target === "character-card" ? "character card" : "opening message";

export function buildEditRules(target: EditTarget): string {
  if (target === "character-card") {
    return [
      "You are editing an existing SillyTavern character card.",
      "",
      "Format contract:",
      "- Keep the exact XML-like section structure, tag names and section order from the current card.",
      `- The required sections, in order, are: ${CARD_TAGS.join(", ")}.`,
      "- Do not add, remove or rename sections.",
      "- Output plain text only. No markdown fences, no preamble, no explanations.",
      "- Keep {{char}} and {{user}} placeholders exactly as placeholders.",
    ].join("\n");
  }

  return [
    "You are editing an existing SillyTavern opening message.",
    "",
    "Format contract:",
    "- Output exactly one opening message.",
    "- Keep it to two paragraphs; never exceed three.",
    "- Write narration as normal text. Put dialogue in double quotes.",
    "- Never use asterisks, italics or any markdown.",
    "- No preamble, no bullet points, no commentary.",
  ].join("\n");
}

export function buildRewriteSystemPrompt(target: EditTarget): string {
  return [
    buildEditRules(target),
    "",
    "Editing contract:",
    "- Apply the requested edit. Return the complete revised content.",
    "- Change only what the instruction requires. Preserve every unaffected fact, phrase, ordering and formatting detail.",
    "- Do not mention the edit, the user, or your process.",
  ].join("\n");
}

function buildRewriteUserPrompt(input: {
  target: EditTarget;
  content: string;
  instruction: string;
  characterName?: string;
  characterCard?: string;
}): string {
  return [
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
    `Task: Return the complete revised ${labelFor(input.target)} now.`,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");
}

const editListSchema = z.object({
  edits: z
    .array(
      z.object({
        find: z.string(),
        replace: z.string(),
      }),
    )
    .min(1),
});

export async function runRewriteStrategy(input: {
  apiKey: string;
  testCase: EditCase;
  temperature: number;
}): Promise<StrategyResult> {
  const startedAt = Date.now();
  const provider = createDeepSeek({ apiKey: input.apiKey });

  try {
    const result = await generateText({
      model: provider("deepseek-chat"),
      system: buildRewriteSystemPrompt(input.testCase.target),
      prompt: buildRewriteUserPrompt(input.testCase),
      temperature: input.temperature,
    });

    return {
      ok: true,
      content: sanitizeEditText(input.testCase.target, result.text),
      latencyMs: Date.now() - startedAt,
      retries: 0,
    };
  } catch (unknownError) {
    return {
      ok: false,
      content: "",
      error:
        unknownError instanceof Error ? unknownError.message : "Rewrite failed.",
      latencyMs: Date.now() - startedAt,
      retries: 0,
    };
  }
}

export async function runSurgicalStrategy(input: {
  apiKey: string;
  testCase: EditCase;
  temperature: number;
}): Promise<StrategyResult> {
  const startedAt = Date.now();
  const provider = createDeepSeek({ apiKey: input.apiKey });
  let retries = 0;
  let retryReason: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generateObject({
        model: provider("deepseek-chat"),
        schema: editListSchema,
        system: buildEditSystemPrompt(input.testCase.target),
        prompt: buildEditUserPrompt({
          target: input.testCase.target,
          content: input.testCase.content,
          instruction: input.testCase.instruction,
          characterName: input.testCase.characterName,
          characterCard: input.testCase.characterCard,
          retryReason,
        }),
        temperature: input.temperature,
      });

      const sanitized = result.object.edits.map((edit) => ({
        find: edit.find,
        replace: sanitizeEditText(input.testCase.target, edit.replace),
      }));

      const applied = applySurgicalEdits(input.testCase.content, sanitized);

      if (applied.ok) {
        const validation = validateEditedContent(
          input.testCase.target,
          input.testCase.content,
          applied.content,
          input.testCase.instruction,
        );

        if (validation.ok) {
          return {
            ok: true,
            content: applied.content,
            latencyMs: Date.now() - startedAt,
            retries,
          };
        }

        retryReason = validation.problems.join(" ");
      } else {
        retryReason = applied.error;
      }
    } catch (unknownError) {
      retryReason =
        unknownError instanceof Error
          ? unknownError.message
          : "Surgical edit failed.";
    }

    retries += 1;
  }

  return {
    ok: false,
    content: "",
    error: retryReason ?? "Surgical edit failed.",
    latencyMs: Date.now() - startedAt,
    retries,
  };
}

export function validateFormat(
  target: EditTarget,
  content: string,
  testCase: EditCase,
): { ok: boolean; problems: string[] } {
  const problems = [
    ...validateEditedContent(
      target,
      testCase.content,
      content,
      testCase.instruction,
    ).problems,
  ];

  if (testCase.maxParagraphs !== undefined) {
    const count = content
      .trim()
      .split(/\n\s*\n/)
      .filter((paragraph) => paragraph.trim().length > 0).length;

    if (count > testCase.maxParagraphs) {
      problems.push(`Has ${count} paragraphs (max ${testCase.maxParagraphs}).`);
    }
  }

  return { ok: problems.length === 0, problems };
}

export function wordJaccard(original: string, edited: string): number {
  const words = (text: string) =>
    new Set(text.toLowerCase().match(/[a-z0-9'{}]+/g) ?? []);
  const before = words(original);
  const after = words(edited);
  let intersection = 0;

  for (const word of before) {
    if (after.has(word)) {
      intersection += 1;
    }
  }

  return before.size + after.size === 0
    ? 1
    : intersection / (before.size + after.size - intersection);
}

export function sentencePreservation(
  original: string,
  edited: string,
): number {
  const sentences = (text: string) =>
    text
      .replace(/\s+/g, " ")
      .match(/[^.!?]+[.!?]+/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [];
  const before = sentences(original);
  const after = new Set(sentences(edited));

  if (before.length === 0) {
    return 1;
  }

  return before.filter((sentence) => after.has(sentence)).length / before.length;
}

export function checkAdherence(
  testCase: EditCase,
  content: string,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];

  for (const pattern of testCase.mustInclude ?? []) {
    if (!pattern.test(content)) {
      problems.push(`Missing required ${pattern}.`);
    }
  }

  for (const pattern of testCase.mustNotInclude ?? []) {
    if (pattern.test(content)) {
      problems.push(`Still contains forbidden ${pattern}.`);
    }
  }

  if (
    testCase.maxLengthRatio !== undefined &&
    content.length > testCase.content.length * testCase.maxLengthRatio
  ) {
    problems.push(
      `Length ${content.length} exceeds ${Math.round(
        testCase.content.length * testCase.maxLengthRatio,
      )}.`,
    );
  }

  return { ok: problems.length === 0, problems };
}

export async function judgeEdit(input: {
  apiKey: string;
  testCase: EditCase;
  edited: string;
}): Promise<{ adherence: number; preservation: number; notes: string }> {
  const provider = createDeepSeek({ apiKey: input.apiKey });

  const result = await generateText({
    model: provider("deepseek-chat"),
    system:
      "You grade editing output. Return JSON only, with integer scores from 1 to 5. " +
      'Shape: {"adherence":1-5,"preservation":1-5,"notes":"short reason"}',
    prompt: [
      `Edit instruction: ${input.testCase.instruction}`,
      "",
      "Original:",
      input.testCase.content,
      "",
      "Edited:",
      input.edited,
      "",
      "adherence = did the edit apply exactly the requested change, no more and no less?",
      "preservation = did every unaffected fact, phrase and formatting detail survive?",
    ].join("\n"),
    temperature: 0,
  });

  const match = result.text.match(/\{[\s\S]*\}/);

  if (!match) {
    return { adherence: 0, preservation: 0, notes: "Judge returned no JSON." };
  }

  const parsed = JSON.parse(match[0]) as {
    adherence?: number;
    preservation?: number;
    notes?: string;
  };

  return {
    adherence: Number(parsed.adherence) || 0,
    preservation: Number(parsed.preservation) || 0,
    notes: parsed.notes ?? "",
  };
}

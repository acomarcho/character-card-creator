import { readFileSync } from "node:fs";
import { join } from "node:path";

const characterCardReference = readFileSync(
  join(process.cwd(), "references", "character-card.md"),
  "utf8",
).trim();

const openingMessageReference = readFileSync(
  join(process.cwd(), "references", "opening-message.md"),
  "utf8",
).trim();

export function buildCharacterCardSystemPrompt(): string {
  return [
    "You are an expert SillyTavern character-card writer.",
    "",
    "Requirements:",
    "1) Follow the exact formatting style, section order, and XML-like tag naming pattern from the one-shot example.",
    "2) Output plain text only. No markdown fences, no preamble, no explanations.",
    "3) Write a complete high-quality card with rich lore, psychology, behavior, speaking style, and scenario-ready detail.",
    "4) Keep placeholders like {{char}} and {{user}} exactly as placeholders when relevant.",
    "5) If web search tools are available, use them to verify core canon facts before finalizing.",
    "6) Keep the final result coherent and internally consistent for roleplay.",
    "",
    "One-shot reference (mirror this structure religiously):",
    characterCardReference,
  ].join("\n");
}

export function buildCharacterCardUserPrompt(input: {
  characterName: string;
  characterContext?: string;
}): string {
  const context = input.characterContext?.trim();

  return [
    `Character name: ${input.characterName.trim()}`,
    context
      ? `Starting context: ${context}`
      : "Starting context: (none provided)",
    "",
    "Task: Generate a full SillyTavern-ready character card now.",
  ].join("\n");
}

export function buildOpeningMessageSystemPrompt(): string {
  return [
    "You write opening messages for SillyTavern chats.",
    "",
    "Requirements:",
    "1) Output exactly one polished opening message in plain text.",
    "2) No markdown fences, no preamble, no bullet points.",
    "3) Match the narrative/dialogue style of the one-shot example.",
    "4) Include {{user}} naturally in the scene.",
    "5) Ground the opening in the supplied character card and requested opening context.",
    "",
    "One-shot reference:",
    openingMessageReference,
  ].join("\n");
}

export function buildOpeningMessageUserPrompt(input: {
  characterName: string;
  characterCard: string;
  openingContext?: string;
}): string {
  const context = input.openingContext?.trim();

  return [
    `Character name: ${input.characterName.trim()}`,
    "",
    "Character card:",
    input.characterCard.trim(),
    "",
    context
      ? `Opening context requirement: ${context}`
      : "Opening context requirement: (none provided)",
    "",
    "Task: Write the opening message now.",
  ].join("\n");
}

export function stripCodeFence(text: string): string {
  return text
    .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}


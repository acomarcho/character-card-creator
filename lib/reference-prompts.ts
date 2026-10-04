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
    "1) Follow the section order and XML-like tag naming pattern from the one-shot example.",
    "2) Output plain text only. No markdown fences, no preamble, no explanations.",
    "3) Be concise. Every line must change how {{char}} acts, speaks, or is described in a scene. Prefer short, dense sentences and bullets over prose.",
    "4) Leave out anything that does not help roleplay: trivia, voice actors, development history, game mechanics, name etymology, and plot recaps.",
    "5) Aim for roughly the length of the one-shot example (about 500 words). Never pad.",
    "6) Keep placeholders like {{char}} and {{user}} exactly as placeholders when relevant.",
    "7) If web search tools are available, use them to verify core canon facts before finalizing.",
    "8) Keep the final result coherent and internally consistent for roleplay.",
    "9) The very first character of your response must be '<' from the opening <setting> tag.",
    "10) Never include analysis, prefaces, tool summaries, or phrases like 'Based on my research'.",
    "11) Do not mention the existence of web search, tools, or your process.",
    "12) Use exactly the sections from the one-shot example, in that order. Do not add extra sections.",
    "13) Start the overview with the character's name and age, like the example (\"Name, 24, ...\").",
    "",
    "One-shot reference (match its structure and density):",
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
    "1) Output exactly one opening message in plain text.",
    "2) Keep it to 2 paragraphs. Never exceed 3. Keep it tight.",
    "3) Write narration as normal text. Put dialogue in double quotes. Never use asterisks, italics, or any markdown.",
    "4) No preamble and no bullet points.",
    "5) Match the narrative/dialogue style of the one-shot example.",
    "6) Include {{user}} naturally in the scene. Do not assume {{user}}'s gender.",
    "7) Ground the opening in the supplied character card and requested opening context.",
    "8) Start directly with the opening message itself; no lead-in text.",
    "9) Never include analysis, prefaces, tool summaries, or phrases like 'Based on my research'.",
    "10) Do not mention web search, tools, or your writing process.",
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

export function stripAsterisks(text: string): string {
  return stripCodeFence(text).replace(/\*/g, "");
}

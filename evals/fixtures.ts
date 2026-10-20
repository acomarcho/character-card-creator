import { readFileSync } from "node:fs";
import { join } from "node:path";

export type EditTarget = "character-card" | "opening-message";

export type EditCase = {
  id: string;
  target: EditTarget;
  content: string;
  instruction: string;
  characterName: string;
  characterCard?: string;
  mustInclude?: RegExp[];
  mustNotInclude?: RegExp[];
  maxParagraphs?: number;
  maxLengthRatio?: number;
};

const characterCard = readFileSync(
  join(process.cwd(), "references", "character-card.md"),
  "utf8",
).trim();

export const generatedOpeningMessage = [
  "The clock on the wall read 11:47. Sae Niijima didn't look up from the file open in front of her, though the click of the door had registered the moment it opened. Her desk lamp carved a small island of light out of the dark office, and the coffee beside her had long gone cold.",
  '"Close the door and sit," she said, pen still moving. "The forensic report from the Kanda site is missing pages three and four, and the witness statement lists a time that contradicts the security footage by forty minutes. I want to know which one of those errors came from your department before I decide how to handle it." She finally raised her eyes, reddish-brown and tired but sharp as glass. "So. Start from the beginning, detective, and leave nothing out."',
].join("\n\n");

export const characterCardFixture = characterCard;
export const openingMessageFixture = generatedOpeningMessage;

export const editCases: EditCase[] = [
  {
    id: "card-add-panda-detail",
    target: "character-card",
    content: characterCard,
    instruction:
      "Add a detail that she secretly loves pandas. Keep it consistent with her personality.",
    characterName: "Sae Niijima",
    mustInclude: [/panda/i],
  },
  {
    id: "card-change-age",
    target: "character-card",
    content: characterCard,
    instruction:
      "Change her age from 24 to 29 and update anything that depends on it.",
    characterName: "Sae Niijima",
    mustInclude: [/\b29\b/],
    mustNotInclude: [/\b24\b/],
  },
  {
    id: "card-remove-coffee",
    target: "character-card",
    content: characterCard,
    instruction: "Remove every reference to coffee.",
    characterName: "Sae Niijima",
    mustNotInclude: [/coffee/i],
  },
  {
    id: "card-add-speech-quirk",
    target: "character-card",
    content: characterCard,
    instruction:
      "In the speech section, add a quirk that she occasionally calls {{user}} \"counsel\" when she is testing them.",
    characterName: "Sae Niijima",
    mustInclude: [/counsel/i, /\{\{user\}\}/],
  },
  {
    id: "card-warmer-tone",
    target: "character-card",
    content: characterCard,
    instruction:
      "Make her noticeably warmer and more openly maternal while keeping her professional and sharp.",
    characterName: "Sae Niijima",
  },
  {
    id: "card-add-rain-outfit",
    target: "character-card",
    content: characterCard,
    instruction:
      "Add a rainy-day outfit to the outfits section: a charcoal trench coat and a black umbrella.",
    characterName: "Sae Niijima",
    mustInclude: [/trench coat/i, /umbrella/i],
  },
  {
    id: "opening-add-rain",
    target: "opening-message",
    content: generatedOpeningMessage,
    instruction: "Add that heavy rain is hitting the office windows.",
    characterName: "Sae Niijima",
    characterCard,
    mustInclude: [/rain/i],
    maxParagraphs: 3,
  },
  {
    id: "opening-change-setting",
    target: "opening-message",
    content: generatedOpeningMessage,
    instruction:
      "Change the setting from the late-night office to a crowded coffee shop. Keep the same conversation beat.",
    characterName: "Sae Niijima",
    characterCard,
    mustInclude: [/caf(e|é)|coffee shop/i],
    mustNotInclude: [/dark office/i],
    maxParagraphs: 3,
  },
  {
    id: "opening-add-panda-line",
    target: "opening-message",
    content: generatedOpeningMessage,
    instruction:
      "Add a line where she admits she likes pandas, in her voice.",
    characterName: "Sae Niijima",
    characterCard,
    mustInclude: [/panda/i],
    maxParagraphs: 3,
  },
  {
    id: "opening-shorten",
    target: "opening-message",
    content: generatedOpeningMessage,
    instruction:
      "Cut this to two tight paragraphs without losing the main beat or her dialogue.",
    characterName: "Sae Niijima",
    characterCard,
    maxParagraphs: 2,
    maxLengthRatio: 0.85,
  },
];

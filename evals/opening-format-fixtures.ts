import { readFileSync } from "node:fs";
import { join } from "node:path";

export type OpeningFormatCase = {
  id: string;
  characterName: string;
  characterCard: string;
  openingContext: string;
  expectedTime: RegExp;
  expectedLocation: RegExp;
  expectedMonth?: RegExp;
  expectedWeather?: RegExp;
  minDistinctColors: number;
  mustInclude?: RegExp[];
  mustNotInclude?: RegExp[];
};

const saeCard = readFileSync(
  join(process.cwd(), "references", "character-card.md"),
  "utf8",
).trim();

const miraCard = `<setting>
The northern frontier of Vael: pine forest, stone villages, cold rivers and old magic that the settled lands have mostly forgotten.
</setting>

<{{char}}'s overview>
Mira, 27, a ranger of the Vael frontier. She grew up in a logging village that was burned in a border raid and has worked the wilds alone since. She knows the forest better than any map and distrusts anyone who arrives with clean boots.
</{{char}}'s overview>

<{{char}}'s personality>
- Patient, watchful and blunt. Speaks only when it changes something.
- Trusts animals and weather more than people. Reads tracks, silence and smoke before faces.
- Carries guilt for the village she could not save. Covers it with work and distance.
- Fiercely protective once someone earns it, but never says so directly.
- Hates waste, crowds and being thanked.
</{{char}}'s personality>

<{{char}}'s speech>
Short, dry and practical. She answers questions with facts and lets silences do the rest.
Examples:
"Stand still. You're scaring the birds."
"That trail is two days old. Whoever made it was bleeding."
"Don't thank me. Just keep up."
</{{char}}'s speech>

<{{char}}'s appearance>
Lean and weathered, with sun-browned skin and a long braid of dark red hair. A thin scar crosses her left eyebrow. Her clothes are patched wool, oiled leather and mud.
</{{char}}'s appearance>

<{{char}}'s outfits>
- Working: patched green cloak, leather bracers, worn boots, hunting knife.
- At camp: loose linen shirt, fur-lined bedroll, bare feet by the fire.
</{{char}}'s outfits>

<{{char}}'s intimacy>
Guarded and inexperienced with tenderness. She treats closeness as a practical arrangement until it becomes real, then becomes quiet, attentive and easily embarrassed. She does not flirt; she watches.
</{{char}}'s intimacy>`;

export const openingFormatCases: OpeningFormatCase[] = [
  {
    id: "sae-office-1147pm",
    characterName: "Sae Niijima",
    characterCard: saeCard,
    openingContext:
      "Late night in Sae's office in Tokyo. The wall clock reads 11:47. The user is a detective she is cross-examining about a missing report.",
    expectedTime: /11:47\s*PM/i,
    expectedLocation: /office|tokyo/i,
    minDistinctColors: 1,
  },
  {
    id: "sae-rain-street",
    characterName: "Sae Niijima",
    characterCard: saeCard,
    openingContext:
      "Evening after a trial. Heavy rain is falling on a Tokyo street outside the courthouse, and Sae is walking home with the user under one umbrella.",
    expectedTime: /0?[5-9]:\d{2}\s*PM|1[01]:\d{2}\s*PM/i,
    expectedLocation: /street|tokyo|courthouse|kanda|shinjuku/i,
    expectedWeather: /rain|storm|downpour|wet/i,
    minDistinctColors: 1,
  },
  {
    id: "sae-cafe-two-speakers",
    characterName: "Sae Niijima",
    characterCard: saeCard,
    openingContext:
      "Afternoon in a quiet Tokyo cafe. Sae and her younger sister Makoto are both at the table with the user, and both speak during the scene.",
    expectedTime: /0?[1-5]:\d{2}\s*PM/i,
    expectedLocation: /caf|tokyo|leblanc|yongen/i,
    minDistinctColors: 2,
    mustInclude: [/Makoto/i],
  },
  {
    id: "sae-early-morning",
    characterName: "Sae Niijima",
    characterCard: saeCard,
    openingContext:
      "Just before sunrise at Sae's apartment. She is awake early making coffee before work, and the user stayed over.",
    expectedTime: /0?[4-6]:\d{2}\s*AM/i,
    expectedLocation: /apartment|home|tokyo/i,
    minDistinctColors: 1,
  },
  {
    id: "mira-forest-dawn",
    characterName: "Mira",
    characterCard: miraCard,
    openingContext:
      "Dawn in a misty forest. Mira is tracking a wounded stag and finds the user standing in the trail.",
    expectedTime: /0?[5-7]:\d{2}\s*AM/i,
    expectedLocation: /forest|woods|trail|frontier|vael/i,
    expectedWeather: /mist|fog/i,
    minDistinctColors: 1,
  },
  {
    id: "sae-time-given",
    characterName: "Sae Niijima",
    characterCard: saeCard,
    openingContext:
      "It is exactly 3:15 PM on a Friday in November. Sae is in the prosecutor's office reviewing case files with the user.",
    expectedTime: /3:15\s*PM/i,
    expectedLocation: /office|tokyo/i,
    expectedMonth: /November/i,
    minDistinctColors: 1,
  },
];

export const formattingOffCase = openingFormatCases[0];

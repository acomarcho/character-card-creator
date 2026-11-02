# Preset Time / Color Formatting for Opening Messages — Logbook

## Status
DONE — implemented, evaluated, reviewed, merged into the `opening-format` branch.

## Problem

The user's SillyTavern preset (`~/roleplay/st-preset/simplified-preset.json`) applies two
formatting rules at runtime:

- **Time and Place**: every response starts with
  `[ Time: HH:MM AM/PM | Day, Month DD | Location | Weather ]`.
- **Colored Dialogue**: spoken dialogue uses `<font color="#HEX">"..."</font>` with one palette
  color per character; narration is never colored.

The character-card creator's opening-message generator did not apply either rule. Every later reply
in SillyTavern would be formatted; the opening message would not.

## User-confirmed decisions

- Header "Day" means weekday + month + day (`Monday, October 20`).
- Toggle is **off by default**, saved in `localStorage`.
- On a failed format check: **one silent repair**, then a warning if it still fails.
- Colors come from the preset palette; the opening assigns them.
- AI edits preserve formatting when the opening already has it.
- Use an in-scene date, **not** the real-world current date.

## What changed

- `references/preset-formatting.md` — vendored rules from `acomarcho/st-preset` @ `9531ec9`
  ("Time and Place" + "Colored Dialogue"), normalized without the preset's backticks and
  unbalanced quotes.
- `lib/reference-prompts.ts` — optional formatting addendum in the opening system prompt,
  a checklist for every quoted line, and a formatting-only repair prompt that includes the previous
  output.
- `lib/opening-format.ts` — header parser, palette/tag validator, colored-narration check,
  uncolored-dialogue check, paragraph cap, time-skip check, and rain/snow header consistency.
- `lib/ai-generation.ts` — optional `validate` + `buildRepairPrompt`; one silent repair with
  `reset-output` reason `format-repair`; `formatWarning` on the `done` event.
- `app/api/generate-opening-message/route.ts` — accepts `presetFormatting`, wires the validator and
  repair.
- `app/page.tsx` — "Apply preset time & color formatting" checkbox (persisted, off by default),
  amber warning if the repair cannot fix the output, and a distinct timeline message for a format
  restart.
- `lib/edit-content.ts` / `lib/edit-generation.ts` — edit prompt keeps an existing header/colors;
  edits validate preserved formatting.
- `evals/opening-format-fixtures.ts`, `evals/run-opening-format.ts`, `evals/checks.ts` — real-API
  eval with six scene types plus an off-mode control.
- `tests/opening-format.test.ts` — 37 unit tests total across the suite.
- `README.md` — toggle behavior and eval command.

## Eval design

6 fixtures × 3 runs, plus an off-mode control × 3 (21 generations + 21 judge calls):

1. Sae's office, explicit 11:47 PM clock.
2. Sae on a rainy Tokyo street in the evening.
3. Sae + Makoto in a cafe, two speakers → two colors.
4. Sae at home before sunrise.
5. Mira (new fantasy card) in a misty forest at dawn.
6. Explicit "3:15 PM on a Friday in November" context.

Checks: exact header shape, expected time/location/month/weather, distinct palette colors, required
content, header/story weather consistency, no-time-skip, paragraph cap, and an LLM judge for
header/scene, colors, and prose (1–5).

## Final eval (3 runs, real DeepSeek)

| Mode | Runs | Success | Format | Time | Location | Month | Weather | Weather match | Colors | Must | Judge header/scene | Judge colors | Judge prose | Repair used | Repair success | Latency |
|------|------|---------|--------|------|----------|-------|---------|---------------|--------|------|--------------------|--------------|-------------|-------------|----------------|---------|
| on | 18 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 5.00/5 | 5.00/5 | 5.00/5 | 33% | 100% | 3086ms |
| off | 3 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 5.00/5 | 5.00/5 | 4.33/5 | 0% | 0% | 2239ms |

Raw results: `/tmp/opencode/opening-format-eval-1793594753724.json`.

The only initial failure mode in the final run was an occasional uncolored quote; the single repair
fixed every one (6/18 runs). Off mode added no header or color tags.

## Eval findings that changed the implementation

1. **First eval (1 run):** one case left two quotes uncolored even after repair. The repair prompt
   did not include the previous output, so it could not "keep the same text". Fixed by passing
   `previousOutput` into the repair prompt and making the repair formatting-only.
2. **Second eval:** header said "Overcast" while the story said "Rain streaked the window." Added
   rain/snow header consistency to the production validator and the eval.
3. **False positives found while tightening the check:**
   - "steam fogged" / "sun's up" / "rain thinned to a gray mist" looked like weather; narrowed the
     check to active rain/snow and added a "rain had stopped/thinned" guard.
   - `{{user}}` mentioned inside another character's dialogue (`"I asked {{user}} to come today"`)
     was flagged as user dialogue; removed that check. The prompt already forbids writing
     `{{user}}`'s dialogue, and the judge scored those outputs 5/5.
4. **Eval fixture too strict:** "LeBlanc Attic, Yongen-Jaya" and "Northern Frontier, Vael" are valid
   in-scene locations but missed the original `cafe|tokyo` / `forest|trail` regexes. Broadened the
   fixture checks after reviewing the outputs.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Unit tests | `npm test` | 37/37 pass |
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npm run lint` | pass |
| Production build | `npm run build` | pass; all three API routes present |
| Route, formatting on | `POST /api/generate-opening-message` on port 3010 | header + palette colors, no format warning |
| Route, edit preservation | `POST /api/edit-content` with "Add heavy rain" | header weather updated to "Heavy rain", colors preserved |
| Browser toggle | `agent-browser` on `http://localhost:3010` | checkbox off by default, persists on reload, generation applied formatting |
| Off mode | eval control × 3 | no header, no color tags |

Screenshot: `/tmp/opencode/opening-format-ui.png`.

## Known limits

- The opening seeds the colors; a later preset reply can still pick different colors for new NPCs.
  That is the preset's behavior, not controlled by the card creator.
- The validator cannot know whether the header time matches the scene unless the scene states it;
  the judge/eval covers that.
- Repair rate is ~33% (6/18) for the first pass, mostly a forgotten quote. The repair is silent and
  adds about 1s on those runs.

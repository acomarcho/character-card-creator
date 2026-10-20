# AI Edit for Character Cards and Opening Messages — Logbook

## Status
IN PROGRESS — scope locked, fixtures pending

## Problem

Users can generate a character card and an opening message, and they can manually paste a
character card. They cannot ask the AI to revise existing content. They want an edit box under
each output where they can write an instruction such as "add that the character likes pandas"
and have the AI apply it.

What "done" means:

1. Character Card output has an "Edit with AI" instruction box and Apply button.
2. Opening Message output has the same, plus a Manual Edit toggle (it is currently read-only).
3. The AI edits the content currently in the box, including manually pasted content.
4. Card edits keep the XML-like section structure; opening edits keep the opening-message rules.
5. A/B test full-document rewrite vs surgical replacement with the real DeepSeek API, pick the
   winner based on measured results, and ship only the winner (unless tests show both are needed).
6. Keep a one-step Undo so a bad edit cannot destroy the previous content.
7. Edits do not use Exa/web tools.
8. Unit tests, a real-API eval, typecheck, lint, build, and a browser check are recorded here.

### Scope lock / non-goals

- In scope: editing existing card/opening text by instruction; manual edit for opening; undo;
  edit endpoint; edit prompts; A/B evaluation.
- Not in scope: chat with the AI, multi-turn edit history, diff UI, version history beyond one
  step, streaming partial rollback UI, changing generation behavior, adding auth/accounts.
- Existing generation UX and prompts must keep working.
- API keys remain client-supplied and are only used in memory; never commit the temp key.

## Key Files

- `app/page.tsx` — single-page client UI, manual card edit, generation streams.
- `app/api/generate-character-card/route.ts` — card generation route.
- `app/api/generate-opening-message/route.ts` — opening generation route.
- `lib/ai-generation.ts` — shared streaming + Exa MCP generation helper.
- `lib/reference-prompts.ts` — prompt builders + output cleanup.
- `references/character-card.md` — one-shot card.
- `references/opening-message.md` — one-shot opening.
- `evals/` — A/B eval fixtures, strategies, runner (new).
- `tests/` — unit tests (new).

## Commands

```bash
# Unit tests (Node 22 built-in runner + type stripping)
node --experimental-strip-types --test tests/*.test.ts

# A/B eval (requires a real DeepSeek key in the environment, never written to disk)
DEEPSEEK_API_KEY=... node --experimental-strip-types evals/run-edit-ab.ts

# App checks
npm run lint
npx tsc --noEmit
npm run build

# Integration
npm run dev
curl -N -X POST http://localhost:3000/api/edit-content ...
```

## Design

### Scope decisions (user-confirmed)
- Opening message gets the same Manual Edit toggle as the character card. (CHOSEN)
- Edit instruction operates on whatever text is currently in the output box, including manual
  pastes. (CHOSEN)
- Edits skip Exa/web tools. (CHOSEN)
- One-step Undo for edits. (CHOSEN)
- Endpoint shape is left to engineering. (CHOSEN: one `POST /api/edit-content` with a `target`
  discriminator.)

### Edit strategy A/B (pending results)
- A — Full-document rewrite: model receives current content + instruction, returns the complete
  revised content. Streams naturally and reuses the existing NDJSON stream.
- B — Surgical replacement: model returns `{ edits: [{ find, replace }] }`, applied by code with
  exact-match validation (must occur exactly once), one repair retry on invalid output.
- Winner replaces the other in production code. Eval artifacts may stay only if they are part of
  the test suite; otherwise remove them.

## Principles
1. An AI edit must never silently lose the user's current text: keep the base and offer Undo.
2. The edit prompt must preserve everything not requested; "only change X" is the contract.
3. Test the actual model behavior with real cases, not just prompt strings.

## Iteration Log

### Iteration 0 — Baseline

**Date:** 2026-10-20

**Current state:** No edit UI, no edit endpoint, opening message is read-only `<pre>`. Editing a
generated card requires enabling Manual Edit and doing it by hand.

**Baseline results:**
| Case | Result | Notes |
|------|--------|-------|
| POST /api/edit-content | 404 | Route does not exist |
| Opening manual edit | Fail | No toggle, output is read-only |
| AI edit (card/opening) | Fail | No feature |

**Plan:** Build production-shaped fixtures and both strategies, prove the baseline has no editing
path, then run the real-API A/B before touching production UI.

### Iteration 1 — A/B: full rewrite vs surgical replacement

**Date:** 2026-10-20

**Hypothesis/Goal:** Measure which edit strategy applies instructions accurately while preserving
unrelated content, with acceptable latency, on production-shaped content.

**Setup:** 10 fixtures (6 card, 4 opening) in `evals/fixtures.ts`, both strategies at
temperature 0.2, 3 runs each (60 generations + 60 judge calls). Real DeepSeek API. Card fixture is
`references/character-card.md`; opening fixture was generated once by the real app prompt.
Checks: format contract, deterministic must-include/must-exclude, judge adherence/preservation,
word Jaccard, sentence preservation, latency, retries.

**Results (3 runs):**
| Strategy | Success | Format | Det. adherence | Judge adherence | Judge preservation | Word Jaccard | Sentence preservation | Latency | Retries |
|----------|---------|--------|----------------|-----------------|--------------------|--------------|-----------------------|---------|---------|
| rewrite | 100% | 100% | 90% | 4.43/5 | 4.57/5 | 0.90 | 87% | 2258ms | 0.00 |
| surgical | 100% | 100% | 90% | 4.50/5 | 4.60/5 | 0.90 | 87% | 1285ms | 0.00 |

Shared failure: `opening-shorten` (both ~680 chars vs 631 target; judge 2/5). Not a
strategy differentiator; the instruction asks to tighten an already-two-paragraph message.
Broad tone edit (`card-warmer-tone`) is the noisiest case; surgical preserved more original
sentences in 2/3 runs (84% vs 68%, 84% vs 70%, 84% vs 65%) and was faster.

**RCA:** Surgical wins by doing less work: it returns only the changed span, so unaffected text is
never re-emitted. Rewrite spends ~1s more re-emitting the whole document and occasionally rewrites
sentences outside the requested change. Reliability was equal; surgical had 0/30 apply failures.
Surgical costs a non-streaming generation (~1.0-1.8s), which is acceptable for edits and can show
a status timeline.

**Decision:** Ship **surgical replacement** with one repair retry, post-apply format validation,
and one-step Undo. Keep the eval harness as the requested A/B artifact. Remove rewrite from
production code.

### Iteration 2 — Re-run A/B against the production surgical implementation

**Date:** 2026-10-20

**Hypothesis/Goal:** Confirm the decision after wiring the eval to the real production prompt,
`applySurgicalEdits`, `postProcessEdit`, and validation/retry (including a placeholder check for
placeholders named in the instruction). A single surgical run missed `{{user}}` in
`card-add-speech-quirk`, so production now retries when the instruction names a placeholder that
the output drops.

**Changes:**
- `lib/edit-content.ts` — production surgical prompt, apply, post-process, structure/placeholder
  validation. Removed the standard-section list from the prompt so pasted cards with custom
  sections are preserved instead of "corrected".
- `evals/strategies.ts` — surgical path now imports the production prompt/apply/post-process/
  validation functions. Rewrite remains eval-only.
- `lib/edit-generation.ts` — NDJSON status/done stream with one repair retry.
- `app/api/edit-content/route.ts` — single target-discriminated endpoint, no Exa.
- `app/page.tsx` — AI edit forms for both outputs, opening manual edit, one-step undo.
- `tests/edit-content.test.ts`, `tests/integration-edit.ts` — unit + real-route checks.

**Final A/B results (3 runs, 60 generations + judges):**
| Strategy | Success | Format | Det. adherence | Judge adherence | Judge preservation | Word Jaccard | Sentence preservation | Latency | Retries |
|----------|---------|--------|----------------|-----------------|--------------------|--------------|-----------------------|---------|---------|
| rewrite | 100% | 100% | 90% | 4.53/5 | 4.50/5 | 0.90 | 87% | 2264ms | 0.00 |
| surgical | 100% | 100% | 90% | 4.77/5 | 4.73/5 | 0.90 | 86% | 1278ms | 0.03 |

Only shared failure: `opening-shorten` (all 6 runs) — the model shortens by ~8-14%, below the
15% fixture threshold. Not a strategy differentiator. One surgical retry (speech-quirk) fixed the
missing `{{user}}` placeholder, which is why the retry exists.

**RCA:** Surgical preserves the document by construction, is ~1s faster, and scored higher on
both judge dimensions with equal deterministic adherence. The retry cost is negligible (1/30).

**Decision:** Ship surgical. Done with strategy selection.

### Iteration 3 — Implementation + verification

**Date:** 2026-10-20

**Changes:** see Iteration 2 file list; UI verified manually with `agent-browser` at
`http://localhost:3010`: pasted the reference card → "Add a detail that she secretly loves
pandas." → output gained a panda detail, Undo appeared, Undo removed it. Pasted the opening →
"Add that heavy rain is hitting the office windows." → rain added, no asterisks, Undo appeared.
Screenshot: `/tmp/edit-feature.png`.

**Test Results:**
| Check | Command | Result |
|-------|---------|--------|
| Unit tests | `npm test` | 15/15 pass |
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npm run lint` | pass |
| Production build | `npm run build` | pass; `/api/edit-content` present |
| Route integration | `npm run test:integration` (real API) | pass: card keeps tag sequence, panda inserted, opening gains rain, no asterisks, no web-tool status, empty input 400s |
| Browser card edit + undo | `agent-browser` | pass |
| Browser opening edit + manual paste | `agent-browser` | pass |

**Plan:** Run unslopify-simplify, then fresh-reviewer-loop; apply only accepted findings and
re-run this same validation.

### Iteration 4 — Fresh review round 1 and fixes

**Date:** 2026-10-20

**Reviewer findings and triage:**
- BLOCKER (accepted): `postProcessEdit` stripped asterisks from the whole opening, deleting asterisks the user pasted into untouched text, and made the asterisk rule unenforceable because validation saw the stripped text. Fix: renamed to `sanitizeEditText` and applied it only to each `replace` fragment; validation now checks structure/placeholders/paragraphs on the surgical result, and untouched user text is preserved. Tests added in `tests/edit-stream.test.ts`.
- MAJOR (accepted): Generate buttons were not disabled during an AI edit, so a concurrent generation could clobber the edit result with stale content. Fix: `canGenerateCard`/`canGenerateOpening` now include `!isEditing*`, and both generation handlers return early if an edit is in flight.
- MAJOR (accepted): the production retry loop was untested. Fix: `createEditStream` accepts an injectable `EditGenerator`; `tests/edit-stream.test.ts` covers retry-then-success, structural validation retry, fragment sanitization, and both-attempts-fail error emission (19 unit tests total).
- MINOR (accepted): eval reimplemented production validation. `validateFormat` now delegates to `validateEditedContent`; surgical imports production prompt/apply/sanitize/validation; `judgeAdherence` dead field removed.
- MINOR (accepted): retry status wording no longer claims "invalid" on API errors; duplicate `toErrorMessage` removed by exporting the one in `lib/ai-generation.ts`.
- MINOR (deferred): placeholder invariant blocks an instruction that deliberately removes a placeholder. Unlikely in real cards (tag names carry `{{char}}`) and the placeholder contract is intentional.
- MINOR (rejected): malformed JSON returns 500. The two existing generation routes behave the same; changing only the edit route would be inconsistent scope creep.

**Final A/B after fixes (3 runs):**
| Strategy | Success | Format | Det. adherence | Judge adherence | Judge preservation | Word Jaccard | Sentence preservation | Latency | Retries |
|----------|---------|--------|----------------|-----------------|--------------------|--------------|-----------------------|---------|---------|
| rewrite | 100% | 100% | 90% | 4.50/5 | 4.47/5 | 0.90 | 86% | 2287ms | 0.00 |
| surgical | 100% | 100% | 93% | 4.67/5 | 4.70/5 | 0.90 | 86% | 1247ms | 0.03 |

Only `opening-shorten` failed (5/6 runs). Surgical wins on every axis.

**Re-validation after fixes:** `npm test` 19/19, `npx tsc --noEmit` pass, `npm run lint` pass, `npm run build` pass, `npm run test:integration` pass (real API), browser re-check: pasted opening `Rain fell. *Sae looked up from the file.*` + "Change rain to snow." → `Snow fell. *Sae looked up from the file.*` (untouched asterisks preserved).

### Iteration 5 — Fresh review round 2 and fixes

**Date:** 2026-10-20

**Reviewer findings and triage:**
- MAJOR (accepted): cross-target clobber. Card generation clears the opening, so it could wipe an in-flight opening edit; opening editing could start during card generation. Fix: `canGenerateCard`/`handleGenerateCard` now also block `isEditingOpening`; `canEditOpening`/`handleEditOpening` now block `isGeneratingCard`.
- MAJOR (accepted): validation judged untouched pasted text. A pasted opening starting with "Here is..." or a pasted card containing a fence was permanently uneditable. Fix: fence/preamble checks now fire only when the edit introduces them (`bad(edited) && !bad(original)`), and the preamble pattern no longer matches a bare "Sure".
- MINOR (accepted): structural validation ignored closing tags. Fix: tag comparison now captures the full opening+closing sequence; added an unbalanced-closing-tag test and strengthened the integration helper.

**Re-validation:** `npm test` 21/21, typecheck/lint/build pass, `npm run test:integration` pass (real API).

**Final A/B after round 2 (3 runs):**
| Strategy | Success | Format | Det. adherence | Judge adherence | Judge preservation | Word Jaccard | Sentence preservation | Latency | Retries |
|----------|---------|--------|----------------|-----------------|--------------------|--------------|-----------------------|---------|---------|
| rewrite | 100% | 100% | 90% | 4.50/5 | 4.47/5 | 0.90 | 86% | 2307ms | 0.00 |
| surgical | 100% | 100% | 93% | 4.60/5 | 4.57/5 | 0.90 | 86% | 1301ms | 0.07 |

Only shared failure: `opening-shorten`. Surgical retries on `card-add-speech-quirk` fixed the
missing `{{user}}` placeholder in 2/3 runs. Surgical wins on every axis.

### Iteration 6 — Fresh review round 3 (converged) and minor cleanup

**Date:** 2026-10-20

**Reviewer result:** "No blockers or majors found - implementation is ready for merge."

**Minor observations handled:**
- Opening generation/opening edit could read a stale card while a card AI edit was in flight. Fix: `canGenerateOpening`/`handleGenerateOpeningMessage` and `canEditOpening`/`handleEditOpening` now also block `isEditingCard`.
- The preamble heuristic could reject a legitimate first line ("I've been waiting for you."). It was a heuristic, not a structural invariant; removed the preamble check entirely. Fences introduced by the edit are still rejected.

**Final eval run (3 runs, after all fixes):**
| Strategy | Success | Format | Det. adherence | Judge adherence | Judge preservation | Word Jaccard | Sentence preservation | Latency | Retries |
|----------|---------|--------|----------------|-----------------|--------------------|--------------|-----------------------|---------|---------|
| rewrite | 100% | 100% | 90% | 4.50/5 | 4.53/5 | 0.90 | 86% | 2227ms | 0.00 |
| surgical | 100% | 100% | 90% | 4.67/5 | 4.63/5 | 0.90 | 86% | 1201ms | 0.03 |

Across the last three 3-run evals, surgical deterministic adherence was 90-93%, rewrite 90%;
surgical judge adherence/preservation was consistently higher and latency consistently ~1s lower.
The only recurring deterministic failure is `opening-shorten` (both strategies). Surgical remains
the winner.

**Re-validation:** `npm test` 21/21, typecheck/lint/build pass, `npm run test:integration` pass.

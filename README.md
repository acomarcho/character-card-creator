# Character Card Creator

A Next.js app to generate **SillyTavern-ready character cards** and **opening messages** using:

- [Vercel AI SDK](https://ai-sdk.dev/docs)
- [DeepSeek provider](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)
- [Exa MCP tools](https://exa.ai/docs/reference/exa-mcp) for web-search-capable agentic calls

## What this app does

- Generates a full character card from:
  - Character name
  - Starting context
- Uses a system prompt that embeds the exact one-shot reference from:
  - `references/character-card.md`
- Generates an opening message from:
  - Generated character card
  - Optional opening-message context
  - Optional preset time/color formatting
- Uses a system prompt that embeds the exact one-shot reference from:
  - `references/opening-message.md`
- Shows outputs in a codeblock-style panel with **copy-to-clipboard** buttons.

## Preset time and color formatting

Section 2 has an optional **Apply preset time & color formatting** toggle (off by default, saved in `localStorage`). When it is on, the opening message gets:

- the time/place header `[ Time: HH:MM AM/PM | Weekday, Month DD | Location | Weather ]`
- spoken dialogue wrapped in `<font color="#HEX">...</font>` using the preset palette

The rules are vendored in `references/preset-formatting.md` from `acomarcho/st-preset` @ `9531ec9` (the "Time and Place" and "Colored Dialogue" prompts). Output is validated after generation, and one silent repair is attempted if the header or colors are malformed. AI edits preserve the formatting when the current opening already has it.

Run the real-API eval:

```bash
DEEPSEEK_API_KEY=... npm run eval:opening-format -- 3
```

## API key behavior (no `.env` required)

- **DeepSeek API key** is entered in the frontend.
- **Exa API key** is entered in the frontend (optional but recommended for web search).
- Both are saved in browser `localStorage`.
- No provider keys are required in server environment variables.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Routes

- `POST /api/generate-character-card`
- `POST /api/generate-opening-message`

Each route accepts provider keys from the request body and executes AI SDK generation server-side.

## Notes

- If Exa MCP cannot be reached, the app falls back to generation without tools and shows a notice.
- The character card template structure is intentionally strict and aligned with the reference one-shot.

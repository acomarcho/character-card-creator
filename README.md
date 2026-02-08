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
- Uses a system prompt that embeds the exact one-shot reference from:
  - `references/opening-message.md`
- Shows outputs in a codeblock-style panel with **copy-to-clipboard** buttons.

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

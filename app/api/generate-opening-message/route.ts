import { NextResponse } from "next/server";
import { z } from "zod";

import { createAgenticGenerationStream } from "@/lib/ai-generation";
import {
  buildOpeningFormatRepairPrompt,
  buildOpeningMessageSystemPrompt,
  buildOpeningMessageUserPrompt,
  stripAsterisks,
} from "@/lib/reference-prompts";
import { validateOpeningFormat } from "@/lib/opening-format";

export const runtime = "nodejs";

const payloadSchema = z.object({
  deepseekApiKey: z.string().trim().min(1, "DeepSeek API key is required."),
  exaApiKey: z.string().trim().optional(),
  characterName: z.string().trim().min(1, "Character name is required."),
  characterCard: z
    .string()
    .trim()
    .min(1, "Generate or paste a character card first."),
  openingContext: z.string().optional(),
  presetFormatting: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const payload = payloadSchema.parse(json);

    const stream = createAgenticGenerationStream({
      apiKey: payload.deepseekApiKey,
      exaApiKey: payload.exaApiKey,
      system: buildOpeningMessageSystemPrompt({
        presetFormatting: payload.presetFormatting,
      }),
      prompt: buildOpeningMessageUserPrompt({
        characterName: payload.characterName,
        characterCard: payload.characterCard,
        openingContext: payload.openingContext,
      }),
      postProcess: stripAsterisks,
      validate: payload.presetFormatting
        ? (text: string) => validateOpeningFormat(text).problems
        : undefined,
      buildRepairPrompt: payload.presetFormatting
        ? buildOpeningFormatRepairPrompt
        : undefined,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          "Failed to generate opening message. Verify your API keys and try again.",
      },
      { status: 500 },
    );
  }
}

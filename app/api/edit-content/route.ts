import { NextResponse } from "next/server";
import { z } from "zod";

import { EDIT_TARGETS } from "@/lib/edit-content";
import { createEditStream } from "@/lib/edit-generation";

export const runtime = "nodejs";

const payloadSchema = z.object({
  deepseekApiKey: z.string().trim().min(1, "DeepSeek API key is required."),
  target: z.enum(EDIT_TARGETS),
  content: z
    .string()
    .refine((value) => value.trim().length > 0, "Add content to edit first."),
  instruction: z
    .string()
    .trim()
    .min(1, "Describe the edit you want to make."),
  characterName: z.string().trim().optional(),
  characterCard: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const payload = payloadSchema.parse(json);

    const stream = createEditStream({
      apiKey: payload.deepseekApiKey,
      target: payload.target,
      content: payload.content,
      instruction: payload.instruction,
      characterName: payload.characterName,
      characterCard: payload.characterCard,
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
          "Failed to edit content. Verify your API key and try again.",
      },
      { status: 500 },
    );
  }
}

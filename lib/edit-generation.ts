import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateObject } from "ai";
import { z } from "zod";

import {
  toErrorMessage,
  type GenerationStreamEvent,
} from "./ai-generation.ts";
import {
  applySurgicalEdits,
  buildEditSystemPrompt,
  buildEditUserPrompt,
  sanitizeEditText,
  validateEditedContent,
  type EditTarget,
  type SurgicalEdit,
} from "./edit-content.ts";

type EditStreamInput = {
  apiKey: string;
  target: EditTarget;
  content: string;
  instruction: string;
  characterName?: string;
  characterCard?: string;
};

export type EditGenerator = (input: {
  system: string;
  prompt: string;
}) => Promise<SurgicalEdit[]>;

const editListSchema = z.object({
  edits: z
    .array(
      z.object({
        find: z.string(),
        replace: z.string(),
      }),
    )
    .min(1),
});

function createDefaultEditGenerator(apiKey: string): EditGenerator {
  const provider = createDeepSeek({ apiKey });

  return async ({ system, prompt }) => {
    const result = await generateObject({
      model: provider("deepseek-chat"),
      schema: editListSchema,
      system,
      prompt,
      temperature: 0.2,
    });

    return result.object.edits;
  };
}

export function createEditStream(
  input: EditStreamInput,
  generateEdits?: EditGenerator,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const generate = generateEdits ?? createDefaultEditGenerator(input.apiKey);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: GenerationStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const run = async () => {
        let retryReason: string | undefined;

        for (let attempt = 0; attempt < 2; attempt += 1) {
          emit({
            type: "status",
            phase: "generating",
            message:
              attempt === 0
                ? "Writing surgical edit..."
                : "Retrying edit...",
          });

          try {
            const edits = await generate({
              system: buildEditSystemPrompt(input.target),
              prompt: buildEditUserPrompt({
                target: input.target,
                content: input.content,
                instruction: input.instruction,
                characterName: input.characterName,
                characterCard: input.characterCard,
                retryReason,
              }),
            });

            emit({
              type: "status",
              phase: "generating",
              message: "Applying replacements...",
            });

            const sanitized = edits.map((edit) => ({
              find: edit.find,
              replace: sanitizeEditText(input.target, edit.replace),
            }));

            const applied = applySurgicalEdits(input.content, sanitized);

            if (!applied.ok) {
              retryReason = applied.error;
              continue;
            }

            const validation = validateEditedContent(
              input.target,
              input.content,
              applied.content,
              input.instruction,
            );

            if (!validation.ok) {
              retryReason = validation.problems.join(" ");
              continue;
            }

            emit({
              type: "status",
              phase: "done",
              message: "Edit applied.",
            });
            emit({
              type: "done",
              output: applied.content,
              usedWebTools: false,
            });
            return;
          } catch (error) {
            retryReason = toErrorMessage(error);
          }
        }

        throw new Error(retryReason ?? "The edit failed unexpectedly.");
      };

      void run()
        .catch((error) => {
          emit({
            type: "error",
            error: toErrorMessage(error),
          });
        })
        .finally(() => {
          controller.close();
        });
    },
  });
}

import { createDeepSeek } from "@ai-sdk/deepseek";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { stepCountIs, streamText, type ToolSet } from "ai";

type AgentGenerationInput = {
  apiKey: string;
  exaApiKey?: string;
  system: string;
  prompt: string;
};

type StreamPhase =
  | "connecting_tools"
  | "searching_web"
  | "generating"
  | "fallback"
  | "done";

export type GenerationStreamEvent =
  | {
      type: "status";
      phase: StreamPhase;
      message: string;
    }
  | {
      type: "tool";
      state: "start" | "result" | "error";
      toolName: string;
    }
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "reset-output";
    }
  | {
      type: "done";
      output: string;
      usedWebTools: boolean;
      toolWarning?: string;
    }
  | {
      type: "error";
      error: string;
    };

type AgenticStreamInput = AgentGenerationInput & {
  postProcess?: (text: string) => string;
};

const EXA_MCP_BASE_URL = "https://mcp.exa.ai/mcp";
const EXA_TOOLS = [
  "web_search_exa",
  "company_research_exa",
  "get_code_context_exa",
] as const;

function buildExaMcpUrl(exaApiKey?: string): string {
  const url = new URL(EXA_MCP_BASE_URL);
  url.searchParams.set("tools", EXA_TOOLS.join(","));

  if (exaApiKey?.trim()) {
    url.searchParams.set("exaApiKey", exaApiKey.trim());
  }

  return url.toString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Generation failed unexpectedly.";
}

export function createAgenticGenerationStream(
  input: AgenticStreamInput,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const provider = createDeepSeek({ apiKey: input.apiKey });

      const emit = (event: GenerationStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const run = async () => {
        let mcpClient: MCPClient | undefined;
        let tools: ToolSet = {};
        let outputText = "";
        let toolWarning: string | undefined;
        let usedWebTools = false;

        emit({
          type: "status",
          phase: "connecting_tools",
          message: "Connecting web-search tools...",
        });

        try {
          mcpClient = await createMCPClient({
            transport: {
              type: "http",
              url: buildExaMcpUrl(input.exaApiKey),
            },
          });

          tools = await mcpClient.tools();
          usedWebTools = Object.keys(tools).length > 0;

          emit({
            type: "status",
            phase: "generating",
            message: usedWebTools
              ? "Web tools connected. Starting generation..."
              : "No web tools available. Starting generation...",
          });
        } catch {
          toolWarning =
            "Exa MCP tools could not be connected. Continuing without web search tools.";

          emit({
            type: "status",
            phase: "generating",
            message: toolWarning,
          });
        }

        const streamWithTools = async (activeTools: ToolSet) => {
          const result = streamText({
            model: provider("deepseek-chat"),
            system: input.system,
            prompt: input.prompt,
            tools: activeTools,
            stopWhen: stepCountIs(6),
            temperature: 0.7,
          });

          for await (const part of result.fullStream) {
            if (part.type === "tool-input-start") {
              emit({
                type: "status",
                phase: "searching_web",
                message: `Using ${part.toolName}...`,
              });
              emit({
                type: "tool",
                state: "start",
                toolName: part.toolName,
              });
            }

            if (part.type === "tool-result") {
              emit({
                type: "status",
                phase: "searching_web",
                message: `Received results from ${part.toolName}.`,
              });
              emit({
                type: "tool",
                state: "result",
                toolName: part.toolName,
              });
            }

            if (part.type === "tool-error") {
              emit({
                type: "tool",
                state: "error",
                toolName: part.toolName,
              });
            }

            if (part.type === "text-delta") {
              outputText += part.text;
              emit({
                type: "text-delta",
                delta: part.text,
              });
            }

            if (part.type === "error") {
              throw part.error;
            }
          }
        };

        try {
          await streamWithTools(tools);
        } catch (error) {
          if (usedWebTools) {
            emit({
              type: "status",
              phase: "fallback",
              message:
                "Tool-augmented generation failed. Retrying without web tools...",
            });
            emit({ type: "reset-output" });

            outputText = "";
            usedWebTools = false;
            toolWarning =
              toolWarning ??
              "Tool-augmented generation failed once. The output was regenerated without web tools.";

            await streamWithTools({});
          } else {
            throw error;
          }
        }

        const finalOutput = input.postProcess
          ? input.postProcess(outputText)
          : outputText;

        emit({
          type: "status",
          phase: "done",
          message: "Generation complete.",
        });
        emit({
          type: "done",
          output: finalOutput,
          usedWebTools,
          toolWarning,
        });

        await mcpClient?.close();
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

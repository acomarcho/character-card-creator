import { createDeepSeek } from "@ai-sdk/deepseek";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { generateText, stepCountIs, type ToolSet } from "ai";

type AgentGenerationInput = {
  apiKey: string;
  exaApiKey?: string;
  system: string;
  prompt: string;
};

type AgentGenerationResult = {
  text: string;
  usedWebTools: boolean;
  toolWarning?: string;
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

export async function runAgenticGeneration(
  input: AgentGenerationInput,
): Promise<AgentGenerationResult> {
  const provider = createDeepSeek({ apiKey: input.apiKey });

  let mcpClient: MCPClient | undefined;
  let tools: ToolSet = {};
  let toolWarning: string | undefined;

  try {
    mcpClient = await createMCPClient({
      transport: {
        type: "http",
        url: buildExaMcpUrl(input.exaApiKey),
      },
    });

    tools = await mcpClient.tools();
  } catch {
    toolWarning =
      "Exa MCP tools could not be connected. Generation continued without web search tools.";
  }

  const usedWebTools = Object.keys(tools).length > 0;

  try {
    const firstTry = await generateText({
      model: provider("deepseek-chat"),
      system: input.system,
      prompt: input.prompt,
      tools,
      stopWhen: stepCountIs(6),
      temperature: 0.7,
    });

    return {
      text: firstTry.text,
      usedWebTools,
      toolWarning,
    };
  } catch {
    const fallback = await generateText({
      model: provider("deepseek-chat"),
      system: input.system,
      prompt: input.prompt,
      temperature: 0.7,
    });

    return {
      text: fallback.text,
      usedWebTools: false,
      toolWarning:
        toolWarning ??
        "Tool-augmented generation failed once. The output was generated without tools.",
    };
  } finally {
    await mcpClient?.close();
  }
}


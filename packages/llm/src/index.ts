import { generateText, streamText, type CoreMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

export type ModelProvider = "openai" | "anthropic";

export interface LLMConfig {
  provider: ModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionRequest {
  systemPrompt: string;
  messages: CoreMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

function getModel(config: LLMConfig) {
  switch (config.provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: config.apiKey || process.env.OPENAI_API_KEY,
        baseURL: config.baseUrl,
      });
      return openai(config.model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
        baseURL: config.baseUrl,
      });
      return anthropic(config.model);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export async function complete(
  config: LLMConfig,
  request: CompletionRequest
): Promise<CompletionResponse> {
  const model = getModel(config);

  const result = await generateText({
    model,
    system: request.systemPrompt,
    messages: request.messages,
    maxTokens: request.maxTokens ?? config.maxTokens ?? 4096,
    temperature: request.temperature ?? config.temperature ?? 0.7,
  });

  return {
    text: result.text,
    usage: result.usage ? {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    } : undefined,
  };
}

export async function* streamComplete(
  config: LLMConfig,
  request: CompletionRequest
): AsyncGenerator<string, CompletionResponse, unknown> {
  const model = getModel(config);

  const result = streamText({
    model,
    system: request.systemPrompt,
    messages: request.messages,
    maxTokens: request.maxTokens ?? config.maxTokens ?? 4096,
    temperature: request.temperature ?? config.temperature ?? 0.7,
  });

  let fullText = "";
  
  for await (const chunk of result.textStream) {
    fullText += chunk;
    yield chunk;
  }

  const finalResult = await result;
  
  return {
    text: fullText,
    usage: finalResult.usage ? {
      promptTokens: finalResult.usage.promptTokens,
      completionTokens: finalResult.usage.completionTokens,
      totalTokens: finalResult.usage.totalTokens,
    } : undefined,
  };
}

// Helper to parse model string like "openai/gpt-4" or "anthropic/claude-3-opus"
export function parseModelString(modelString: string): LLMConfig {
  const [provider, ...modelParts] = modelString.split("/");
  const model = modelParts.join("/");

  if (!["openai", "anthropic"].includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    provider: provider as ModelProvider,
    model,
  };
}

export type { CoreMessage };

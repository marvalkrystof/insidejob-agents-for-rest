import type { BaseMessage } from "@langchain/core/messages";
import type { InteropZodType } from "@langchain/core/utils/types";
import { ChatOpenAI } from "@langchain/openai";
import { readOptionalEnv, requireEnv } from "../libs/env.utils";
import { describeError } from "../libs/error.utils";

export const FEATHERLESS_BASE_URL = "https://api.featherless.ai/v1";
export const DEFAULT_FEATHERLESS_MODEL = "moonshotai/Kimi-K2-Instruct-0905";

// The $25 Chat plan has 4 concurrency units and Kimi costs all 4: one call at a time, retries absorb HTTP 429.
const MAX_CONCURRENT_CALLS = 1;
const MAX_RETRIES = 3;
const MAX_OUTPUT_TOKENS = 2000;

export const resolveFeatherlessModel = (): string => readOptionalEnv("FEATHERLESS_MODEL") ?? DEFAULT_FEATHERLESS_MODEL;

export const createFeatherlessChatModel = (): ChatOpenAI =>
  new ChatOpenAI({
    model: resolveFeatherlessModel(),
    apiKey: requireEnv("FEATHERLESS_API_KEY"),
    configuration: { baseURL: FEATHERLESS_BASE_URL },
    temperature: 0,
    maxTokens: MAX_OUTPUT_TOKENS,
    maxConcurrency: MAX_CONCURRENT_CALLS,
    maxRetries: MAX_RETRIES,
  });

/**
 * Structured output via tool calling (verified on Featherless); falls back to JSON mode, which is why every
 * prompt also describes the expected JSON shape in words.
 */
export const invokeStructured = async <TOutput extends Record<string, unknown>>(
  schema: InteropZodType<TOutput>,
  name: string,
  messages: BaseMessage[],
): Promise<TOutput> => {
  const model = createFeatherlessChatModel();
  try {
    return await model.withStructuredOutput(schema, { method: "functionCalling", name }).invoke(messages);
  } catch (error) {
    const reason = describeError(error);
    console.warn(`[llm] ${name}: tool-calling output failed (${reason.slice(0, 200)}), retrying in JSON mode`);
    return model.withStructuredOutput(schema, { method: "jsonMode", name }).invoke(messages);
  }
};

import { fetchJson } from "./http.js";
import {
  envValue,
  extractOpenAiContent,
  ProviderError,
  stripTrailingSlash,
  toProviderError,
} from "./provider.js";
import type {
  ChatMessage,
  ChatOptions,
  Provider,
  ProviderOptions,
} from "./provider.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;

/**
 * DeepSeek's cloud API is OpenAI-compatible and requires an API key.
 * Note: using this provider uploads repository content to a third party.
 */
export function createDeepSeekProvider(
  options: ProviderOptions = {},
): Provider {
  const apiKey =
    options.apiKey ??
    envValue("SPECDRIFT_DEEPSEEK_API_KEY") ??
    envValue("DEEPSEEK_API_KEY");

  if (!apiKey) {
    throw new ProviderError(
      "DeepSeek requires an API key: set DEEPSEEK_API_KEY or pass --api-key",
      "deepseek",
    );
  }

  const baseUrl = stripTrailingSlash(
    options.baseUrl ??
      envValue("SPECDRIFT_DEEPSEEK_BASE_URL") ??
      DEFAULT_BASE_URL,
  );
  const defaultModel =
    options.model ?? envValue("SPECDRIFT_DEEPSEEK_MODEL") ?? DEFAULT_MODEL;

  const authHeaders = (): Record<string, string> => ({
    authorization: `Bearer ${apiKey}`,
  });

  return {
    id: "deepseek",
    isLocal: false,

    async chat(
      messages: ChatMessage[],
      chatOptions: ChatOptions = {},
    ): Promise<string> {
      try {
        const data = await fetchJson(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: authHeaders(),
          body: {
            model: chatOptions.model ?? defaultModel,
            messages,
            stream: false,
            temperature: chatOptions.temperature ?? options.temperature,
            max_tokens: chatOptions.maxTokens ?? options.maxTokens,
          },
          timeoutMs:
            chatOptions.timeoutMs ??
            options.timeoutMs ??
            DEFAULT_CHAT_TIMEOUT_MS,
          signal: chatOptions.signal,
        });

        return extractOpenAiContent(data, "deepseek");
      } catch (error) {
        throw toProviderError(error, "deepseek");
      }
    },

    async healthCheck(timeoutMs = 2_000): Promise<boolean> {
      try {
        await fetchJson(`${baseUrl}/models`, {
          headers: authHeaders(),
          timeoutMs,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

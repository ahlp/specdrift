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

const DEFAULT_BASE_URL = "http://localhost:1234/v1";
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

/**
 * LM Studio exposes an OpenAI-compatible API, normally on port 1234.
 * No API key is required for a local server.
 */
export function createLmStudioProvider(
  options: ProviderOptions = {},
): Provider {
  const baseUrl = stripTrailingSlash(
    options.baseUrl ??
      envValue("SPECDRIFT_LMSTUDIO_BASE_URL") ??
      DEFAULT_BASE_URL,
  );

  let discoveredModel: string | undefined;

  const authHeaders = (): Record<string, string> =>
    options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {};

  const discoverModel = async (timeoutMs: number): Promise<string> => {
    let data: ModelsResponse;
    try {
      data = (await fetchJson(`${baseUrl}/models`, {
        headers: authHeaders(),
        timeoutMs,
      })) as ModelsResponse;
    } catch (error) {
      throw toProviderError(error, "lmstudio");
    }

    const model = data.data?.[0]?.id;
    if (!model) {
      throw new ProviderError(
        "LM Studio is reachable but exposes no models; load a model or pass --model",
        "lmstudio",
      );
    }

    return model;
  };

  return {
    id: "lmstudio",
    isLocal: true,

    async chat(
      messages: ChatMessage[],
      chatOptions: ChatOptions = {},
    ): Promise<string> {
      const timeoutMs =
        chatOptions.timeoutMs ?? options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;

      const model =
        chatOptions.model ??
        options.model ??
        discoveredModel ??
        (discoveredModel = await discoverModel(Math.min(timeoutMs, 10_000)));

      try {
        const data = await fetchJson(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: authHeaders(),
          body: {
            model,
            messages,
            stream: false,
            temperature: chatOptions.temperature ?? options.temperature,
            max_tokens: chatOptions.maxTokens ?? options.maxTokens,
          },
          timeoutMs,
          signal: chatOptions.signal,
        });

        return extractOpenAiContent(data, "lmstudio");
      } catch (error) {
        throw toProviderError(error, "lmstudio");
      }
    },

    async healthCheck(timeoutMs = 1_500): Promise<boolean> {
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

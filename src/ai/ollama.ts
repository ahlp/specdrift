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

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;

interface TagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

function isOpenAiCompatible(baseUrl: string): boolean {
  return /\/v1$/.test(baseUrl);
}

/**
 * Ollama supports both its native `/api/chat` API and an OpenAI-compatible
 * `/v1` API. Native is used by default; a base URL ending in `/v1` switches
 * to the OpenAI-compatible endpoint.
 */
export function createOllamaProvider(options: ProviderOptions = {}): Provider {
  const baseUrl = stripTrailingSlash(
    options.baseUrl ??
      envValue("SPECDRIFT_OLLAMA_BASE_URL") ??
      DEFAULT_BASE_URL,
  );
  const openAiCompatible = isOpenAiCompatible(baseUrl);
  const nativeRoot = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;

  let discoveredModel: string | undefined;

  const discoverModel = async (timeoutMs: number): Promise<string> => {
    try {
      if (openAiCompatible) {
        const data = (await fetchJson(`${baseUrl}/models`, {
          timeoutMs,
        })) as ModelsResponse;
        const model = data.data?.[0]?.id;
        if (!model) {
          throw new ProviderError(
            "Ollama is reachable but exposes no models; pull a model or pass --model",
            "ollama",
          );
        }
        return model;
      }

      const data = (await fetchJson(`${nativeRoot}/tags`, {
        timeoutMs,
      })) as TagsResponse;
      const model = data.models?.[0]?.name ?? data.models?.[0]?.model;
      if (!model) {
        throw new ProviderError(
          "Ollama is reachable but exposes no models; pull a model or pass --model",
          "ollama",
        );
      }
      return model;
    } catch (error) {
      throw toProviderError(error, "ollama");
    }
  };

  return {
    id: "ollama",
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
        envValue("SPECDRIFT_OLLAMA_MODEL") ??
        discoveredModel ??
        (discoveredModel = await discoverModel(Math.min(timeoutMs, 10_000)));

      try {
        if (openAiCompatible) {
          const data = await fetchJson(`${baseUrl}/chat/completions`, {
            method: "POST",
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
          return extractOpenAiContent(data, "ollama");
        }

        const data = (await fetchJson(`${nativeRoot}/chat`, {
          method: "POST",
          body: {
            model,
            messages,
            stream: false,
            options: {
              temperature: chatOptions.temperature ?? options.temperature,
              num_predict: chatOptions.maxTokens ?? options.maxTokens,
            },
          },
          timeoutMs,
          signal: chatOptions.signal,
        })) as { message?: { content?: unknown } };

        const content = data.message?.content;
        if (typeof content !== "string" || content.trim() === "") {
          throw new ProviderError(
            "Ollama returned an empty chat completion",
            "ollama",
          );
        }
        return content;
      } catch (error) {
        throw toProviderError(error, "ollama");
      }
    },

    async healthCheck(timeoutMs = 1_500): Promise<boolean> {
      try {
        await fetchJson(
          openAiCompatible ? `${baseUrl}/models` : `${nativeRoot}/tags`,
          { timeoutMs },
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}

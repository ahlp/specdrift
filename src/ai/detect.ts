import { createDeepSeekProvider } from "./deepseek.js";
import { createLmStudioProvider } from "./lmstudio.js";
import { createOllamaProvider } from "./ollama.js";
import { ProviderError, envValue } from "./provider.js";
import type { Provider, ProviderId, ProviderOptions } from "./provider.js";

export const PROVIDER_IDS = ["lmstudio", "ollama", "deepseek"] as const;
export const LOCAL_PROVIDER_IDS = ["lmstudio", "ollama"] as const;

export interface ResolveProviderOptions extends ProviderOptions {
  /** Force a provider instead of auto-detecting. */
  provider?: string;
  /** Health-check timeout used during auto-detection. */
  healthCheckTimeoutMs?: number;
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function createProvider(
  id: ProviderId,
  options: ProviderOptions = {},
): Provider {
  switch (id) {
    case "lmstudio":
      return createLmStudioProvider(options);
    case "ollama":
      return createOllamaProvider(options);
    case "deepseek":
      return createDeepSeekProvider(options);
    default:
      throw new ProviderError(`unknown provider "${String(id)}"`);
  }
}

/**
 * Resolve a provider using this precedence:
 *
 * 1. explicit `provider` option / `SPECDRIFT_PROVIDER`
 * 2. probe LM Studio, then Ollama
 * 3. DeepSeek if an API key is available
 * 4. actionable error
 */
export async function resolveProvider(
  options: ResolveProviderOptions = {},
): Promise<Provider> {
  const {
    provider: requested,
    healthCheckTimeoutMs = 1_200,
    ...providerOptions
  } = options;

  const requestedId = requested ?? envValue("SPECDRIFT_PROVIDER");

  if (requestedId) {
    if (!isProviderId(requestedId)) {
      throw new ProviderError(
        `unknown provider "${requestedId}" (expected ${PROVIDER_IDS.join(", ")})`,
      );
    }
    return createProvider(requestedId, providerOptions);
  }

  const localCandidates: Provider[] = [
    createLmStudioProvider(providerOptions),
    createOllamaProvider(providerOptions),
  ];

  for (const candidate of localCandidates) {
    if (await candidate.healthCheck(healthCheckTimeoutMs)) {
      return candidate;
    }
  }

  const hasDeepSeekKey = Boolean(
    providerOptions.apiKey ||
    envValue("SPECDRIFT_DEEPSEEK_API_KEY") ||
    envValue("DEEPSEEK_API_KEY"),
  );

  if (hasDeepSeekKey) {
    return createDeepSeekProvider(providerOptions);
  }

  throw new ProviderError(
    [
      "no AI provider available.",
      "Start LM Studio (http://localhost:1234) or Ollama (http://localhost:11434),",
      "or set DEEPSEEK_API_KEY. Use --provider to force one.",
    ].join(" "),
  );
}

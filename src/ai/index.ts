export {
  createProvider,
  isProviderId,
  LOCAL_PROVIDER_IDS,
  PROVIDER_IDS,
  resolveProvider,
} from "./detect.js";
export type { ResolveProviderOptions } from "./detect.js";
export { createDeepSeekProvider } from "./deepseek.js";
export { fetchJson, HttpError } from "./http.js";
export type { FetchJsonOptions } from "./http.js";
export { createLmStudioProvider } from "./lmstudio.js";
export { createOllamaProvider } from "./ollama.js";
export {
  buildMessages,
  buildUserPrompt,
  DEFAULT_MAX_CONTEXT_BYTES,
  DEFAULT_PROMPT,
  PROMPT_PRESETS,
  PROMPT_PRESET_NAMES,
  resolveSystemPrompt,
  selectRelevantFiles,
  SYSTEM_PROMPT_DECISION_TREE,
  SYSTEM_PROMPT_MINIMAL,
  SYSTEM_PROMPT_PERMISSIVE,
  SYSTEM_PROMPT_RTF,
} from "./prompt.js";
export type { PromptOptions, PromptPresetName } from "./prompt.js";
export {
  envValue,
  extractOpenAiContent,
  ProviderError,
  stripTrailingSlash,
  toProviderError,
} from "./provider.js";
export type {
  ChatMessage,
  ChatOptions,
  ChatRole,
  Provider,
  ProviderId,
  ProviderOptions,
} from "./provider.js";

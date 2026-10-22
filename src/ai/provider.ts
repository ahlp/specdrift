import { HttpError } from "./http.js";

export type ProviderId = "lmstudio" | "ollama" | "deepseek";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface Provider {
  readonly id: ProviderId;
  /** Local providers keep repository content on-machine. */
  readonly isLocal: boolean;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  healthCheck(timeoutMs?: number): Promise<boolean>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider?: ProviderId,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Read an environment variable, treating empty/whitespace values as unset. */
export function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export function toProviderError(
  error: unknown,
  provider: ProviderId,
): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof HttpError) {
    const body = error.body ? `: ${error.body}` : "";
    return new ProviderError(
      `${provider} request failed (HTTP ${error.status})${body}`,
      provider,
      error.status || undefined,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(`${provider} request failed: ${message}`, provider);
}

/** Extract `choices[0].message.content` from an OpenAI-compatible response. */
export function extractOpenAiContent(
  data: unknown,
  provider: ProviderId,
): string {
  const choices = (
    data as { choices?: Array<{ message?: { content?: unknown } }> } | null
  )?.choices;
  const content = choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim() === "") {
    throw new ProviderError(
      `${provider} returned an empty chat completion`,
      provider,
    );
  }

  return content;
}

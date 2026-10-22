import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProvider } from "../../src/ai/detect.js";
import { createDeepSeekProvider } from "../../src/ai/deepseek.js";
import { createLmStudioProvider } from "../../src/ai/lmstudio.js";
import { createOllamaProvider } from "../../src/ai/ollama.js";
import { ProviderError } from "../../src/ai/provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  return typeof body === "string"
    ? (JSON.parse(body) as Record<string, unknown>)
    : {};
}

function requestHeaders(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("LM Studio provider", () => {
  it("calls the OpenAI-compatible endpoint with an explicit model", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLmStudioProvider({ model: "local-model" });
    const result = await provider.chat([{ role: "user", content: "hi" }]);

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    expect(init.method).toBe("POST");

    const body = requestBody(init);
    expect(body.model).toBe("local-model");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.stream).toBe(false);
  });

  it("discovers a model from /models when none is provided", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return jsonResponse({ data: [{ id: "auto-model" }] });
      }
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLmStudioProvider();
    await provider.chat([{ role: "user", content: "hi" }]);

    const chatCall = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(requestBody(chatCall[1]).model).toBe("auto-model");
  });

  it("surfaces HTTP failures as ProviderError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("server exploded", {
            status: 500,
            statusText: "Internal Server Error",
          }),
      ),
    );

    const provider = createLmStudioProvider({ model: "m" });
    await expect(
      provider.chat([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ name: "ProviderError", status: 500 });
  });

  it("reports unhealthy when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const provider = createLmStudioProvider({ model: "m" });
    await expect(provider.healthCheck(10)).resolves.toBe(false);
  });
});

describe("Ollama provider", () => {
  it("uses the native /api/chat endpoint by default", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ message: { content: "hello ollama" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOllamaProvider({
      model: "llama3.1",
      maxTokens: 256,
    });
    const result = await provider.chat([{ role: "user", content: "hi" }], {
      temperature: 0.1,
    });

    expect(result).toBe("hello ollama");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://localhost:11434/api/chat");

    const body = requestBody(init);
    expect(body.model).toBe("llama3.1");
    expect(body.stream).toBe(false);
    expect(body.options).toEqual({ temperature: 0.1, num_predict: 256 });
  });

  it("discovers a model from /api/tags", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "qwen2.5" }] });
      }
      return jsonResponse({ message: { content: "ok" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOllamaProvider();
    await provider.chat([{ role: "user", content: "hi" }]);

    const chatCall = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(requestBody(chatCall[1]).model).toBe("qwen2.5");
  });

  it("switches to the OpenAI-compatible endpoint for /v1 base URLs", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "openai mode" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOllamaProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.1",
    });
    const result = await provider.chat([{ role: "user", content: "hi" }]);

    expect(result).toBe("openai mode");
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
  });
});

describe("DeepSeek provider", () => {
  it("requires an API key", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("SDD_DEEPSEEK_API_KEY", "");

    expect(() => createDeepSeekProvider()).toThrow(ProviderError);
  });

  it("sends the API key and default model", async () => {
    vi.stubEnv("SDD_DEEPSEEK_MODEL", "");
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "deepseek" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createDeepSeekProvider({ apiKey: "secret" });
    const result = await provider.chat([{ role: "user", content: "hi" }]);

    expect(result).toBe("deepseek");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(requestHeaders(init).authorization).toBe("Bearer secret");
    expect(requestBody(init).model).toBe("deepseek-chat");
  });
});

describe("resolveProvider", () => {
  it("returns an explicitly requested provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ choices: [{ message: { content: "x" } }] }),
      ),
    );

    const provider = await resolveProvider({
      provider: "deepseek",
      apiKey: "k",
    });
    expect(provider.id).toBe("deepseek");
    expect(provider.isLocal).toBe(false);
  });

  it("rejects an unknown provider name", async () => {
    await expect(resolveProvider({ provider: "nope" })).rejects.toThrow(
      /unknown provider/,
    );
  });

  it("auto-detects LM Studio first", async () => {
    vi.stubEnv("SDD_PROVIDER", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.startsWith("http://localhost:1234")) {
          return jsonResponse({ data: [] });
        }
        throw new Error("unreachable");
      }),
    );

    const provider = await resolveProvider();
    expect(provider.id).toBe("lmstudio");
    expect(provider.isLocal).toBe(true);
  });

  it("falls back to Ollama when LM Studio is down", async () => {
    vi.stubEnv("SDD_PROVIDER", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.startsWith("http://localhost:1234")) {
          throw new Error("refused");
        }
        if (url.startsWith("http://localhost:11434")) {
          return jsonResponse({ models: [] });
        }
        throw new Error("unreachable");
      }),
    );

    const provider = await resolveProvider();
    expect(provider.id).toBe("ollama");
  });

  it("explains how to configure a provider when none is available", async () => {
    vi.stubEnv("SDD_PROVIDER", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("SDD_DEEPSEEK_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("refused");
      }),
    );

    await expect(resolveProvider()).rejects.toThrow(/no AI provider available/);
  });
});

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function describeErrorCause(cause: unknown): string {
  if (!cause) return "";

  if (cause instanceof AggregateError) {
    return cause.errors
      .map((entry) => describeErrorCause(entry))
      .filter(Boolean)
      .join(", ");
  }

  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return code ? `${code}: ${cause.message}` : cause.message;
  }

  return String(cause);
}

/**
 * Perform an HTTP request and parse the response as JSON.
 *
 * Throws `HttpError` for transport failures, timeouts, non-2xx responses and
 * invalid JSON. A `status` of `0` indicates a transport-level failure.
 */
export async function fetchJson(
  url: string,
  options: FetchJsonOptions = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60_000;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = (): void => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...(options.headers ?? {}),
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new HttpError(
        `HTTP ${response.status} ${response.statusText}`.trim(),
        response.status,
        text.slice(0, 1_000),
      );
    }

    if (!text) return null;

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HttpError(
        "response is not valid JSON",
        response.status,
        text.slice(0, 1_000),
      );
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (timedOut) {
      throw new HttpError(`request timed out after ${timeoutMs}ms`, 0, "");
    }
    const message = error instanceof Error ? error.message : String(error);
    const cause = describeErrorCause(
      (error as { cause?: unknown } | null)?.cause,
    );
    throw new HttpError(
      `request failed: ${message}${cause ? ` (${cause})` : ""}`,
      0,
      "",
    );
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener("abort", onAbort);
    }
  }
}

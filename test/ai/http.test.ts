import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from '../../src/ai/http.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchJson', () => {
  it('surfaces the underlying transport cause', async () => {
    const cause = Object.assign(
      new Error('connect ECONNREFUSED 127.0.0.1:9'),
      { code: 'ECONNREFUSED' },
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('fetch failed'), { cause });
      }),
    );

    await expect(
      fetchJson('http://127.0.0.1:9/v1/models', { timeoutMs: 1000 }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it('reports timeouts distinctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      ),
    );

    await expect(
      fetchJson('http://localhost:1/v1/models', { timeoutMs: 10 }),
    ).rejects.toThrow(/timed out after 10ms/);
  });

  it('includes status and body for HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('nope', {
            status: 500,
            statusText: 'Internal Server Error',
          }),
      ),
    );

    await expect(fetchJson('http://localhost:1/v1/models')).rejects.toMatchObject(
      {
        name: 'HttpError',
        status: 500,
        body: 'nope',
      },
    );
  });

  it('rejects responses that are not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    );

    await expect(fetchJson('http://localhost:1/v1/models')).rejects.toThrow(
      /not valid JSON/,
    );
  });
});

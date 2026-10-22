import { open, stat } from 'node:fs/promises';

export interface ReadTextResult {
  content: string;
  bytes: number;
  truncated: boolean;
}

/**
 * Read at most `maxBytes` from a file and decode it as UTF-8.
 *
 * Reading is capped so a single large file cannot blow the model context.
 */
export async function readTextFile(
  filePath: string,
  maxBytes: number,
): Promise<ReadTextResult> {
  const size = (await stat(filePath)).size;
  const limit = Math.max(0, Math.floor(maxBytes));

  if (size === 0) {
    return { content: '', bytes: 0, truncated: false };
  }

  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, limit));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    let content = buffer.subarray(0, bytesRead).toString('utf8');
    const truncated = size > bytesRead;
    if (truncated) {
      // Drop a replacement char left by cutting a multibyte sequence.
      content = content.replace(/\uFFFD$/, '');
    }
    return { content, bytes: size, truncated };
  } finally {
    await handle.close();
  }
}

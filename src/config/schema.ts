import { z } from 'zod';

export const PROVIDER_VALUES = ['lmstudio', 'ollama', 'deepseek'] as const;
export const FORMAT_VALUES = ['markdown', 'json', 'text'] as const;
export const FAIL_ON_VALUES = ['error', 'warning', 'non-compliant'] as const;

/** Shape of an `.sddrc` file. Unknown keys are rejected to catch typos. */
export const configSchema = z
  .object({
    provider: z.enum(PROVIDER_VALUES).optional(),
    model: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    specsDir: z.string().min(1).optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    format: z.enum(FORMAT_VALUES).optional(),
    failOn: z.enum(FAIL_ON_VALUES).optional(),
    concurrency: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxFileBytes: z.number().int().positive().optional(),
    maxTotalBytes: z.number().int().positive().optional(),
    maxContextBytes: z.number().int().positive().optional(),
    includeTests: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export type SddConfig = z.infer<typeof configSchema>;

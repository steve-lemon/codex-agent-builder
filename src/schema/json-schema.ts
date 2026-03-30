// Shared helpers for turning zod schemas into transport-safe JSON Schema documents.
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Serializes a zod schema into a JSON-compatible schema object with a stable root name. */
export function serializeZodSchema(name: string, schema: z.ZodTypeAny): Record<string, unknown> {
    const serializeSchema = zodToJsonSchema as unknown as (
        inputSchema: unknown,
        options: unknown,
    ) => Record<string, unknown> & {
        definitions?: Record<string, Record<string, unknown>>;
    };
    const document = serializeSchema(schema, {
        name,
        $refStrategy: 'none',
    });

    return (document.definitions?.[name] as Record<string, unknown> | undefined) ?? document;
}

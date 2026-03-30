// Serializable schema wrappers for structured LLM IO and proxy transport.
import { z } from 'zod';
import { AgentError } from '../errors/agent-error';
import { serializeZodSchema } from '../schema/json-schema';

/** JSON-compatible schema payload that can cross process or network boundaries. */
export interface SerializedStructuredSchema {
    name: string;
    jsonSchema: Record<string, unknown>;
}

/** Runtime wrapper around a zod schema with transport-safe serialization helpers. */
export interface StructuredSchema<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string;
    schema: TSchema;
    serialize(): SerializedStructuredSchema;
    parse(input: unknown): z.output<TSchema>;
}

const structuredSchemaRegistry = new Map<string, z.ZodTypeAny>();

/** Registers a schema for later deserialization and exposes transport helpers. */
export function defineStructuredSchema<TSchema extends z.ZodTypeAny>(
    name: string,
    schema: TSchema,
): StructuredSchema<TSchema> {
    structuredSchemaRegistry.set(name, schema);

    return {
        name,
        schema,
        serialize() {
            return {
                name,
                jsonSchema: serializeZodSchema(name, schema),
            };
        },
        parse(input) {
            return schema.parse(input) as z.output<TSchema>;
        },
    };
}

/** Restores a structured schema wrapper from serialized transport data by schema name. */
export function deserializeStructuredSchema(serialized: SerializedStructuredSchema): StructuredSchema {
    const schema = structuredSchemaRegistry.get(serialized.name);
    if (!schema) {
        throw new AgentError(`Structured schema not found: ${serialized.name}`, {
            code: 'STRUCTURED_SCHEMA_NOT_FOUND',
            cause: serialized,
        });
    }

    return defineStructuredSchema(serialized.name, schema);
}

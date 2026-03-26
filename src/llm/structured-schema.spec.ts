// Vitest specs for structured schema transport helpers.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentError } from '../errors/agent-error';
import { defineStructuredSchema, deserializeStructuredSchema } from './structured-schema';

describe('structured schema transport', () => {
    it('serializes a simple object schema into a JSON-compatible payload', () => {
        const schema = defineStructuredSchema(
            'example_payload',
            z.object({
                id: z.string(),
                count: z.number(),
            }),
        );

        const serialized = schema.serialize();

        expect(serialized).toEqual(
            expect.objectContaining({
                name: 'example_payload',
                jsonSchema: expect.objectContaining({
                    type: 'object',
                }),
            }),
        );

        expect(serialized.jsonSchema).toEqual(
            expect.objectContaining({
                properties: expect.objectContaining({
                    id: expect.objectContaining({ type: 'string' }),
                    count: expect.objectContaining({ type: 'number' }),
                }),
                required: expect.arrayContaining(['id', 'count']),
            }),
        );
    });

    it('serializes nested arrays and enum values with stable JSON Schema shape', () => {
        const schema = defineStructuredSchema(
            'nested_payload',
            z.object({
                topic: z.string(),
                status: z.enum(['draft', 'published']),
                tags: z.array(z.string()),
                items: z.array(
                    z.object({
                        name: z.string(),
                        score: z.number(),
                    }),
                ),
            }),
        );

        const serialized = schema.serialize();

        expect(serialized.jsonSchema).toEqual(
            expect.objectContaining({
                properties: expect.objectContaining({
                    topic: expect.objectContaining({ type: 'string' }),
                    status: expect.objectContaining({ enum: ['draft', 'published'] }),
                    tags: expect.objectContaining({
                        type: 'array',
                        items: expect.objectContaining({ type: 'string' }),
                    }),
                    items: expect.objectContaining({
                        type: 'array',
                        items: expect.objectContaining({
                            type: 'object',
                            properties: expect.objectContaining({
                                name: expect.objectContaining({ type: 'string' }),
                                score: expect.objectContaining({ type: 'number' }),
                            }),
                        }),
                    }),
                }),
            }),
        );
    });

    it('serializes records and nullable fields for proxy-safe transport', () => {
        const schema = defineStructuredSchema(
            'record_payload',
            z.object({
                metadata: z.record(z.string(), z.string()),
                note: z.string().nullable(),
            }),
        );

        const serialized = schema.serialize();

        expect(serialized.jsonSchema).toEqual(
            expect.objectContaining({
                properties: expect.objectContaining({
                    metadata: expect.objectContaining({
                        type: 'object',
                        additionalProperties: expect.objectContaining({ type: 'string' }),
                    }),
                    note: expect.objectContaining({
                        type: expect.arrayContaining(['string', 'null']),
                    }),
                }),
            }),
        );
    });

    it('serializes defaulted and optional fields without losing required-field semantics', () => {
        const schema = defineStructuredSchema(
            'default_optional_payload',
            z.object({
                mode: z.enum(['sync', 'async']).default('sync'),
                summary: z.string().optional(),
                retryCount: z.number(),
            }),
        );

        const serialized = schema.serialize();

        expect(serialized.jsonSchema).toEqual(
            expect.objectContaining({
                properties: expect.objectContaining({
                    mode: expect.objectContaining({ default: 'sync' }),
                    summary: expect.objectContaining({ type: 'string' }),
                    retryCount: expect.objectContaining({ type: 'number' }),
                }),
                required: expect.arrayContaining(['retryCount']),
            }),
        );
    });

    it('deserializes a registered schema and parses payloads with the original validator', () => {
        const schema = defineStructuredSchema(
            'transport_roundtrip',
            z.object({
                ok: z.boolean(),
                values: z.array(z.string()),
            }),
        );

        const restored = deserializeStructuredSchema(schema.serialize());

        expect(restored.parse({ ok: true, values: ['a', 'b'] })).toEqual({
            ok: true,
            values: ['a', 'b'],
        });
        expect(() => restored.parse({ ok: 'nope', values: [] })).toThrow();
    });

    it('round-trips multiple schema examples through deserialize without losing parse behavior', () => {
        const examples = [
            defineStructuredSchema(
                'roundtrip_object',
                z.object({
                    id: z.string(),
                    enabled: z.boolean(),
                }),
            ),
            defineStructuredSchema(
                'roundtrip_array',
                z.object({
                    results: z.array(
                        z.object({
                            title: z.string(),
                            rank: z.number(),
                        }),
                    ),
                }),
            ),
            defineStructuredSchema(
                'roundtrip_nullable',
                z.object({
                    value: z.string().nullable(),
                }),
            ),
        ];

        const validPayloads = [
            { id: 'a1', enabled: true },
            { results: [{ title: 'first', rank: 1 }] },
            { value: null },
        ];

        for (const [index, example] of examples.entries()) {
            const restored = deserializeStructuredSchema(example.serialize());
            expect(restored.parse(validPayloads[index])).toEqual(validPayloads[index]);
        }
    });

    it('throws AgentError when deserializing an unknown schema name', () => {
        expect(() =>
            deserializeStructuredSchema({
                name: 'missing_schema',
                jsonSchema: {},
            }),
        ).toThrowError(AgentError);
    });
});

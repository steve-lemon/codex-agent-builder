// Vitest specs for structured response parser strategies.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentError } from '../errors/agent-error';
import { defineStructuredSchema } from './structured-schema';
import {
    LocalOpenAiStructuredResponseParser,
    ProxyStructuredResponseParser,
} from './structured-response-parser';

describe('structured response parsers', () => {
    it('local parser uses the SDK loader and helper loader to produce structured output', async () => {
        const loadSdk = vi.fn(async () =>
            class FakeOpenAI {
                responses = {
                    parse: vi.fn(async () => ({
                        output_parsed: {
                            isComplete: true,
                            reason: 'local-ok',
                        },
                    })),
                };
            },
        );
        const loadZodHelpers = vi.fn(async () => ({
            zodTextFormat: vi.fn(() => ({ type: 'json_schema' })),
            zodResponseFormat: vi.fn(),
        }));
        const parser = new LocalOpenAiStructuredResponseParser({
            apiKey: 'test-key',
            loadSdk,
            loadZodHelpers,
        });

        const output = await parser.parse({
            model: 'gpt-4.1-mini',
            input: [{ role: 'user', content: 'hello' }],
            schema: defineStructuredSchema(
                'reflector_output',
                z.object({
                    isComplete: z.boolean(),
                    reason: z.string(),
                }),
            ),
        });

        expect(output).toEqual({
            isComplete: true,
            reason: 'local-ok',
        });
        expect(loadSdk).toHaveBeenCalledTimes(1);
        expect(loadZodHelpers).toHaveBeenCalledTimes(1);
    });

    it('local parser fails before SDK load when the api key is missing', async () => {
        const loadSdk = vi.fn(async () => {
            throw new Error('sdk should not load');
        });
        const parser = new LocalOpenAiStructuredResponseParser({
            apiKey: undefined,
            loadSdk,
            loadZodHelpers: async () => ({
                zodTextFormat: vi.fn(),
                zodResponseFormat: vi.fn(),
            }),
        });

        await expect(
            parser.parse({
                model: 'gpt-4.1-mini',
                input: [{ role: 'user', content: 'hello' }],
                schema: defineStructuredSchema('reflector_output', z.object({ ok: z.boolean() })),
            }),
        ).rejects.toThrowError(AgentError);
        expect(loadSdk).not.toHaveBeenCalled();
    });

    it('proxy parser posts serialized schema metadata and validates the proxy output', async () => {
        const fetchImpl: typeof fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body));

            expect(body.schema).toEqual(
                expect.objectContaining({
                    name: 'reflector_output',
                    jsonSchema: expect.objectContaining({
                        type: 'object',
                    }),
                }),
            );

            return new Response(
                JSON.stringify({
                    output: {
                        isComplete: false,
                        reason: 'proxy-wait',
                    },
                }),
                {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    },
                },
            );
        });
        const parser = new ProxyStructuredResponseParser({
            proxyUrl: 'https://proxy.example.test/structured',
            fetchImpl,
        });

        const output = await parser.parse({
            model: 'gpt-4.1-mini',
            input: [{ role: 'user', content: 'hello' }],
            schema: defineStructuredSchema(
                'reflector_output',
                z.object({
                    isComplete: z.boolean(),
                    reason: z.string(),
                }),
            ),
        });

        expect(output).toEqual({
            isComplete: false,
            reason: 'proxy-wait',
        });
    });

    it('proxy parser rejects invalid proxy payloads before returning output', async () => {
        const parser = new ProxyStructuredResponseParser({
            proxyUrl: 'https://proxy.example.test/structured',
            fetchImpl: async () =>
                new Response(
                    JSON.stringify({
                        broken: true,
                    }),
                    {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
        });

        await expect(
            parser.parse({
                model: 'gpt-4.1-mini',
                input: [{ role: 'user', content: 'hello' }],
                schema: defineStructuredSchema('reflector_output', z.object({ ok: z.boolean() })),
            }),
        ).rejects.toThrow();
    });
});

// Vitest specs for the Gemini gateway behavior.
import { describe, expect, it, vi } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { GeminiGateway } from './gemini-gateway';
import { defineStructuredSchema } from './structured-schema';
import { z } from 'zod';

describe('GeminiGateway', () => {
    it('requests structured JSON output using responseJsonSchema', async () => {
        const generateContent = vi.fn(async () => ({
            text: JSON.stringify({
                isComplete: true,
                reason: 'gemini-complete',
                missingItems: [],
            }),
        }));
        const loadSdk = vi.fn(
            async () =>
                class FakeGoogleGenAI {
                    models = {
                        generateContent,
                    };
                },
        );

        const gateway = new GeminiGateway({
            apiKey: 'test-key',
            model: 'gemini-2.0-flash',
            loadSdk,
        });

        const result = await gateway.reflect({
            userInput: 'done?',
            stepResults: [],
        });

        expect(generateContent).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gemini-2.0-flash',
                config: expect.objectContaining({
                    responseMimeType: 'application/json',
                    responseJsonSchema: expect.objectContaining({
                        type: 'object',
                    }),
                }),
            }),
        );
        expect(result).toEqual({
            isComplete: true,
            reason: 'gemini-complete',
            missingItems: [],
        });
    });

    it('raises AgentError when Gemini execution is requested without an API key', async () => {
        const gateway = new GeminiGateway({
            loadSdk: async () => {
                throw new Error('sdk should not load before api key validation');
            },
        });

        await expect(
            gateway.reflect({
                userInput: 'done?',
                stepResults: [],
            }),
        ).rejects.toThrowError(/Gemini structured response parsing failed for reflector_output/);
    });

    it('raises AgentError when Gemini returns invalid JSON for the schema', async () => {
        const loadSdk = vi.fn(
            async () =>
                class FakeGoogleGenAI {
                    models = {
                        generateContent: vi.fn(async () => ({
                            text: '{"isComplete":"nope","reason":"broken"}',
                        })),
                    };
                },
        );

        const gateway = new GeminiGateway({
            apiKey: 'test-key',
            loadSdk,
        });

        await expect(
            gateway.reflect({
                userInput: 'done?',
                stepResults: [],
            }),
        ).rejects.toThrowError(AgentError);
    });

    it('uses the lite model when structured generation is marked as lite purpose', async () => {
        const generateContent = vi.fn(async () => ({
            text: JSON.stringify({
                ok: true,
            }),
        }));
        const loadSdk = vi.fn(
            async () =>
                class FakeGoogleGenAI {
                    models = {
                        generateContent,
                    };
                },
        );
        const gateway = new GeminiGateway({
            apiKey: 'test-key',
            model: 'gemini-2.5-pro',
            liteModel: 'gemini-2.5-flash-lite',
            loadSdk,
        });

        const result = await gateway.generateStructured({
            purpose: 'lite',
            input: [
                { role: 'system', content: 'test' },
                { role: 'user', content: JSON.stringify({}) },
            ],
            schema: defineStructuredSchema(
                'gemini_lite_test',
                z.object({
                    ok: z.boolean(),
                }),
            ),
        });

        expect(generateContent).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gemini-2.5-flash-lite',
            }),
        );
        expect(result).toEqual({ ok: true });
    });
});

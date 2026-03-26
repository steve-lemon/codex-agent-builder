// Vitest specs for the OpenAI gateway proxy execution path.
import { describe, expect, it, vi } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { OpenAiGateway } from './openai-gateway';

describe('OpenAiGateway', () => {
    it('routes structured parsing through the HTTP proxy with serialized schema metadata', async () => {
        const fetchImpl: typeof fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body));

            expect(body).toEqual(
                expect.objectContaining({
                    model: 'gpt-4.1-mini',
                    schema: expect.objectContaining({
                        name: 'reflector_output',
                        jsonSchema: expect.objectContaining({
                            type: 'object',
                        }),
                    }),
                }),
            );

            return new Response(
                JSON.stringify({
                    output: {
                        isComplete: true,
                        reason: 'proxy-complete',
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

        const gateway = new OpenAiGateway({
            apiKey: 'test-key',
            model: 'gpt-4.1-mini',
            proxyUrl: 'https://proxy.example.test/structured',
            fetchImpl,
        });

        const result = await gateway.reflect({
            userInput: 'done?',
            stepResults: [],
        });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            isComplete: true,
            reason: 'proxy-complete',
            missingItems: [],
        });
    });

    it('supports proxy mode without a local API key or OpenAI SDK instance', async () => {
        const fetchImpl: typeof fetch = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        output: {
                            isComplete: true,
                            reason: 'proxy-only',
                        },
                    }),
                    {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        },
                    },
                ),
        );
        const loadSdk = vi.fn(async () => {
            throw new Error('sdk should not load in proxy mode');
        });

        const gateway = new OpenAiGateway({
            proxyUrl: 'https://proxy.example.test/structured',
            fetchImpl,
            loadSdk,
        });

        const result = await gateway.reflect({
            userInput: 'done?',
            stepResults: [],
        });

        expect(result.reason).toBe('proxy-only');
        expect(loadSdk).not.toHaveBeenCalled();
    });

    it('raises AgentError when the proxy returns an invalid structured payload', async () => {
        const gateway = new OpenAiGateway({
            proxyUrl: 'https://proxy.example.test/structured',
            fetchImpl: async () =>
                new Response(
                    JSON.stringify({
                        output: {
                            isComplete: 'not-a-boolean',
                            reason: 'broken',
                        },
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
            gateway.reflect({
                userInput: 'done?',
                stepResults: [],
            }),
        ).rejects.toThrowError(AgentError);
    });

    it('raises AgentError when local execution is requested without an API key', async () => {
        const gateway = new OpenAiGateway({
            loadSdk: async () => {
                throw new Error('sdk should not load before api key validation');
            },
        });

        await expect(
            gateway.reflect({
                userInput: 'done?',
                stepResults: [],
            }),
        ).rejects.toThrowError(/Structured response parsing failed for reflector_output/);
    });

    it('raises AgentError when the OpenAI SDK loader fails during local execution', async () => {
        const gateway = new OpenAiGateway({
            apiKey: 'test-key',
            loadSdk: async () => {
                throw new AgentError('openai package is required for local OpenAI execution');
            },
        });

        await expect(
            gateway.reflect({
                userInput: 'done?',
                stepResults: [],
            }),
        ).rejects.toThrowError(AgentError);
    });
});

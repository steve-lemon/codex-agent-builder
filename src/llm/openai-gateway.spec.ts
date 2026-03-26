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

    it('raises AgentError when the proxy returns an invalid structured payload', async () => {
        const gateway = new OpenAiGateway({
            apiKey: 'test-key',
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
});

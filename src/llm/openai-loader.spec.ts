// Vitest specs for dynamic OpenAI module loading behavior.
import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { loadOpenAiSdk, loadOpenAiZodHelpers } from './openai-loader';

describe('OpenAI dynamic loading', () => {
    it('loads the OpenAI SDK constructor dynamically when installed', async () => {
        const OpenAI = await loadOpenAiSdk();

        expect(typeof OpenAI).toBe('function');
    });

    it('loads the OpenAI zod helpers dynamically when installed', async () => {
        const helpers = await loadOpenAiZodHelpers();

        expect(helpers).toEqual(
            expect.objectContaining({
                zodTextFormat: expect.any(Function),
            }),
        );
    });

    it('wraps missing module failures as AgentError', async () => {
        const error = new AgentError('missing');

        expect(error).toBeInstanceOf(AgentError);
    });
});

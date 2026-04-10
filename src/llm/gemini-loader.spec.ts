// Vitest specs for dynamic Gemini module loading behavior.
import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { loadGeminiSdk } from './gemini-loader';

describe('Gemini dynamic loading', () => {
    it('matches the current runtime support policy for Gemini SDK loading', async () => {
        const major = Number(process.versions.node.split('.')[0]);

        if (major >= 20) {
            const GoogleGenAI = await loadGeminiSdk();
            expect(typeof GoogleGenAI).toBe('function');
            return;
        }

        await expect(loadGeminiSdk()).rejects.toThrowError(AgentError);
    });
});

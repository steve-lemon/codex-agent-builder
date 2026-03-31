// Vitest specs for dynamic Gemini module loading behavior.
import { describe, expect, it } from 'vitest';
import { loadGeminiSdk } from './gemini-loader';

describe('Gemini dynamic loading', () => {
    it('loads the Gemini SDK constructor dynamically on supported Node runtimes', async () => {
        const GoogleGenAI = await loadGeminiSdk();

        expect(typeof GoogleGenAI).toBe('function');
    });
});

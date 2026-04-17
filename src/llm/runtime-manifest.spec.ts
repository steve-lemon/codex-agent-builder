// Vitest specs for the aggregated runtime LLM manifest surface.
import { describe, expect, it } from 'vitest';
import { getLlmRuntimeManifest } from './runtime-manifest';

describe('llm runtime manifest', () => {
    it('loads structured prompts and fake copy together', async () => {
        const manifest = await getLlmRuntimeManifest();

        expect(manifest.structuredTaskPrompts).toEqual(
            expect.objectContaining({
                planSystemPrompt: expect.any(String),
                reflectSystemPrompt: expect.any(String),
                finalizeSystemPrompt: expect.any(String),
            }),
        );
        expect(manifest.fakeCopy).toEqual(
            expect.objectContaining({
                plan: expect.any(Object),
                final: expect.any(Object),
            }),
        );
    });
});

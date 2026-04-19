// Vitest specs for the aggregated flow-design manifest surface.
import { describe, expect, it } from 'vitest';
import { getFlowDesignManifest } from './manifest';

describe('flow-design manifest', () => {
    it('loads task types, task graph templates, classifier prompts, defaults, and knowledge together', async () => {
        const manifest = await getFlowDesignManifest();

        expect(manifest.taskTypes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'blog-title-generation' }),
                expect.objectContaining({ id: 'text-editing' }),
                expect.objectContaining({ id: 'text-summarization' }),
                expect.objectContaining({ id: 'keyword-analysis' }),
            ]),
        );
        expect(manifest.taskGraphTemplates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'email-reply' }),
                expect.objectContaining({ id: 'text-editing' }),
                expect.objectContaining({ id: 'text-summarization' }),
                expect.objectContaining({ id: 'keyword-analysis' }),
            ]),
        );
        expect(manifest.classifierPrompts).toEqual(
            expect.objectContaining({
                taskTypeSystemPrompt: expect.any(String),
                taskGraphSystemPrompt: expect.any(String),
            }),
        );
        expect(manifest.defaults).toEqual(
            expect.objectContaining({
                systemPrompts: expect.objectContaining({
                    'blog-title-generation': expect.any(String),
                }),
                aiNodeDefaults: expect.objectContaining({
                    model: expect.any(String),
                }),
            }),
        );
        expect(manifest.knowledge).toEqual(
            expect.objectContaining({
                sharedDraftNotes: expect.any(Array),
                reflectionNotes: expect.any(Array),
            }),
        );
    });
});

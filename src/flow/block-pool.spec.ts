import { describe, expect, it } from 'vitest';
import {
    BuiltinFlowBlockIds,
    getBuiltinFlowBlock,
    getFlowCapabilityCategoryMap,
    getFlowCapabilityDefinitions,
    getFlowBlockMatchingPolicy,
} from './block-pool';
import { matchFlowBlocksByCapabilities } from './block-matching';

describe('flow block pool', () => {
    it('loads capability categories from the resource-backed block pool', async () => {
        const capabilities = await getFlowCapabilityDefinitions();
        const categoryMap = await getFlowCapabilityCategoryMap();

        expect(capabilities.map(capability => capability.category)).toEqual(
            expect.arrayContaining(['input', 'process', 'view', 'ai']),
        );
        expect(categoryMap).toMatchObject({
            'text-input': 'input',
            'json-input': 'input',
            'image-input': 'input',
            'view-log': 'view',
            'ai-generation': 'ai',
        });
    });

    it('loads built-in blocks from the YAML block pool resource', async () => {
        const aiGenerateBlock = await getBuiltinFlowBlock(BuiltinFlowBlockIds.aiGenerate);
        const jsonInputBlock = await getBuiltinFlowBlock(BuiltinFlowBlockIds.jsonInput);
        const matchingPolicy = await getFlowBlockMatchingPolicy();

        expect(aiGenerateBlock).toEqual(
            expect.objectContaining({
                id: 'ai-generate',
                capabilities: expect.arrayContaining(['ai-generation', 'structured-output']),
            }),
        );
        expect(jsonInputBlock).toEqual(
            expect.objectContaining({
                id: 'json-input',
                capabilities: expect.arrayContaining(['json-input']),
            }),
        );
        expect(matchingPolicy).toEqual(
            expect.objectContaining({
                categoryPriority: ['input', 'ai', 'process', 'view'],
                blockPriority: expect.arrayContaining(['input', 'ai-generate']),
            }),
        );
    });

    it('matches blocks against required capabilities using the shared helper', async () => {
        const textInputMatch = await matchFlowBlocksByCapabilities(['text-input']);
        const structuredMatch = await matchFlowBlocksByCapabilities(['ai-generation', 'structured-output']);

        expect(textInputMatch.requiredCategories).toEqual(['input']);
        expect(textInputMatch.candidates[0]).toEqual(
            expect.objectContaining({
                allRequiredCapabilitiesMatched: true,
            }),
        );
        expect(textInputMatch.candidates.map(candidate => candidate.blockId)).toEqual(
            expect.arrayContaining(['input', 'text-input']),
        );
        expect(structuredMatch.requiredCategories).toEqual(['ai']);
        expect(structuredMatch.candidates[0]).toEqual(
            expect.objectContaining({
                blockId: 'ai-generate',
                allRequiredCapabilitiesMatched: true,
            }),
        );
    });
});

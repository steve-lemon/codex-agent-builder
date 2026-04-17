// Vitest specs for the aggregated node-config design manifest surface.
import { describe, expect, it } from 'vitest';
import { getNodeConfigDesignManifest } from './manifest';

describe('node-config design manifest', () => {
    it('loads defaults and knowledge together', async () => {
        const manifest = await getNodeConfigDesignManifest();

        expect(manifest.defaults).toEqual(
            expect.objectContaining({
                systemPrompts: expect.objectContaining({
                    'blog-title-generation': expect.any(String),
                }),
                aiModelProfiles: expect.objectContaining({
                    default: expect.any(String),
                }),
            }),
        );
        expect(manifest.knowledge).toEqual(
            expect.objectContaining({
                sharedNotes: expect.any(Array),
                strategyDirectives: expect.any(Array),
            }),
        );
    });
});

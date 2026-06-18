import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildToolPackFromResource, type ToolDefinitionSeed } from './resources';

describe('tool resource helpers', () => {
    it('builds a tool pack from resource metadata and code definitions', () => {
        const resource = {
            id: 'demo-pack',
            version: 1,
            name: 'Demo Pack',
            description: 'Demo tool pack',
            owner: 'demo-owner',
            scope: 'agent-owned' as const,
            skills: ['demo-skill'],
            tools: [
                {
                    name: 'demoTool',
                    description: 'Demo tool',
                    riskLevel: 'read-only' as const,
                    allowedSkills: ['demo-skill'],
                    requiresConfirmation: false,
                    parallelSafe: true,
                    executeId: 'demo.impl',
                },
            ],
        };
        const definitions: Record<string, ToolDefinitionSeed> = {
            demoTool: {
                name: 'demoTool',
                parameters: z.object({ value: z.string() }),
            },
        };

        const pack = buildToolPackFromResource(resource, definitions);

        expect(pack).toEqual(
            expect.objectContaining({
                id: 'demo-pack',
                version: 1,
                owner: 'demo-owner',
                scope: 'agent-owned',
                bundle: expect.objectContaining({
                    tools: [
                        expect.objectContaining({
                            name: 'demoTool',
                            executeId: 'demo.impl',
                            allowedSkills: ['demo-skill'],
                        }),
                    ],
                }),
            }),
        );
    });

    it('throws when a resource references a tool without a matching definition seed', () => {
        const resource = {
            id: 'broken-pack',
            version: 1,
            name: 'Broken Pack',
            description: 'Broken tool pack',
            owner: 'demo-owner',
            scope: 'agent-owned' as const,
            skills: ['demo-skill'],
            tools: [
                {
                    name: 'missingTool',
                    description: 'Missing tool',
                    riskLevel: 'read-only' as const,
                    allowedSkills: ['demo-skill'],
                    requiresConfirmation: false,
                    parallelSafe: true,
                    executeId: 'missing.impl',
                },
            ],
        };

        expect(() => buildToolPackFromResource(resource, {})).toThrow(
            'Tool definition not found for resource-backed tool: missingTool',
        );
    });
});

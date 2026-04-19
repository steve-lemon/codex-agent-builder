import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildPlanStructuredRequest } from './structured-tasks';
import type { PlannerInput } from './types';
import { buildToolManifest, defineTool } from '../tools';

describe('buildPlanStructuredRequest', () => {
    it('sends compact planner tool manifests instead of full JSON schema payloads', async () => {
        const tool = defineTool({
            name: 'designFlowNodeConfigurations',
            description: 'Design node configurations for a drafted flow',
            parameters: z.object({
                userRequest: z.string(),
                flow: z.object({
                    blocks: z.array(z.unknown()),
                    nodes: z.array(z.unknown()),
                    edges: z.array(z.unknown()),
                }),
                desiredCount: z.number(),
                wantsJson: z.boolean(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async () => ({ ok: true }),
        });

        const request = await buildPlanStructuredRequest({
            userInput: '노드 설정을 디자인해줘',
            skillName: 'flow-designer',
            skillInstructions: 'Use flow tools only.',
            strategyBrief: {
                mission: 'Design node configurations for the drafted flow.',
                operationModel: ['transform'],
                executionPosture: 'hybrid',
                outputFormat: 'unspecified',
                confidenceCeiling: 'uncertain',
                riskFlags: [],
                designPrinciples: ['Prefer minimal valid wiring.'],
                sampleSource: 'user-provided',
            },
            allowedTools: ['designFlowNodeConfigurations'],
            toolManifests: [buildToolManifest(tool)],
            toolDefinitions: [tool],
        } satisfies PlannerInput);

        const payload = JSON.parse(request.input[1]!.content);
        expect(payload.toolManifests).toEqual([
            expect.objectContaining({
                name: 'designFlowNodeConfigurations',
                parameterHints: expect.arrayContaining([
                    expect.objectContaining({ name: 'userRequest', type: 'string', required: true }),
                    expect.objectContaining({ name: 'flow', type: 'object', required: true }),
                    expect.objectContaining({ name: 'desiredCount', type: 'number', required: true }),
                    expect.objectContaining({ name: 'wantsJson', type: 'boolean', required: true }),
                ]),
            }),
        ]);
        expect(payload.toolManifests[0].parametersJsonSchema).toBeUndefined();
    });

    it('prefers plannerInstructions over full skillInstructions when provided', async () => {
        const request = await buildPlanStructuredRequest({
            userInput: '노드 설정을 디자인해줘',
            skillName: 'flow-designer',
            skillInstructions: 'VERY LONG FULL SKILL BODY',
            plannerInstructions: 'Use compact planner instructions.',
            strategyBrief: undefined,
            allowedTools: ['designFlowNodeConfigurations'],
            toolManifests: [],
            toolDefinitions: [],
        } satisfies PlannerInput);

        const payload = JSON.parse(request.input[1]!.content);
        expect(payload.skillInstructions).toBe('Use compact planner instructions.');
    });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnyArgsSchema } from './registry';
import { ToolRepository } from './repository';
import { defineTool, buildToolManifest, type ToolContext } from './types';

function makeToolContext(runId = 'core-test-run'): ToolContext {
    return {
        runId,
        now: 1234567890,
        runState: {
            async get() {
                throw new Error('runState.get() should not be called');
            },
        },
    };
}

describe('ToolRepository core', () => {
    it('registers tools and normalizes executeId defaults', () => {
        const repository = new ToolRepository();
        repository.register(
            defineTool({
                name: 'echo',
                description: 'Echo tool',
                parameters: z.object({ value: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['test-skill'],
                requiresConfirmation: false,
                parallelSafe: true,
            }),
        );

        expect(repository.get('echo')).toEqual(
            expect.objectContaining({
                name: 'echo',
                executeId: 'echo',
            }),
        );
    });

    it('executes tools through explicit executeId mappings', async () => {
        const repository = new ToolRepository();
        repository.register(
            defineTool({
                name: 'aliasEcho',
                description: 'Alias echo tool',
                parameters: z.object({ value: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['test-skill'],
                requiresConfirmation: false,
                parallelSafe: true,
                executeId: 'echo.impl',
            }),
        );
        repository.registerExecutor('echo.impl', async (args: Record<string, unknown>) => ({ echoed: args.value }));

        const result = await repository.execute(
            { toolName: 'aliasEcho', args: { value: 'hello' } },
            makeToolContext(),
        );

        expect(result).toEqual({
            toolName: 'aliasEcho',
            ok: true,
            data: { echoed: 'hello' },
        });
    });

    it('returns an execution error when executor mapping is missing', async () => {
        const repository = new ToolRepository();
        repository.register(
            defineTool({
                name: 'brokenTool',
                description: 'Missing executor tool',
                parameters: z.object({ value: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['test-skill'],
                requiresConfirmation: false,
                parallelSafe: true,
                executeId: 'missing.impl',
            }),
        );

        const result = await repository.execute(
            { toolName: 'brokenTool', args: { value: 'hello' } },
            makeToolContext(),
        );

        expect(result).toEqual({
            toolName: 'brokenTool',
            ok: false,
            error: 'Executor not found: missing.impl',
        });
    });

    it('parses args with the registered zod schema before execution', async () => {
        const repository = new ToolRepository();
        repository.register(
            defineTool({
                name: 'strictTool',
                description: 'Strict args tool',
                parameters: z.object({ count: z.number().int() }),
                riskLevel: 'read-only',
                allowedSkills: ['test-skill'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async args => args,
            }),
        );

        const result = await repository.execute(
            { toolName: 'strictTool', args: { count: 'nope' } as Record<string, unknown> },
            makeToolContext(),
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('Invalid args for strictTool');
    });

    it('builds planner manifests from tool definitions', () => {
        const tool = defineTool({
            name: 'manifestTool',
            description: 'Manifest tool',
            parameters: z.object({ payload: AnyArgsSchema }),
            riskLevel: 'approval-required',
            allowedSkills: ['test-skill'],
            requiresConfirmation: true,
            parallelSafe: false,
        });

        expect(buildToolManifest(tool)).toEqual(
            expect.objectContaining({
                name: 'manifestTool',
                description: 'Manifest tool',
                riskLevel: 'approval-required',
                requiresConfirmation: true,
                parallelSafe: false,
                parametersJsonSchema: expect.any(Object),
            }),
        );
    });
});

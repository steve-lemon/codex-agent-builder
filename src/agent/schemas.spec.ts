// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import {
    parsePlanResponse,
    PlanResponseSchema,
    PlanStepSchema,
    ReflectorOutputSchema,
    StepModeSchema,
    ToolCallSchema,
} from './schemas';
import { loadOpenAiZodHelpers } from '../llm/openai-loader';

describe('agent schemas', () => {
    it('builds an OpenAI response_format for PlanResponseSchema with a stable schema name', async () => {
        const { zodResponseFormat } = await loadOpenAiZodHelpers();
        const responseFormat = zodResponseFormat(PlanResponseSchema as never, 'Plan');

        expect(responseFormat).toEqual(
            expect.objectContaining({
                type: 'json_schema',
                json_schema: expect.objectContaining({
                    name: 'Plan',
                    strict: true,
                }),
            }),
        );
        expect(responseFormat.json_schema.schema).toEqual(
            expect.objectContaining({
                type: 'object',
                required: expect.arrayContaining(['steps']),
            }),
        );
    });

    it('builds an OpenAI response_format for ReflectorOutputSchema', async () => {
        const { zodResponseFormat } = await loadOpenAiZodHelpers();
        const responseFormat = zodResponseFormat(ReflectorOutputSchema as never, 'ReflectorOutput');

        expect(responseFormat.json_schema.name).toBe('ReflectorOutput');
        expect(responseFormat.json_schema.schema).toEqual(
            expect.objectContaining({
                type: 'object',
                required: expect.arrayContaining(['isComplete', 'reason', 'missingItems']),
            }),
        );
    });

    it('parses a valid mock planner response into executable steps', () => {
        const parsed = parsePlanResponse({
            steps: [
                {
                    id: 's1',
                    mode: 'parallel-tools',
                    description: 'Load context',
                    toolCalls: [
                        { toolName: 'getCustomerById', args: { customerId: 'c_1' } },
                        { toolName: 'getOrdersByCustomer', args: { customerId: 'c_1' } },
                    ],
                    reasoning: null,
                },
                {
                    id: 's2',
                    mode: 'reasoning',
                    description: 'Evaluate the request',
                    reasoning: 'Use policy and order history.',
                    toolCalls: null,
                },
                {
                    id: 's3',
                    mode: 'finalize',
                    description: 'Finalize the answer',
                    toolCalls: null,
                    reasoning: null,
                },
            ],
        });

        expect(parsed.steps).toHaveLength(3);
        expect(parsed.steps[0]?.toolCalls?.[0]).toEqual({
            toolName: 'getCustomerById',
            args: { customerId: 'c_1' },
        });
        expect(parsed.steps[1]?.reasoning).toBe('Use policy and order history.');
        expect(parsed.steps[2]?.mode).toBe('finalize');
    });

    it('rejects invalid planner responses from mock or gateway outputs', () => {
        expect(() =>
            parsePlanResponse({
                steps: [
                    {
                        id: '',
                        mode: 'single-tool',
                        description: 'broken step',
                        toolCalls: null,
                        reasoning: null,
                    },
                ],
            }),
        ).toThrow();

        expect(() =>
            parsePlanResponse({
                steps: [
                    {
                        id: 's1',
                        mode: 'unsupported-mode',
                        description: 'broken step',
                        toolCalls: null,
                        reasoning: null,
                    },
                ],
            }),
        ).toThrow();
    });

    it('applies schema defaults when parsing tool calls and reflector outputs', () => {
        const toolCall = ToolCallSchema.parse({ toolName: 'getRefundPolicy' });
        const reflector = ReflectorOutputSchema.parse({
            isComplete: true,
            reason: 'done',
        });

        expect(toolCall.args).toEqual({});
        expect(reflector.missingItems).toEqual([]);
    });

    it('validates supported step modes and plan step structure independently', () => {
        expect(StepModeSchema.parse('single-tool')).toBe('single-tool');
        expect(() => StepModeSchema.parse('bad-mode')).toThrow();

        expect(
            PlanStepSchema.parse({
                id: 's1',
                mode: 'single-tool',
                description: 'Call one tool',
                toolCalls: [{ toolName: 'webSearch', args: { query: 'hello' } }],
            }),
        ).toEqual(
            expect.objectContaining({
                id: 's1',
                mode: 'single-tool',
            }),
        );
    });
});

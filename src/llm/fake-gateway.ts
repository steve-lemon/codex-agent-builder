// LLM gateway interfaces and implementations.
import type { LlmGateway, PlannerInput, ReflectorInput, FinalizerInput } from './types';
import type { Plan } from '../agent/schemas';
import type { FinalResult } from '../agent/types';

/** Deterministic gateway that returns stable plans and summaries for tests and demos. */
export class FakeLlmGateway implements LlmGateway {
    async plan(input: PlannerInput): Promise<Plan> {
        const text = input.userInput.toLowerCase();
        const availableToolNames = new Set(input.toolManifests.map(tool => tool.name));

        const ensureToolAvailable = (toolName: string) => {
            if (!availableToolNames.has(toolName)) {
                throw new Error(`Fake planner attempted unavailable tool: ${toolName}`);
            }
            return toolName;
        };

        if (input.skillName === 'research-brief-generator') {
            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Collect research facts',
                        toolCalls: [{ toolName: ensureToolAvailable('webSearch'), args: { query: input.userInput } }],
                    },
                    {
                        id: 's2',
                        mode: 'reasoning',
                        description: 'Synthesize findings',
                        reasoning: 'Summarize key themes and caveats.',
                    },
                    {
                        id: 's3',
                        mode: 'finalize',
                        description: 'Finalize response',
                    },
                ],
            };
        }

        if (input.skillName === 'ops-automation-agent') {
            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'parallel-tools',
                        description: 'Read policy and context in parallel',
                        toolCalls: [
                            { toolName: ensureToolAvailable('getRefundPolicy'), args: {} },
                            { toolName: ensureToolAvailable('webSearch'), args: { query: 'ops status' } },
                        ],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'Notify channel',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('sendSlackMessage'),
                                args: { channel: '#ops', message: 'Daily automation summary ready.' },
                            },
                        ],
                    },
                    { id: 's3', mode: 'finalize', description: 'Finalize response' },
                ],
            };
        }

        const requiresApproval = text.includes('refund') || text.includes('ticket') || text.includes('escalate');

        const steps: Plan['steps'] = [
            {
                id: 's1',
                mode: 'parallel-tools',
                description: 'Load customer context in parallel',
                toolCalls: [
                    { toolName: ensureToolAvailable('getCustomerById'), args: { customerId: 'c_1' } },
                    { toolName: ensureToolAvailable('getOrdersByCustomer'), args: { customerId: 'c_1' } },
                    { toolName: ensureToolAvailable('getRefundPolicy'), args: {} },
                ],
            },
            {
                id: 's2',
                mode: 'reasoning',
                description: 'Evaluate support action',
                reasoning: 'Use policy and order history to decide whether escalation/refund is needed.',
            },
        ];

        if (requiresApproval) {
            steps.push({
                id: 's3',
                mode: 'single-tool',
                description: 'Execute approval-required action',
                toolCalls: [
                    text.includes('refund')
                        ? { toolName: ensureToolAvailable('refundOrder'), args: { orderId: 'o_100', amount: 25 } }
                        : {
                              toolName: ensureToolAvailable('createTicket'),
                              args: { customerId: 'c_1', reason: 'Escalation requested by agent' },
                          },
                ],
            });
        }

        steps.push({ id: 's4', mode: 'finalize', description: 'Finalize response' });

        return { steps };
    }

    async reflect(input: ReflectorInput) {
        const hasFailure = JSON.stringify(input.stepResults).includes('"ok":false');
        return {
            isComplete: true,
            reason: hasFailure ? 'Completed with tool errors' : 'All planned steps executed',
            missingItems: [],
        };
    }

    async finalize(input: FinalizerInput): Promise<FinalResult> {
        return {
            summary: `Handled with skill ${input.skillName}. Processed ${input.stepResults.length} step results.`,
            success: true,
            nextActions: ['Review trace logs if needed'],
        };
    }
}

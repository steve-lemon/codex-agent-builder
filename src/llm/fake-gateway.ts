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

        if (input.skillName === 'flow-designer') {
            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Analyze request intent for flow design',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('analyzeFlowRequest'),
                                args: { userRequest: input.userInput },
                            },
                        ],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'List available flow blocks',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('listAvailableFlowBlocks'),
                                args: {},
                            },
                        ],
                    },
                    {
                        id: 's3',
                        mode: 'single-tool',
                        description: 'Probe the AI block behavior before using it',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('probeFlowBlock'),
                                args: {
                                    blockId: 'ai-generate',
                                    sampleConfig: {
                                        model: 'mock-flow-model',
                                        jsonOutput: String(input.userInput.toLowerCase().includes('json')),
                                    },
                                    sampleInputs: {
                                        system: 'You generate clear and catchy blog titles based on one keyword.',
                                        prompt: 'User request: sample. Sample input: 샘플 입력. Return one result. Return plain text.',
                                    },
                                },
                            },
                        ],
                    },
                    {
                        id: 's4',
                        mode: 'single-tool',
                        description: 'Design a flow draft',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('designFlowDraft'),
                                args: {
                                    userRequest: input.userInput,
                                    sampleInput:
                                        input.userInput.toLowerCase().includes('키워드') ||
                                        input.userInput.toLowerCase().includes('keyword')
                                            ? '생산성 향상'
                                            : '샘플 입력',
                                    desiredCount:
                                        input.userInput.toLowerCase().includes('여러') ||
                                        input.userInput.toLowerCase().includes('multiple') ||
                                        input.userInput.toLowerCase().includes('many')
                                            ? 5
                                            : 1,
                                    wantsJson: input.userInput.toLowerCase().includes('json'),
                                },
                            },
                        ],
                    },
                    {
                        id: 's5',
                        mode: 'single-tool',
                        description: 'Validate the flow draft',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('validateFlowDraft'),
                                args: {
                                    flow: {
                                        blocks: input.toolDefinitions.length >= 0 ? [] : [],
                                        nodes: [
                                            {
                                                id: 'system-input',
                                                blockId: 'input',
                                                label: 'System Input',
                                                config: {
                                                    input: 'You generate clear and catchy blog titles based on one keyword.',
                                                },
                                                inputPorts: [],
                                                outputPorts: [
                                                    {
                                                        id: 'system-input:output',
                                                        localId: 'output',
                                                        direction: 'output',
                                                        dataType: 'text',
                                                        label: 'Output',
                                                    },
                                                ],
                                            },
                                            {
                                                id: 'prompt-input',
                                                blockId: 'input',
                                                label: 'Prompt Input',
                                                config: {
                                                    input: `User request: ${input.userInput}. Sample input: ${
                                                        input.userInput.toLowerCase().includes('키워드') ||
                                                        input.userInput.toLowerCase().includes('keyword')
                                                            ? '생산성 향상'
                                                            : '샘플 입력'
                                                    }. ${
                                                        input.userInput.toLowerCase().includes('여러') ||
                                                        input.userInput.toLowerCase().includes('multiple') ||
                                                        input.userInput.toLowerCase().includes('many')
                                                            ? 'Return exactly 5 results.'
                                                            : 'Return one result.'
                                                    } ${
                                                        input.userInput.toLowerCase().includes('json')
                                                            ? 'Return JSON only.'
                                                            : 'Return each result on its own line.'
                                                    }`,
                                                },
                                                inputPorts: [],
                                                outputPorts: [
                                                    {
                                                        id: 'prompt-input:output',
                                                        localId: 'output',
                                                        direction: 'output',
                                                        dataType: 'text',
                                                        label: 'Output',
                                                    },
                                                ],
                                            },
                                            {
                                                id: 'ai-node',
                                                blockId: 'ai-generate',
                                                label: 'AI Generate',
                                                config: {
                                                    model: 'mock-flow-model',
                                                    jsonOutput: String(input.userInput.toLowerCase().includes('json')),
                                                },
                                                inputPorts: [
                                                    {
                                                        id: 'ai-node:system',
                                                        localId: 'system',
                                                        direction: 'input',
                                                        dataType: 'text',
                                                        label: 'System',
                                                    },
                                                    {
                                                        id: 'ai-node:prompt',
                                                        localId: 'prompt',
                                                        direction: 'input',
                                                        dataType: 'text',
                                                        label: 'Prompt',
                                                    },
                                                ],
                                                outputPorts: [
                                                    {
                                                        id: 'ai-node:output',
                                                        localId: 'output',
                                                        direction: 'output',
                                                        dataType: 'any',
                                                        label: 'Output',
                                                    },
                                                ],
                                            },
                                            {
                                                id: 'view-output',
                                                blockId: 'view',
                                                label: 'View Output',
                                                inputPorts: [
                                                    {
                                                        id: 'view-output:input',
                                                        localId: 'input',
                                                        direction: 'input',
                                                        dataType: 'any',
                                                        label: 'Input',
                                                    },
                                                ],
                                                outputPorts: [],
                                            },
                                        ],
                                        edges: [
                                            {
                                                id: 'system-input:output->ai-node:system',
                                                sourceNodeId: 'system-input',
                                                sourcePortId: 'system-input:output',
                                                targetNodeId: 'ai-node',
                                                targetPortId: 'ai-node:system',
                                            },
                                            {
                                                id: 'prompt-input:output->ai-node:prompt',
                                                sourceNodeId: 'prompt-input',
                                                sourcePortId: 'prompt-input:output',
                                                targetNodeId: 'ai-node',
                                                targetPortId: 'ai-node:prompt',
                                            },
                                            {
                                                id: 'ai-node:output->view-output:input',
                                                sourceNodeId: 'ai-node',
                                                sourcePortId: 'ai-node:output',
                                                targetNodeId: 'view-output',
                                                targetPortId: 'view-output:input',
                                            },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                    {
                        id: 's6',
                        mode: 'single-tool',
                        description: 'Run the flow sample',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('runFlowSample'),
                                args: {
                                    userRequest: input.userInput,
                                    flow: {
                                        blocks: [],
                                        nodes: [
                                            {
                                                id: 'system-input',
                                                blockId: 'input',
                                                label: 'System Input',
                                                config: {
                                                    input: 'You generate clear and catchy blog titles based on one keyword.',
                                                },
                                                inputPorts: [],
                                                outputPorts: [
                                                    {
                                                        id: 'system-input:output',
                                                        localId: 'output',
                                                        direction: 'output',
                                                        dataType: 'text',
                                                        label: 'Output',
                                                    },
                                                ],
                                            },
                                            {
                                                id: 'prompt-input',
                                                blockId: 'input',
                                                label: 'Prompt Input',
                                                config: {
                                                    input: `User request: ${input.userInput}. Sample input: ${
                                                        input.userInput.toLowerCase().includes('키워드') ||
                                                        input.userInput.toLowerCase().includes('keyword')
                                                            ? '생산성 향상'
                                                            : '샘플 입력'
                                                    }. ${
                                                        input.userInput.toLowerCase().includes('여러') ||
                                                        input.userInput.toLowerCase().includes('multiple') ||
                                                        input.userInput.toLowerCase().includes('many')
                                                            ? 'Return exactly 5 results.'
                                                            : 'Return one result.'
                                                    } ${
                                                        input.userInput.toLowerCase().includes('json')
                                                            ? 'Return JSON only.'
                                                            : 'Return each result on its own line.'
                                                    }`,
                                                },
                                                inputPorts: [],
                                                outputPorts: [
                                                    {
                                                        id: 'prompt-input:output',
                                                        localId: 'output',
                                                        direction: 'output',
                                                        dataType: 'text',
                                                        label: 'Output',
                                                    },
                                                ],
                                            },
                                            {
                                                id: 'ai-node',
                                                blockId: 'ai-generate',
                                                label: 'AI Generate',
                                                config: {
                                                    model: 'mock-flow-model',
                                                    jsonOutput: String(input.userInput.toLowerCase().includes('json')),
                                                },
                                                inputPorts: [
                                                    {
                                                        id: 'ai-node:system',
                                                        localId: 'system',
                                                        direction: 'input',
                                                        dataType: 'text',
                                                        label: 'System',
                                                    },
                                                    {
                                                        id: 'ai-node:prompt',
                                                        localId: 'prompt',
                                                        direction: 'input',
                                                        dataType: 'text',
                                                        label: 'Prompt',
                                                    },
                                                ],
                                                outputPorts: [
                                                    {
                                                        id: 'ai-node:output',
                                                        localId: 'output',
                                                        direction: 'output',
                                                        dataType: 'any',
                                                        label: 'Output',
                                                    },
                                                ],
                                            },
                                            {
                                                id: 'view-output',
                                                blockId: 'view',
                                                label: 'View Output',
                                                inputPorts: [
                                                    {
                                                        id: 'view-output:input',
                                                        localId: 'input',
                                                        direction: 'input',
                                                        dataType: 'any',
                                                        label: 'Input',
                                                    },
                                                ],
                                                outputPorts: [],
                                            },
                                        ],
                                        edges: [
                                            {
                                                id: 'system-input:output->ai-node:system',
                                                sourceNodeId: 'system-input',
                                                sourcePortId: 'system-input:output',
                                                targetNodeId: 'ai-node',
                                                targetPortId: 'ai-node:system',
                                            },
                                            {
                                                id: 'prompt-input:output->ai-node:prompt',
                                                sourceNodeId: 'prompt-input',
                                                sourcePortId: 'prompt-input:output',
                                                targetNodeId: 'ai-node',
                                                targetPortId: 'ai-node:prompt',
                                            },
                                            {
                                                id: 'ai-node:output->view-output:input',
                                                sourceNodeId: 'ai-node',
                                                sourcePortId: 'ai-node:output',
                                                targetNodeId: 'view-output',
                                                targetPortId: 'view-output:input',
                                            },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                    {
                        id: 's7',
                        mode: 'single-tool',
                        description: 'Reflect on the sample result',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('reflectFlowResult'),
                                args: {
                                    userRequest: input.userInput,
                                    desiredCount:
                                        input.userInput.toLowerCase().includes('여러') ||
                                        input.userInput.toLowerCase().includes('multiple') ||
                                        input.userInput.toLowerCase().includes('many')
                                            ? 5
                                            : 1,
                                    wantsJson: input.userInput.toLowerCase().includes('json'),
                                    sampleResult: {
                                        status: 'completed',
                                        output: input.userInput.toLowerCase().includes('json')
                                            ? {
                                                  model: 'mock-flow-model',
                                                  items: Array.from(
                                                      { length: 5 },
                                                      (_, index) => `샘플 입력 아이디어 ${index + 1}`,
                                                  ),
                                              }
                                            : Array.from(
                                                  { length: 5 },
                                                  (_, index) => `샘플 입력 블로그 타이틀 ${index + 1}`,
                                              ).join('\n'),
                                        logs: [],
                                    },
                                },
                            },
                        ],
                    },
                    {
                        id: 's8',
                        mode: 'finalize',
                        description: 'Finalize flow design response',
                    },
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

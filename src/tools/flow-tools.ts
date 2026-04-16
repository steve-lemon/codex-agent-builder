// Flow-design tools used by the flow-designer skill.
import { z } from 'zod';
import { AgentError } from '../errors/agent-error';
import { AiGenerateBlock, BufferBlock, InputBlock, TextInputBlock, ViewBlock } from '../flow/blocks';
import {
    connectFlowPorts,
    createFlowDocument,
    createFlowNode,
    getFlowPortById,
    validateFlowNode,
} from '../flow/document';
import { planFlowGraph } from '../flow/graph';
import { DefaultExecutableFlowNodeFactory } from '../flow/runtime';
import type { FlowDocument } from '../flow/types';
import { GraphExecutionEngine } from '../graph/executor';
import { defineTool, type ToolDefinition } from './types';

const availableBlocks = [TextInputBlock, InputBlock, BufferBlock, ViewBlock, AiGenerateBlock];

const FlowPortSchema = z.object({
    id: z.string(),
    nodeId: z.string().default(''),
    localId: z.string(),
    direction: z.enum(['input', 'output']),
    dataType: z.enum(['text', 'json', 'image', 'number', 'any']),
    label: z.string(),
});

const FlowNodeSchema = z.object({
    id: z.string(),
    blockId: z.string(),
    label: z.string(),
    config: z.record(z.string()).optional(),
    inputPorts: z.array(FlowPortSchema),
    outputPorts: z.array(FlowPortSchema),
});

const FlowEdgeSchema = z.object({
    id: z.string(),
    sourceNodeId: z.string(),
    sourcePortId: z.string(),
    targetNodeId: z.string(),
    targetPortId: z.string(),
    label: z.string().optional(),
});

const FlowDocumentSchema = z.object({
    blocks: z.array(
        z.object({
            id: z.string(),
            label: z.string(),
            description: z.string().optional(),
            configs: z
                .array(
                    z.object({
                        id: z.string(),
                        label: z.string(),
                        hint: z.enum(['text', 'select', 'checkbox', 'number']),
                        required: z.boolean().optional(),
                        defaultValue: z.string().optional(),
                    }),
                )
                .optional(),
            inputs: z.array(
                z.object({
                    localId: z.string(),
                    label: z.string(),
                    direction: z.literal('input'),
                    dataType: z.enum(['text', 'json', 'image', 'number', 'any']),
                }),
            ),
            outputs: z.array(
                z.object({
                    localId: z.string(),
                    label: z.string(),
                    direction: z.literal('output'),
                    dataType: z.enum(['text', 'json', 'image', 'number', 'any']),
                }),
            ),
        }),
    ),
    nodes: z.array(FlowNodeSchema),
    edges: z.array(FlowEdgeSchema),
});

function hydrateFlowDocument(flow: FlowDocument): FlowDocument {
    return {
        ...flow,
        blocks: flow.blocks.length > 0 ? flow.blocks : availableBlocks,
        nodes: flow.nodes.map(node => ({
            ...node,
            inputPorts: node.inputPorts.map(port => ({
                ...port,
                nodeId: port.nodeId || node.id,
            })),
            outputPorts: node.outputPorts.map(port => ({
                ...port,
                nodeId: port.nodeId || node.id,
            })),
        })),
    };
}

function parseDesiredCount(userRequest: string): number {
    const digitMatch = userRequest.match(/(\d+)/);
    if (digitMatch) {
        const parsed = Number(digitMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    const lowered = userRequest.toLowerCase();
    if (
        lowered.includes('여러') ||
        lowered.includes('multiple') ||
        lowered.includes('many') ||
        lowered.includes('several') ||
        lowered.includes('titles')
    ) {
        return 5;
    }

    return 1;
}

function inferTaskType(userRequest: string, wantsJson: boolean): string {
    const lowered = userRequest.toLowerCase();
    if (
        lowered.includes('blog') ||
        lowered.includes('title') ||
        lowered.includes('타이틀') ||
        lowered.includes('제목')
    ) {
        return 'blog-title-generation';
    }
    if (wantsJson) {
        return 'json-generation';
    }
    if (lowered.trim()) {
        return 'text-generation';
    }
    return 'unknown';
}

function buildSampleInput(taskType: string, userRequest: string): string {
    const lowered = userRequest.toLowerCase();
    if (lowered.includes('keyword') || lowered.includes('키워드')) {
        return '생산성 향상';
    }
    if (taskType === 'blog-title-generation') {
        return '원격 근무';
    }
    return '샘플 입력';
}

function buildSystemPrompt(userRequest: string, improvementNotes: string[]): string {
    const lowered = userRequest.toLowerCase();
    const basePrompt =
        lowered.includes('blog') || lowered.includes('title') || lowered.includes('타이틀') || lowered.includes('제목')
            ? 'You generate clear and catchy blog titles based on one keyword.'
            : lowered.includes('json')
            ? 'You return concise structured output that can be safely parsed as JSON.'
            : 'You transform text requests into concise useful outputs.';

    return improvementNotes.length > 0
        ? `${basePrompt} Improvements to apply: ${improvementNotes.join(' | ')}`
        : basePrompt;
}

function buildUserPrompt(
    userRequest: string,
    sampleInput: string,
    desiredCount: number,
    wantsJson: boolean,
    improvementNotes: string[],
): string {
    const desiredCountInstruction = desiredCount > 1 ? `Return exactly ${desiredCount} results.` : 'Return one result.';
    const formatInstruction = wantsJson
        ? 'Return JSON only.'
        : desiredCount > 1
        ? 'Return each result on its own line.'
        : 'Return plain text.';
    const improvementText = improvementNotes.length > 0 ? ` Improvement notes: ${improvementNotes.join(' | ')}` : '';
    return `User request: ${userRequest}. Sample input: ${sampleInput}. ${desiredCountInstruction} ${formatInstruction}${improvementText}`;
}

function extractItems(output: unknown): string[] {
    if (Array.isArray(output)) {
        return output.map(item => (typeof item === 'string' ? item.trim() : JSON.stringify(item))).filter(Boolean);
    }
    if (typeof output === 'string') {
        return output
            .split('\n')
            .map(line => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
            .filter(Boolean);
    }
    if (output && typeof output === 'object' && Array.isArray((output as { items?: unknown[] }).items)) {
        return extractItems((output as { items?: unknown[] }).items ?? []);
    }
    return [];
}

async function executeFlowSample(flow: FlowDocument, userRequest: string, improvementNotes: string[]) {
    const logs: string[] = [];
    let currentFlow = flow;
    const factory = new DefaultExecutableFlowNodeFactory({
        logger: message => {
            logs.push(message);
        },
        aiGenerate: async request => {
            const countMatch = request.prompt.match(/exactly\s+(\d+)\s+results?/i);
            const count = countMatch ? Number(countMatch[1]) : 1;
            const sampleInputMatch = request.prompt.match(/Sample input:\s*([^.]+)\./i);
            const sampleInput = sampleInputMatch?.[1]?.trim() ?? '샘플 입력';

            if (request.jsonOutput) {
                return {
                    model: request.model,
                    items: Array.from(
                        { length: Math.max(1, count) },
                        (_, index) => `${sampleInput} 아이디어 ${index + 1}`,
                    ),
                    context: {
                        userRequest,
                        improvementNotes,
                    },
                };
            }

            return Array.from(
                { length: Math.max(1, count) },
                (_, index) => `${sampleInput} 블로그 타이틀 ${index + 1}`,
            ).join('\n');
        },
    });
    const planned = planFlowGraph(flow);
    const engine = new GraphExecutionEngine<string>(
        async input => {
            const runtime = factory.create(currentFlow, input.node.id);
            currentFlow = await runtime.execute(currentFlow);
            return input.node.id;
        },
        {
            maxConcurrency: 1,
        },
    );
    const graphRun = await engine.execute(planned.graph, planned.plan);

    return {
        status: graphRun.status,
        output: getFlowPortById(currentFlow, 'ai-node:output')?.packet?.value,
        logs,
        executionOrder: graphRun.executionOrder,
        error: graphRun.error,
    };
}

/** Returns deterministic tools used by the flow-designer skill. */
export function createFlowDesignTools(): ToolDefinition[] {
    return [
        defineTool({
            name: 'analyzeFlowRequest',
            description: 'Analyze a user request into flow-design intent, constraints, and success criteria.',
            parameters: z.object({
                userRequest: z.string(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ userRequest }) => {
                const wantsJson =
                    userRequest.toLowerCase().includes('json') ||
                    userRequest.toLowerCase().includes('structured') ||
                    userRequest.includes('구조화');
                const desiredCount = parseDesiredCount(userRequest);
                const taskType = inferTaskType(userRequest, wantsJson);
                return {
                    taskType,
                    wantsJson,
                    wantsMultiple: desiredCount > 1,
                    desiredCount,
                    sampleInput: buildSampleInput(taskType, userRequest),
                    constraints: ['Use only available blocks from the repository.'],
                    successCriteria:
                        desiredCount > 1 ? [`Produce ${desiredCount} useful outputs.`] : ['Produce one useful output.'],
                };
            },
        }),
        defineTool({
            name: 'listAvailableFlowBlocks',
            description: 'List the available flow blocks with ports and config schemas.',
            parameters: z.object({
                includeIds: z.array(z.string()).optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ includeIds }) => {
                const ids = includeIds ? new Set(includeIds) : undefined;
                return availableBlocks
                    .filter(block => !ids || ids.has(block.id))
                    .map(block => ({
                        id: block.id,
                        label: block.label,
                        description: block.description,
                        configs: block.configs ?? [],
                        inputs: block.inputs,
                        outputs: block.outputs,
                    }));
            },
        }),
        defineTool({
            name: 'designFlowDraft',
            description: 'Create a flow draft using only the available flow blocks and optional improvement notes.',
            parameters: z.object({
                userRequest: z.string(),
                sampleInput: z.string(),
                desiredCount: z.number().int().positive(),
                wantsJson: z.boolean(),
                improvementNotes: z.array(z.string()).optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: false,
            execute: async ({ userRequest, sampleInput, desiredCount, wantsJson, improvementNotes = [] }) => {
                let flow = createFlowDocument(availableBlocks);
                flow = createFlowNode(flow, InputBlock.id, {
                    nodeId: 'system-input',
                    label: 'System Input',
                    config: {
                        input: buildSystemPrompt(userRequest, improvementNotes),
                    },
                }).flow;
                flow = createFlowNode(flow, InputBlock.id, {
                    nodeId: 'prompt-input',
                    label: 'Prompt Input',
                    config: {
                        input: buildUserPrompt(userRequest, sampleInput, desiredCount, wantsJson, improvementNotes),
                    },
                }).flow;
                flow = createFlowNode(flow, AiGenerateBlock.id, {
                    nodeId: 'ai-node',
                    label: 'AI Generate',
                    config: {
                        model: 'mock-flow-model',
                        jsonOutput: String(wantsJson),
                    },
                }).flow;
                flow = createFlowNode(flow, ViewBlock.id, {
                    nodeId: 'view-output',
                    label: 'View Output',
                }).flow;
                flow = connectFlowPorts(flow, {
                    sourceNodeId: 'system-input',
                    sourcePort: 'output',
                    targetNodeId: 'ai-node',
                    targetPort: 'system',
                }).flow;
                flow = connectFlowPorts(flow, {
                    sourceNodeId: 'prompt-input',
                    sourcePort: 'output',
                    targetNodeId: 'ai-node',
                    targetPort: 'prompt',
                }).flow;
                flow = connectFlowPorts(flow, {
                    sourceNodeId: 'ai-node',
                    sourcePort: 'output',
                    targetNodeId: 'view-output',
                    targetPort: 'input',
                }).flow;

                return {
                    flow,
                    designRationale: [
                        'Use input nodes to materialize deterministic system and prompt text.',
                        'Use one AI node to generate the requested output.',
                        'Use a view node to inspect the final sample output.',
                    ],
                };
            },
        }),
        defineTool({
            name: 'validateFlowDraft',
            description: 'Validate a flow draft and confirm that it can be planned for execution.',
            parameters: z.object({
                flow: FlowDocumentSchema,
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ flow }) => {
                const hydratedFlow = hydrateFlowDocument(flow);
                const issues: string[] = [];
                for (const node of hydratedFlow.nodes) {
                    const result = validateFlowNode(hydratedFlow, node.id);
                    issues.push(...result.issues.map(issue => issue.message));
                }

                let planSummary: { batchCount: number; nodeCount: number } | undefined;
                try {
                    const plan = planFlowGraph(hydratedFlow).plan;
                    planSummary = {
                        batchCount: plan.batches.length,
                        nodeCount: plan.nodes.length,
                    };
                } catch (error) {
                    issues.push(AgentError.from(error).message);
                }

                return {
                    isValid: issues.length === 0,
                    issues,
                    planSummary,
                };
            },
        }),
        defineTool({
            name: 'runFlowSample',
            description: 'Run a deterministic sample execution of a flow draft and return the final output plus logs.',
            parameters: z.object({
                userRequest: z.string(),
                flow: FlowDocumentSchema,
                improvementNotes: z.array(z.string()).optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: false,
            execute: async ({ userRequest, flow, improvementNotes = [] }) => {
                return await executeFlowSample(hydrateFlowDocument(flow), userRequest, improvementNotes);
            },
        }),
        defineTool({
            name: 'reflectFlowResult',
            description: 'Reflect on whether the sample flow output satisfies the original user request.',
            parameters: z.object({
                userRequest: z.string(),
                desiredCount: z.number().int().positive(),
                wantsJson: z.boolean(),
                sampleResult: z.object({
                    status: z.enum(['completed', 'failed', 'cancelled']),
                    output: z.unknown().optional(),
                    logs: z.array(z.string()),
                }),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ userRequest, desiredCount, wantsJson, sampleResult }) => {
                const issues: string[] = [];
                const suggestedImprovements: string[] = [];
                const items = extractItems(sampleResult.output);

                if (sampleResult.status !== 'completed') {
                    issues.push(`Sample execution ended with status ${sampleResult.status}.`);
                    suggestedImprovements.push('Stabilize the flow execution path before retrying.');
                }

                if (
                    wantsJson &&
                    (!sampleResult.output ||
                        typeof sampleResult.output !== 'object' ||
                        Array.isArray(sampleResult.output))
                ) {
                    issues.push('The output was not JSON-shaped even though JSON output was requested.');
                    suggestedImprovements.push('Force the AI block to return JSON only.');
                }

                if (desiredCount > 1 && items.length < desiredCount) {
                    issues.push(`The output only produced ${items.length} item(s) but ${desiredCount} were requested.`);
                    suggestedImprovements.push(`Ask for exactly ${desiredCount} distinct results.`);
                }

                const lowered = userRequest.toLowerCase();
                if (
                    (lowered.includes('blog') ||
                        lowered.includes('title') ||
                        lowered.includes('타이틀') ||
                        lowered.includes('제목')) &&
                    items.length > 0 &&
                    items.every(item => item.length < 6)
                ) {
                    issues.push('The output did not look like usable blog titles.');
                    suggestedImprovements.push('Make each result read like a publishable blog title.');
                }

                return {
                    satisfied: issues.length === 0,
                    summary:
                        issues.length === 0
                            ? 'The sample flow output appears to satisfy the request.'
                            : 'The sample flow output needs another design pass.',
                    issues,
                    improvementNotes: suggestedImprovements,
                };
            },
        }),
    ];
}

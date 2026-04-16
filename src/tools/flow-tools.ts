// Flow-design tools used by the flow-designer skill.
import { z } from 'zod';
import { AgentError } from '../errors/agent-error';
import { AiGenerateBlock, BufferBlock, InputBlock, TextInputBlock, ViewBlock } from '../flow/blocks';
import { FlowDesignSession } from '../flow/design-monitor';
import {
    connectFlowPorts,
    createFlowDocument,
    createFlowNode,
    createFlowPacket,
    getFlowPortById,
    setFlowPortPacket,
    validateFlowNode,
} from '../flow/document';
import { planFlowGraph } from '../flow/graph';
import { DefaultExecutableFlowNodeFactory } from '../flow/runtime';
import type { FlowDocument } from '../flow/types';
import { GraphExecutionEngine } from '../graph/executor';
import type { DirectedGraph } from '../graph/types';
import { defineTool, type ToolDefinition } from './types';

const availableBlocks = [TextInputBlock, InputBlock, BufferBlock, ViewBlock, AiGenerateBlock];
const availableCapabilities = [
    'text-input',
    'text-output',
    'delay',
    'view-log',
    'mock-ai-generation',
    'structured-output',
];
const blockCapabilityMap: Record<string, string[]> = {
    'text-input': ['text-input'],
    input: ['text-input'],
    buffer: ['delay'],
    view: ['view-log', 'text-output'],
    'ai-generate': ['mock-ai-generation', 'structured-output', 'text-output'],
};

interface TaskNodeAnalysis {
    nodeId: string;
    operation: string;
    expectedInputs: string[];
    expectedOutputs: string[];
    requiredCapabilities: string[];
    matchedBlockIds: string[];
    feasible: boolean;
    reasons: string[];
}

interface ProposedBlockDraft {
    blockId: string;
    purpose: string;
    requiredCapabilities: string[];
    suggestedInputs: Array<{ localId: string; dataType: string; description: string }>;
    suggestedOutputs: Array<{ localId: string; dataType: string; description: string }>;
    suggestedConfigs: Array<{ id: string; hint: string; required: boolean; description: string }>;
}

interface TaskGraphNode {
    id: string;
    label?: string;
    data?: Record<string, unknown>;
}

interface TaskGraphEdge {
    source: string;
    target: string;
    label?: string;
    data?: Record<string, unknown>;
}

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

const PreflightSummarySchema = z.object({
    feasible: z.boolean(),
    requiredCapabilities: z.array(z.string()),
    availableCapabilities: z.array(z.string()),
    missingCapabilities: z.array(z.string()),
    reason: z.string(),
    recommendedAction: z.string(),
    taskGraph: z.object({
        nodes: z.array(
            z.object({
                id: z.string(),
                label: z.string().optional(),
                data: z.record(z.unknown()).optional(),
            }),
        ),
        edges: z.array(
            z.object({
                source: z.string(),
                target: z.string(),
                label: z.string().optional(),
                data: z.record(z.unknown()).optional(),
            }),
        ),
    }),
    nodeAnalyses: z.array(
        z.object({
            nodeId: z.string(),
            operation: z.string(),
            expectedInputs: z.array(z.string()),
            expectedOutputs: z.array(z.string()),
            requiredCapabilities: z.array(z.string()),
            matchedBlockIds: z.array(z.string()),
            feasible: z.boolean(),
            reasons: z.array(z.string()),
        }),
    ),
    proposedBlocks: z.array(
        z.object({
            blockId: z.string(),
            purpose: z.string(),
            requiredCapabilities: z.array(z.string()),
            suggestedInputs: z.array(
                z.object({
                    localId: z.string(),
                    dataType: z.string(),
                    description: z.string(),
                }),
            ),
            suggestedOutputs: z.array(
                z.object({
                    localId: z.string(),
                    dataType: z.string(),
                    description: z.string(),
                }),
            ),
            suggestedConfigs: z.array(
                z.object({
                    id: z.string(),
                    hint: z.string(),
                    required: z.boolean(),
                    description: z.string(),
                }),
            ),
        }),
    ),
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

function findTaskNodeByCapability(taskNodes: TaskGraphNode[], capability: string): TaskGraphNode | undefined {
    return taskNodes.find(node => {
        const requiredCapabilities = (node.data?.requiredCapabilities as string[] | undefined) ?? [];
        return requiredCapabilities.includes(capability);
    });
}

function findTaskNodeByOperation(taskNodes: TaskGraphNode[], operationPrefix: string): TaskGraphNode | undefined {
    return taskNodes.find(node => String(node.data?.operation ?? '').startsWith(operationPrefix));
}

function buildTaskGraphMapping(taskNodes: TaskGraphNode[]) {
    const captureNode =
        findTaskNodeByCapability(taskNodes, 'text-input') ?? findTaskNodeByOperation(taskNodes, 'capture');
    const generateNode =
        findTaskNodeByCapability(taskNodes, 'mock-ai-generation') ?? findTaskNodeByOperation(taskNodes, 'generate');
    const reviewNode = findTaskNodeByCapability(taskNodes, 'view-log') ?? findTaskNodeByOperation(taskNodes, 'log');

    return {
        promptInput: captureNode,
        generate: generateNode,
        review: reviewNode,
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

function inferRequiredCapabilities(userRequest: string): string[] {
    const lowered = userRequest.toLowerCase();
    const required = new Set<string>();

    if (lowered.includes('email') || lowered.includes('mail') || userRequest.includes('이메일')) {
        required.add('email-read');
    }
    if (
        lowered.includes('reply') ||
        lowered.includes('respond') ||
        lowered.includes('send email') ||
        userRequest.includes('답장') ||
        userRequest.includes('회신')
    ) {
        required.add('email-reply');
    }
    if (lowered.includes('slack')) {
        required.add('slack-send');
    }
    if (lowered.includes('calendar') || userRequest.includes('캘린더')) {
        required.add('calendar-read');
    }
    if (
        lowered.includes('blog') ||
        lowered.includes('title') ||
        userRequest.includes('타이틀') ||
        userRequest.includes('제목')
    ) {
        required.add('mock-ai-generation');
        required.add('text-input');
        required.add('text-output');
    }
    if (lowered.includes('json') || userRequest.includes('구조화')) {
        required.add('structured-output');
    }

    return [...required];
}

function inferTaskGraph(userRequest: string): DirectedGraph {
    const lowered = userRequest.toLowerCase();

    if (lowered.includes('email') || lowered.includes('mail') || userRequest.includes('이메일')) {
        return {
            nodes: [
                {
                    id: 'email-read',
                    label: 'Read Email',
                    data: {
                        operation: 'read-email',
                        expectedInputs: ['mailbox connection', 'message selector'],
                        expectedOutputs: ['email thread text', 'message metadata'],
                        requiredCapabilities: ['email-read'],
                    },
                },
                {
                    id: 'draft-reply',
                    label: 'Draft Reply',
                    data: {
                        operation: 'draft-reply',
                        expectedInputs: ['email thread text', 'response policy'],
                        expectedOutputs: ['reply body text'],
                        requiredCapabilities: ['mock-ai-generation', 'text-output'],
                    },
                },
                {
                    id: 'send-reply',
                    label: 'Send Reply',
                    data: {
                        operation: 'send-email-reply',
                        expectedInputs: ['reply body text', 'recipient metadata'],
                        expectedOutputs: ['delivery confirmation'],
                        requiredCapabilities: ['email-reply'],
                    },
                },
            ],
            edges: [
                { source: 'email-read', target: 'draft-reply', label: 'thread text' },
                { source: 'draft-reply', target: 'send-reply', label: 'reply draft' },
            ],
        };
    }

    if (
        lowered.includes('blog') ||
        lowered.includes('title') ||
        userRequest.includes('타이틀') ||
        userRequest.includes('제목')
    ) {
        return {
            nodes: [
                {
                    id: 'capture-request',
                    label: 'Capture Request',
                    data: {
                        operation: 'capture-text',
                        expectedInputs: ['user request'],
                        expectedOutputs: ['prompt text'],
                        requiredCapabilities: ['text-input'],
                    },
                },
                {
                    id: 'generate-titles',
                    label: 'Generate Titles',
                    data: {
                        operation: 'generate-text',
                        expectedInputs: ['prompt text', 'system instruction'],
                        expectedOutputs: ['title suggestions'],
                        requiredCapabilities: ['mock-ai-generation', 'text-output'],
                    },
                },
                {
                    id: 'review-output',
                    label: 'Review Output',
                    data: {
                        operation: 'log-output',
                        expectedInputs: ['title suggestions'],
                        expectedOutputs: ['execution log'],
                        requiredCapabilities: ['view-log'],
                    },
                },
            ],
            edges: [
                { source: 'capture-request', target: 'generate-titles', label: 'prompt text' },
                { source: 'generate-titles', target: 'review-output', label: 'generated titles' },
            ],
        };
    }

    return {
        nodes: [
            {
                id: 'capture-request',
                label: 'Capture Request',
                data: {
                    operation: 'capture-text',
                    expectedInputs: ['user request'],
                    expectedOutputs: ['prompt text'],
                    requiredCapabilities: ['text-input'],
                },
            },
            {
                id: 'generate-output',
                label: 'Generate Output',
                data: {
                    operation: 'generate-text',
                    expectedInputs: ['prompt text'],
                    expectedOutputs: ['response text'],
                    requiredCapabilities: ['mock-ai-generation', 'text-output'],
                },
            },
            {
                id: 'review-output',
                label: 'Review Output',
                data: {
                    operation: 'log-output',
                    expectedInputs: ['response text'],
                    expectedOutputs: ['execution log'],
                    requiredCapabilities: ['view-log'],
                },
            },
        ],
        edges: [
            { source: 'capture-request', target: 'generate-output', label: 'prompt text' },
            { source: 'generate-output', target: 'review-output', label: 'generated response' },
        ],
    };
}

function analyzeTaskGraph(graph: DirectedGraph): TaskNodeAnalysis[] {
    return graph.nodes.map(node => {
        const requiredCapabilities = ((node.data?.requiredCapabilities as string[] | undefined) ?? []).slice();
        const matchedBlockIds = availableBlocks
            .filter(block => {
                const blockCapabilities = blockCapabilityMap[block.id] ?? [];
                return requiredCapabilities.every(capability => blockCapabilities.includes(capability));
            })
            .map(block => block.id);
        const reasons =
            matchedBlockIds.length > 0
                ? [`Matched block candidates: ${matchedBlockIds.join(', ')}`]
                : [`No block currently provides all required capabilities: ${requiredCapabilities.join(', ')}`];

        return {
            nodeId: node.id,
            operation: String(node.data?.operation ?? node.label ?? node.id),
            expectedInputs: ((node.data?.expectedInputs as string[] | undefined) ?? []).slice(),
            expectedOutputs: ((node.data?.expectedOutputs as string[] | undefined) ?? []).slice(),
            requiredCapabilities,
            matchedBlockIds,
            feasible: matchedBlockIds.length > 0,
            reasons,
        };
    });
}

function buildProposedBlocks(nodeAnalyses: TaskNodeAnalysis[]): ProposedBlockDraft[] {
    return nodeAnalyses
        .filter(node => !node.feasible)
        .map(node => ({
            blockId: `${node.nodeId}-block`,
            purpose: `Support the '${node.operation}' task node in the inferred request graph.`,
            requiredCapabilities: [...node.requiredCapabilities],
            suggestedInputs: node.expectedInputs.map((description, index) => ({
                localId: `input${index + 1}`,
                dataType: description.includes('metadata') ? 'json' : 'text',
                description,
            })),
            suggestedOutputs: node.expectedOutputs.map((description, index) => ({
                localId: `output${index + 1}`,
                dataType: description.includes('metadata') || description.includes('confirmation') ? 'json' : 'text',
                description,
            })),
            suggestedConfigs: [
                {
                    id: 'provider',
                    hint: 'text',
                    required: true,
                    description: `Connection or provider identifier needed for ${node.operation}.`,
                },
            ],
        }));
}

function assessFlowFeasibility(userRequest: string) {
    const taskGraph = inferTaskGraph(userRequest);
    const nodeAnalyses = analyzeTaskGraph(taskGraph);
    const requiredCapabilities = inferRequiredCapabilities(userRequest);
    const missingCapabilities = requiredCapabilities.filter(capability => !availableCapabilities.includes(capability));
    const graphLevelMissingCapabilities = nodeAnalyses
        .filter(node => !node.feasible)
        .flatMap(node => node.requiredCapabilities)
        .filter((capability, index, all) => all.indexOf(capability) === index);
    const feasible = missingCapabilities.length === 0 && nodeAnalyses.every(node => node.feasible);
    const proposedBlocks = buildProposedBlocks(nodeAnalyses);

    return {
        feasible,
        taskGraph,
        nodeAnalyses,
        requiredCapabilities,
        availableCapabilities,
        missingCapabilities: [...new Set([...missingCapabilities, ...graphLevelMissingCapabilities])],
        proposedBlocks,
        reason: feasible
            ? 'The request can be covered by the currently available blocks after graph-based design analysis.'
            : 'The inferred task graph contains nodes whose required capabilities are not covered by the available blocks.',
        recommendedAction: feasible
            ? 'Proceed with flow design and sample execution.'
            : `Add blocks or tools for: ${[...new Set([...missingCapabilities, ...graphLevelMissingCapabilities])].join(
                  ', ',
              )}`,
    };
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

function getBlockById(blockId: string) {
    const block = availableBlocks.find(candidate => candidate.id === blockId);
    if (!block) {
        throw new AgentError(`Flow block not found: ${blockId}`);
    }

    return block;
}

function buildBehaviorNotes(blockId: string): string[] {
    switch (blockId) {
        case 'input':
            return ['Writes the string config.input value into the output packet.'];
        case 'buffer':
            return ['Reads the input packet, waits for the configured delay, then forwards the same packet to output.'];
        case 'view':
            return ['Reads the input packet and logs its formatted value without creating a new output packet.'];
        case 'ai-generate':
            return ['Reads system/prompt text and writes the mock generation result into the output port.'];
        default:
            return ['Observed block behavior via deterministic sample execution.'];
    }
}

function inferSpecMismatches(
    blockId: string,
    observedOutputs: Record<string, unknown>,
    observedLogs: string[],
    blockDescription: string | undefined,
): string[] {
    const mismatches: string[] = [];

    if (!blockDescription || blockDescription.trim().length < 20) {
        mismatches.push('Block description is short and may not explain practical runtime behavior.');
    }

    if (blockId === 'ai-generate' && observedOutputs.output && typeof observedOutputs.output === 'object') {
        mismatches.push(
            'The output port can emit structured object payloads when jsonOutput=true, but the description does not explain that.',
        );
    }

    if (blockId === 'view' && observedLogs.length > 0 && !(blockDescription ?? '').toLowerCase().includes('log')) {
        mismatches.push('The description should mention that execution produces logs rather than output packets.');
    }

    return mismatches;
}

async function probeFlowBlockRuntime(args: {
    blockId: string;
    sampleConfig?: Record<string, string>;
    sampleInputs?: Record<string, unknown>;
}) {
    const block = getBlockById(args.blockId);
    if (!['input', 'buffer', 'view', 'ai-generate'].includes(block.id)) {
        throw new AgentError(`Flow block does not support runtime probing yet: ${block.id}`);
    }

    let flow = createFlowDocument(availableBlocks);
    const created = createFlowNode(flow, block.id, {
        nodeId: 'probe-node',
        config: args.sampleConfig,
    });
    flow = created.flow;

    for (const [portId, value] of Object.entries(args.sampleInputs ?? {})) {
        flow = setFlowPortPacket(flow, {
            nodeId: 'probe-node',
            port: portId,
            packet: createFlowPacket(value, 1000),
        }).flow;
    }

    const observedLogs: string[] = [];
    const factory = new DefaultExecutableFlowNodeFactory({
        logger: message => {
            observedLogs.push(message);
        },
        sleep: async () => {
            return;
        },
        aiGenerate: async request => {
            if (request.jsonOutput) {
                return {
                    model: request.model,
                    output: `mocked response for: ${request.prompt}`,
                    format: 'json',
                };
            }

            return `[${request.model}] mocked response for: ${request.prompt}`;
        },
    });

    const runtime = factory.create(flow, 'probe-node');
    const nextFlow = await runtime.execute(flow);
    const observedOutputs = Object.fromEntries(
        created.node.outputPorts.map(port => [port.localId, getFlowPortById(nextFlow, port.id)?.packet?.value]),
    );

    return {
        blockId: block.id,
        observedOutputs,
        observedLogs,
        behaviorNotes: buildBehaviorNotes(block.id),
        mismatchesFromSpec: inferSpecMismatches(block.id, observedOutputs, observedLogs, block.description),
    };
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
            name: 'assessFlowFeasibility',
            description:
                'Check whether the current block set can satisfy the request, and report missing capabilities early.',
            parameters: z.object({
                userRequest: z.string(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ userRequest }) => {
                return assessFlowFeasibility(userRequest);
            },
        }),
        defineTool({
            name: 'probeFlowBlock',
            description:
                'Run a deterministic probe against one executable block to observe its actual runtime behavior.',
            parameters: z.object({
                blockId: z.string(),
                sampleConfig: z.record(z.string()).optional(),
                sampleInputs: z.record(z.unknown()).optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: false,
            execute: async ({ blockId, sampleConfig, sampleInputs }) => {
                return await probeFlowBlockRuntime({
                    blockId,
                    sampleConfig,
                    sampleInputs,
                });
            },
        }),
        defineTool({
            name: 'designFlowDraft',
            description:
                'Create a flow draft using only the available flow blocks, grounded by preflight validation and optional improvement notes.',
            parameters: z.object({
                userRequest: z.string(),
                sampleInput: z.string(),
                desiredCount: z.number().int().positive(),
                wantsJson: z.boolean(),
                improvementNotes: z.array(z.string()).optional(),
                preflight: PreflightSummarySchema.optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: false,
            execute: async (
                { userRequest, sampleInput, desiredCount, wantsJson, improvementNotes = [], preflight },
                context,
            ) => {
                const feasibility = preflight ?? assessFlowFeasibility(userRequest);
                if (!feasibility.feasible) {
                    throw new AgentError(
                        `Flow design is not feasible with current blocks. Missing capabilities: ${feasibility.missingCapabilities.join(
                            ', ',
                        )}`,
                    );
                }

                const taskNodes = feasibility.taskGraph.nodes as TaskGraphNode[];
                const taskEdges = feasibility.taskGraph.edges as TaskGraphEdge[];
                const mapping = buildTaskGraphMapping(taskNodes);
                let flow = createFlowDocument(availableBlocks);
                const monitor = context.designConnection
                    ? new FlowDesignSession(
                          `${context.runId}:designFlowDraft`,
                          availableBlocks,
                          context.designConnection,
                      )
                    : undefined;

                monitor?.start({
                    toolName: 'designFlowDraft',
                    userRequest,
                });
                monitor?.stageNode('system-input', {
                    label: 'System Input',
                    blockId: InputBlock.id,
                    state: 'building-system-prompt',
                });
                monitor?.createNode(InputBlock.id, {
                    nodeId: 'system-input',
                    label: 'System Input',
                    config: {
                        input: buildSystemPrompt(userRequest, improvementNotes),
                    },
                });
                monitor?.setNodePhase('system-input', 'ready', 'system-prompt-ready');

                monitor?.stageNode('prompt-input', {
                    label: mapping.promptInput?.label ?? 'Prompt Input',
                    blockId: InputBlock.id,
                    state: 'building-user-prompt',
                });
                monitor?.createNode(InputBlock.id, {
                    nodeId: 'prompt-input',
                    label: mapping.promptInput?.label ?? 'Prompt Input',
                    config: {
                        input: buildUserPrompt(userRequest, sampleInput, desiredCount, wantsJson, improvementNotes),
                    },
                });
                monitor?.setNodePhase('prompt-input', 'ready', 'user-prompt-ready');

                monitor?.stageNode('ai-node', {
                    label: mapping.generate?.label ?? 'AI Generate',
                    blockId: AiGenerateBlock.id,
                    state: 'configuring-generation',
                });
                monitor?.createNode(AiGenerateBlock.id, {
                    nodeId: 'ai-node',
                    label: mapping.generate?.label ?? 'AI Generate',
                    config: {
                        model: 'mock-flow-model',
                        jsonOutput: String(wantsJson),
                    },
                });
                monitor?.setNodePhase('ai-node', 'created', 'awaiting-connections');

                monitor?.stageNode('view-output', {
                    label: mapping.review?.label ?? 'View Output',
                    blockId: ViewBlock.id,
                    state: 'creating-output-review',
                });
                monitor?.createNode(ViewBlock.id, {
                    nodeId: 'view-output',
                    label: mapping.review?.label ?? 'View Output',
                });
                monitor?.setNodePhase('view-output', 'created', 'awaiting-connections');

                if (monitor) {
                    monitor.connectPorts(
                        {
                            sourceNodeId: 'system-input',
                            sourcePort: 'output',
                            targetNodeId: 'ai-node',
                            targetPort: 'system',
                        },
                        { flowHint: 'horizontal' },
                    );
                    monitor.connectPorts(
                        {
                            sourceNodeId: 'prompt-input',
                            sourcePort: 'output',
                            targetNodeId: 'ai-node',
                            targetPort: 'prompt',
                        },
                        { flowHint: 'horizontal' },
                    );
                    monitor.connectPorts(
                        {
                            sourceNodeId: 'ai-node',
                            sourcePort: 'output',
                            targetNodeId: 'view-output',
                            targetPort: 'input',
                        },
                        { flowHint: 'horizontal' },
                    );
                    monitor.setNodePhase('ai-node', 'connected', 'generation-graph-wired');
                    monitor.setNodePhase('view-output', 'connected', 'review-graph-wired');
                    monitor.complete({
                        toolName: 'designFlowDraft',
                        status: 'completed',
                    });
                    flow = monitor.getFlow();
                } else {
                    flow = createFlowNode(flow, InputBlock.id, {
                        nodeId: 'system-input',
                        label: 'System Input',
                        config: {
                            input: buildSystemPrompt(userRequest, improvementNotes),
                        },
                    }).flow;
                    flow = createFlowNode(flow, InputBlock.id, {
                        nodeId: 'prompt-input',
                        label: mapping.promptInput?.label ?? 'Prompt Input',
                        config: {
                            input: buildUserPrompt(userRequest, sampleInput, desiredCount, wantsJson, improvementNotes),
                        },
                    }).flow;
                    flow = createFlowNode(flow, AiGenerateBlock.id, {
                        nodeId: 'ai-node',
                        label: mapping.generate?.label ?? 'AI Generate',
                        config: {
                            model: 'mock-flow-model',
                            jsonOutput: String(wantsJson),
                        },
                    }).flow;
                    flow = createFlowNode(flow, ViewBlock.id, {
                        nodeId: 'view-output',
                        label: mapping.review?.label ?? 'View Output',
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
                }

                return {
                    flow,
                    designRationale: [
                        `Use preflight validation to confirm required capabilities are available: ${
                            feasibility.requiredCapabilities.join(', ') || 'none'
                        }.`,
                        `Map inferred task node '${
                            mapping.promptInput?.id ?? 'capture-request'
                        }' to the prompt input node.`,
                        `Map inferred task node '${
                            mapping.generate?.id ?? 'generate-output'
                        }' to the AI generation node.`,
                        `Map inferred task node '${mapping.review?.id ?? 'review-output'}' to the output review node.`,
                        `Preserve inferred task edges in the simplified flow path: ${
                            taskEdges.map(edge => `${edge.source}->${edge.target}`).join(', ') || 'none'
                        }.`,
                    ],
                    preflightSummary: {
                        taskGraphNodeCount: feasibility.taskGraph.nodes.length,
                        feasible: feasibility.feasible,
                        missingCapabilities: feasibility.missingCapabilities,
                    },
                    taskGraphMapping: {
                        flowNodes: [
                            { flowNodeId: 'system-input', role: 'system-instruction' },
                            {
                                flowNodeId: 'prompt-input',
                                taskNodeId: mapping.promptInput?.id,
                                taskNodeLabel: mapping.promptInput?.label,
                            },
                            {
                                flowNodeId: 'ai-node',
                                taskNodeId: mapping.generate?.id,
                                taskNodeLabel: mapping.generate?.label,
                            },
                            {
                                flowNodeId: 'view-output',
                                taskNodeId: mapping.review?.id,
                                taskNodeLabel: mapping.review?.label,
                            },
                        ],
                        taskEdges: taskEdges.map(edge => ({
                            source: edge.source,
                            target: edge.target,
                            label: edge.label,
                        })),
                    },
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
            name: 'proposeBlockSpecUpdate',
            description:
                'Generate a documentation update proposal when block probing reveals missing or unclear behavior details.',
            parameters: z.object({
                blockId: z.string(),
                probeResult: z.object({
                    behaviorNotes: z.array(z.string()),
                    mismatchesFromSpec: z.array(z.string()),
                    observedOutputs: z.record(z.unknown()).optional(),
                    observedLogs: z.array(z.string()).optional(),
                }),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ blockId, probeResult }) => {
                const block = getBlockById(blockId);
                if (probeResult.mismatchesFromSpec.length === 0) {
                    return {
                        blockId,
                        missingDetails: [],
                        suggestedDocPatch: `No documentation update appears necessary for ${block.label}.`,
                    };
                }

                const suggestedDocPatch = [
                    `Update ${block.id} block documentation to clarify:`,
                    ...probeResult.mismatchesFromSpec.map(detail => `- ${detail}`),
                    ...probeResult.behaviorNotes.map(note => `- Observed behavior: ${note}`),
                ].join('\n');

                return {
                    blockId,
                    missingDetails: [...probeResult.mismatchesFromSpec],
                    suggestedDocPatch,
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

                const nodeConfigSkillImprovements: string[] = [];
                const nodeConfigStrategyDirectives: Array<{ strategyId: string; note: string }> = [];
                if (wantsJson) {
                    nodeConfigSkillImprovements.push(
                        'Prefer a structured-output model profile and stricter system instructions for JSON mode.',
                    );
                    nodeConfigStrategyDirectives.push({
                        strategyId: 'ai-generation',
                        note: 'Prefer a structured-output model profile and stricter system instructions for JSON mode.',
                    });
                }
                if (desiredCount > 1) {
                    nodeConfigSkillImprovements.push(
                        `Tune the prompt-input node so the AI block is explicitly asked for exactly ${desiredCount} outputs.`,
                    );
                    nodeConfigStrategyDirectives.push({
                        strategyId: 'prompt-input',
                        note: `Ask for exactly ${desiredCount} outputs with explicit count wording.`,
                    });
                }
                if (
                    lowered.includes('blog') ||
                    lowered.includes('title') ||
                    lowered.includes('타이틀') ||
                    lowered.includes('제목')
                ) {
                    nodeConfigSkillImprovements.push(
                        'Strengthen the system-input node to emphasize publishable headline quality and distinct title phrasing.',
                    );
                    nodeConfigStrategyDirectives.push({
                        strategyId: 'system-input',
                        note: 'Emphasize publishable headline quality and distinct title phrasing.',
                    });
                }
                if (issues.some(issue => issue.toLowerCase().includes('status'))) {
                    nodeConfigSkillImprovements.push(
                        'Review buffer/view node settings so execution remains observable and deterministic during retries.',
                    );
                    nodeConfigStrategyDirectives.push({
                        strategyId: 'buffer-timing',
                        note: 'Keep execution timing explicit and deterministic during retries.',
                    });
                    nodeConfigStrategyDirectives.push({
                        strategyId: 'view-observer',
                        note: 'Keep output observation visible while retrying failed runs.',
                    });
                }

                return {
                    satisfied: issues.length === 0,
                    summary:
                        issues.length === 0
                            ? 'The sample flow output appears to satisfy the request.'
                            : 'The sample flow output needs another design pass.',
                    issues,
                    improvementNotes: suggestedImprovements,
                    nodeConfigSkillImprovements,
                    nodeConfigStrategyDirectives,
                };
            },
        }),
    ];
}

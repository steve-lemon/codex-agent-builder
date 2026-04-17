// Shared flow-design core used by skill wrappers, tools, and mock/example agents.
import { AgentError } from '../../errors/agent-error';
import { BuiltinFlowBlockIds } from '../block-pool';
import { FlowDesignSession, type FlowDesignConnection } from '../design-monitor';
import {
    connectFlowPorts,
    createFlowDocument,
    createFlowNode,
    createFlowPacket,
    getFlowPortById,
    setFlowPortPacket,
    validateFlowNode,
} from '../document';
import { planFlowGraph } from '../graph';
import { DefaultExecutableFlowNodeFactory, type FlowAiGenerateRequest } from '../runtime';
import type { FlowBlockDefinition, FlowDocument } from '../types';
import { GraphExecutionEngine } from '../../graph/executor';
import { getCatalogAvailableFlowBlocks } from './catalog';
import { defaultMockFlowDesignGenerate } from './mocks';
import {
    getFlowDesignDefaultModel,
    getFlowDesignSampleInputDefaults,
    getFlowDesignSystemPromptDefault,
} from './resources';
import type {
    FlowDesignAiGenerateRequest,
    FlowDesignDraftResult,
    FlowDesignExecution,
    FlowDesignIntent,
    FlowDesignReflection,
    FlowDesignTaskType,
    FlowDesignValidation,
} from './types';
import type { FlowFeasibilityAssessment } from './analysis';
import { assessFlowFeasibility } from './analysis';
import { getFlowDesignManifest } from './manifest';
import {
    defaultFlowDesignTaskTypeAdvisor,
    getFlowDesignTaskTypeCatalog,
    type FlowDesignTaskTypeAdvisor,
    type FlowDesignTaskTypeDefinition,
} from './task-types';

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

/** Parses repeated-output intent from a natural-language request. */
export function parseDesiredCount(userRequest: string): number {
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
        lowered.includes('several') ||
        lowered.includes('multiple') ||
        lowered.includes('many') ||
        lowered.includes('ideas') ||
        lowered.includes('titles')
    ) {
        return 5;
    }

    return 1;
}

/** Infers a coarse task type for flow-design decisions. */
export async function inferFlowDesignTaskType(args: {
    userRequest: string;
    wantsJson: boolean;
    taskTypeAdvisor?: FlowDesignTaskTypeAdvisor;
    taskTypes?: FlowDesignTaskTypeDefinition[];
}): Promise<{
    taskType: FlowDesignTaskType;
    confidence: number;
    rationale: string;
    source: 'deterministic' | 'model';
}> {
    const taskTypes = args.taskTypes ?? (await getFlowDesignTaskTypeCatalog());
    return await (args.taskTypeAdvisor ?? defaultFlowDesignTaskTypeAdvisor).recommend({
        userRequest: args.userRequest,
        wantsJson: args.wantsJson,
        taskTypes,
    });
}

/** Builds the deterministic sample input used to probe a designed flow. */
export async function buildFlowDesignSampleInput(taskType: FlowDesignTaskType, userRequest: string): Promise<string> {
    return await getFlowDesignSampleInputDefaults(taskType, userRequest);
}

/** Produces a normalized intent object from a raw user request. */
export async function analyzeFlowRequest(
    userRequest: string,
    options: {
        taskTypeAdvisor?: FlowDesignTaskTypeAdvisor;
        taskTypes?: FlowDesignTaskTypeDefinition[];
    } = {},
): Promise<FlowDesignIntent> {
    const lowered = userRequest.toLowerCase();
    const wantsJson =
        lowered.includes('json') ||
        lowered.includes('structured') ||
        lowered.includes('객체') ||
        lowered.includes('구조화');
    const desiredCount = parseDesiredCount(userRequest);
    const taskTypeRecommendation = await inferFlowDesignTaskType({
        userRequest,
        wantsJson,
        taskTypeAdvisor: options.taskTypeAdvisor,
        taskTypes: options.taskTypes,
    });

    return {
        userRequest,
        taskType: taskTypeRecommendation.taskType,
        taskTypeConfidence: taskTypeRecommendation.confidence,
        taskTypeRationale: taskTypeRecommendation.rationale,
        taskTypeSource: taskTypeRecommendation.source,
        wantsJson,
        wantsMultiple: desiredCount > 1,
        desiredCount,
        sampleInput: await buildFlowDesignSampleInput(taskTypeRecommendation.taskType, userRequest),
    };
}

/** Builds the system prompt used by the default AI generation node. */
export async function buildFlowDesignSystemPrompt(userRequest: string, improvementNotes: string[]): Promise<string> {
    const lowered = userRequest.toLowerCase();
    const taskTypeRecommendation = await inferFlowDesignTaskType({
        userRequest,
        wantsJson: lowered.includes('json'),
    });
    const basePrompt = await getFlowDesignSystemPromptDefault(taskTypeRecommendation.taskType);

    return improvementNotes.length > 0
        ? `${basePrompt} Improvements to apply: ${improvementNotes.join(' | ')}`
        : basePrompt;
}

/** Builds the user prompt used by the default AI generation node. */
export function buildFlowDesignUserPrompt(args: {
    userRequest: string;
    sampleInput: string;
    desiredCount: number;
    wantsJson: boolean;
    improvementNotes: string[];
}): string {
    const desiredCountInstruction =
        args.desiredCount > 1 ? `Return exactly ${args.desiredCount} results.` : 'Return one result.';
    const formatInstruction = args.wantsJson
        ? 'Return JSON only.'
        : args.desiredCount > 1
        ? 'Return each result on its own line.'
        : 'Return plain text.';
    const improvementText =
        args.improvementNotes.length > 0 ? ` Improvement notes: ${args.improvementNotes.join(' | ')}` : '';

    return `User request: ${args.userRequest}. Sample input: ${args.sampleInput}. ${desiredCountInstruction} ${formatInstruction}${improvementText}`;
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

/** Ensures a flow-design pass has access to the required built-in blocks. */
export function ensureRequiredFlowBlocks(availableBlocks: FlowBlockDefinition[], requiredBlockIds: string[]): void {
    for (const blockId of requiredBlockIds) {
        if (!availableBlocks.some(block => block.id === blockId)) {
            throw new AgentError(`Required flow block is not available for design: ${blockId}`);
        }
    }
}

/** Creates the shared default flow draft used by flow-designer style wrappers. */
export async function designFlowDraft(args: {
    userRequest: string;
    sampleInput: string;
    desiredCount: number;
    wantsJson: boolean;
    improvementNotes?: string[];
    guidanceNotes?: string[];
    preflight?: FlowFeasibilityAssessment;
    availableBlocks?: FlowBlockDefinition[];
    designSession?: FlowDesignSession;
    designConnection?: FlowDesignConnection;
    designSessionId?: string;
    toolName?: string;
}): Promise<FlowDesignDraftResult> {
    const availableBlocks = args.availableBlocks ?? (await getCatalogAvailableFlowBlocks());
    const improvementNotes = [...(args.guidanceNotes ?? []), ...(args.improvementNotes ?? [])];
    ensureRequiredFlowBlocks(availableBlocks, [
        BuiltinFlowBlockIds.input,
        BuiltinFlowBlockIds.aiGenerate,
        BuiltinFlowBlockIds.view,
    ]);

    const feasibility = args.preflight ?? (await assessFlowFeasibility(args.userRequest));
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

    const monitor = args.designSession
        ? args.designSession
        : args.designConnection
        ? new FlowDesignSession(
              args.designSessionId ?? `flow-design:${Date.now()}`,
              availableBlocks,
              args.designConnection,
          )
        : undefined;

    monitor?.start({
        toolName: args.toolName ?? 'designFlowDraft',
        userRequest: args.userRequest,
    });
    monitor?.stageNode('system-input', {
        label: 'System Input',
        blockId: BuiltinFlowBlockIds.input,
        state: 'building-system-prompt',
    });
    monitor?.createNode(BuiltinFlowBlockIds.input, {
        nodeId: 'system-input',
        label: 'System Input',
        config: {
            input: await buildFlowDesignSystemPrompt(args.userRequest, improvementNotes),
        },
    });
    monitor?.setNodePhase('system-input', 'ready', 'system-prompt-ready');

    monitor?.stageNode('prompt-input', {
        label: mapping.promptInput?.label ?? 'Prompt Input',
        blockId: BuiltinFlowBlockIds.input,
        state: 'building-user-prompt',
    });
    monitor?.createNode(BuiltinFlowBlockIds.input, {
        nodeId: 'prompt-input',
        label: mapping.promptInput?.label ?? 'Prompt Input',
        config: {
            input: buildFlowDesignUserPrompt({
                userRequest: args.userRequest,
                sampleInput: args.sampleInput,
                desiredCount: args.desiredCount,
                wantsJson: args.wantsJson,
                improvementNotes,
            }),
        },
    });
    monitor?.setNodePhase('prompt-input', 'ready', 'user-prompt-ready');

    monitor?.stageNode('ai-node', {
        label: mapping.generate?.label ?? 'AI Generate',
        blockId: BuiltinFlowBlockIds.aiGenerate,
        state: 'configuring-generation',
    });
    monitor?.createNode(BuiltinFlowBlockIds.aiGenerate, {
        nodeId: 'ai-node',
        label: mapping.generate?.label ?? 'AI Generate',
        config: {
            model: await getFlowDesignDefaultModel(),
            jsonOutput: String(args.wantsJson),
        },
    });
    monitor?.setNodePhase('ai-node', 'created', 'awaiting-connections');

    monitor?.stageNode('view-output', {
        label: mapping.review?.label ?? 'View Output',
        blockId: BuiltinFlowBlockIds.view,
        state: 'creating-output-review',
    });
    monitor?.createNode(BuiltinFlowBlockIds.view, {
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
            toolName: args.toolName ?? 'designFlowDraft',
            status: 'completed',
        });
        flow = monitor.getFlow();
    } else {
        flow = createFlowNode(flow, BuiltinFlowBlockIds.input, {
            nodeId: 'system-input',
            label: 'System Input',
            config: {
                input: await buildFlowDesignSystemPrompt(args.userRequest, improvementNotes),
            },
        }).flow;
        flow = createFlowNode(flow, BuiltinFlowBlockIds.input, {
            nodeId: 'prompt-input',
            label: mapping.promptInput?.label ?? 'Prompt Input',
            config: {
                input: buildFlowDesignUserPrompt({
                    userRequest: args.userRequest,
                    sampleInput: args.sampleInput,
                    desiredCount: args.desiredCount,
                    wantsJson: args.wantsJson,
                    improvementNotes,
                }),
            },
        }).flow;
        flow = createFlowNode(flow, BuiltinFlowBlockIds.aiGenerate, {
            nodeId: 'ai-node',
            label: mapping.generate?.label ?? 'AI Generate',
            config: {
                model: await getFlowDesignDefaultModel(),
                jsonOutput: String(args.wantsJson),
            },
        }).flow;
        flow = createFlowNode(flow, BuiltinFlowBlockIds.view, {
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
            `Map inferred task node '${mapping.promptInput?.id ?? 'capture-request'}' to the prompt input node.`,
            `Map inferred task node '${mapping.generate?.id ?? 'generate-output'}' to the AI generation node.`,
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
}

/** Validates a flow draft and confirms it can be planned for graph execution. */
export function validateDesignedFlow(flow: FlowDocument): FlowDesignValidation {
    const issues: string[] = [];
    for (const node of flow.nodes) {
        const result = validateFlowNode(flow, node.id);
        issues.push(...result.issues.map(issue => issue.message));
    }

    let plan: FlowDesignValidation['plan'];
    try {
        plan = planFlowGraph(flow).plan;
    } catch (error) {
        issues.push(AgentError.from(error).message);
    }

    return {
        isValid: issues.length === 0,
        issues,
        plan,
    };
}

/** Extracts repeated textual items from structured or plain sample outputs. */
export function extractFlowOutputItems(output: unknown): string[] {
    if (Array.isArray(output)) {
        return output
            .map(item => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
            .filter(item => item.length > 0);
    }

    if (typeof output === 'string') {
        return output
            .split('\n')
            .map(line => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
            .filter(line => line.length > 0);
    }

    if (output && typeof output === 'object') {
        const items = (output as { items?: unknown }).items;
        if (Array.isArray(items)) {
            return extractFlowOutputItems(items);
        }
    }

    return [];
}

/** Reflects on a sample execution against the original request intent. */
export async function reflectFlowExecution(args: {
    userRequest: string;
    desiredCount: number;
    wantsJson: boolean;
    reflectionNotes?: string[];
    sampleResult: {
        status: FlowDesignExecution['status'];
        output?: unknown;
        logs: string[];
    };
}): Promise<FlowDesignReflection> {
    const issues: string[] = [];
    const suggestedImprovements: string[] = [];
    const triggeredRuleIds: string[] = [];
    const items = extractFlowOutputItems(args.sampleResult.output);

    if (args.sampleResult.status !== 'completed') {
        issues.push(`Sample execution ended with status ${args.sampleResult.status}.`);
        suggestedImprovements.push('Stabilize the flow execution path before retrying.');
    }

    if (args.wantsJson) {
        const isJsonShape = args.sampleResult.output !== null && typeof args.sampleResult.output === 'object';
        if (!isJsonShape) {
            issues.push('The output was not JSON-shaped even though JSON output was requested.');
            suggestedImprovements.push('Force the AI block to return JSON only.');
        }
    }

    if (args.desiredCount > 1 && items.length < args.desiredCount) {
        issues.push(`The output only produced ${items.length} item(s) but ${args.desiredCount} were requested.`);
        suggestedImprovements.push(`Ask for exactly ${args.desiredCount} distinct results.`);
    }

    const manifest = await getFlowDesignManifest();
    const taskTypeRecommendation = await inferFlowDesignTaskType({
        userRequest: args.userRequest,
        wantsJson: args.wantsJson,
        taskTypes: manifest.taskTypes,
    });
    for (const rule of manifest.knowledge.reflectionRules) {
        const taskTypeMatches = !rule.match.taskTypes || rule.match.taskTypes.includes(taskTypeRecommendation.taskType);
        const maxItemLengthMatches =
            rule.match.maxItemLength === undefined ||
            (items.length > 0 &&
                items.every(item => item.length <= (rule.match.maxItemLength ?? Number.MAX_SAFE_INTEGER)));
        if (!taskTypeMatches || !maxItemLengthMatches) {
            continue;
        }
        issues.push(rule.issue);
        suggestedImprovements.push(rule.suggestedImprovement);
        triggeredRuleIds.push(rule.id);
    }

    for (const note of args.reflectionNotes ?? []) {
        if (!suggestedImprovements.includes(note)) {
            suggestedImprovements.push(note);
        }
    }

    return {
        satisfied: issues.length === 0,
        summary:
            issues.length === 0
                ? 'The sample flow output appears to satisfy the request.'
                : 'The sample flow output needs another design pass.',
        issues,
        suggestedImprovements,
        triggeredRuleIds,
    };
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

function inferBlockSpecMismatches(
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

/** Probes one executable block with deterministic inputs to observe runtime behavior. */
export async function probeFlowBlockRuntime(args: {
    blockId: string;
    sampleConfig?: Record<string, string>;
    sampleInputs?: Record<string, unknown>;
    availableBlocks?: FlowBlockDefinition[];
}): Promise<{
    blockId: string;
    observedOutputs: Record<string, unknown>;
    observedLogs: string[];
    behaviorNotes: string[];
    mismatchesFromSpec: string[];
}> {
    const availableBlocks = args.availableBlocks ?? (await getCatalogAvailableFlowBlocks());
    const block = availableBlocks.find(candidate => candidate.id === args.blockId);
    if (!block) {
        throw new AgentError(`Flow block not found: ${args.blockId}`);
    }
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
        mismatchesFromSpec: inferBlockSpecMismatches(block.id, observedOutputs, observedLogs, block.description),
    };
}

/** Creates a documentation patch proposal from probe findings. */
export async function proposeBlockSpecUpdate(args: {
    blockId: string;
    probeResult: {
        behaviorNotes: string[];
        mismatchesFromSpec: string[];
    };
    availableBlocks?: FlowBlockDefinition[];
}) {
    const availableBlocks = args.availableBlocks ?? (await getCatalogAvailableFlowBlocks());
    const block = availableBlocks.find(candidate => candidate.id === args.blockId);
    if (!block) {
        throw new AgentError(`Flow block not found: ${args.blockId}`);
    }

    if (args.probeResult.mismatchesFromSpec.length === 0) {
        return {
            blockId: args.blockId,
            missingDetails: [],
            suggestedDocPatch: `No documentation update appears necessary for ${block.label}.`,
        };
    }

    return {
        blockId: args.blockId,
        missingDetails: [...args.probeResult.mismatchesFromSpec],
        suggestedDocPatch: [
            `Update ${block.id} block documentation to clarify:`,
            ...args.probeResult.mismatchesFromSpec.map(detail => `- ${detail}`),
            ...args.probeResult.behaviorNotes.map(note => `- Observed behavior: ${note}`),
        ].join('\n'),
    };
}

/** Executes a designed flow through the shared graph executor using deterministic runtime services. */
export async function executeFlowDesignSample(args: {
    flow: FlowDocument;
    userRequest: string;
    iteration?: number;
    improvementNotes?: string[];
    aiGenerate?: (request: FlowDesignAiGenerateRequest) => Promise<unknown>;
}): Promise<FlowDesignExecution> {
    const logs: string[] = [];
    let currentFlow = args.flow;
    const improvementNotes = args.improvementNotes ?? [];
    const iteration = args.iteration ?? 1;
    const aiGenerate =
        args.aiGenerate ??
        (async (request: FlowDesignAiGenerateRequest) => {
            return await defaultMockFlowDesignGenerate(request);
        });

    const factory = new DefaultExecutableFlowNodeFactory({
        logger: message => {
            logs.push(message);
        },
        aiGenerate: async (request: FlowAiGenerateRequest) => {
            return await aiGenerate({
                ...request,
                iteration,
                userRequest: args.userRequest,
                improvementNotes: [...improvementNotes],
            });
        },
    });
    const planned = planFlowGraph(args.flow);
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
        flow: currentFlow,
        output: getFlowPortById(currentFlow, 'ai-node:output')?.packet?.value,
        logs,
        graphRun,
    };
}

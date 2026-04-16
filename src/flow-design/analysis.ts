// Shared flow-analysis helpers used by flow design core and skill/tool wrappers.
import type { DirectedGraph } from '../graph/types';
import { availableFlowBlocks, availableFlowCapabilities, flowBlockCapabilityMap } from './catalog';

/** Per-task-node analysis used by feasibility and preflight validation. */
export interface TaskNodeAnalysis {
    nodeId: string;
    operation: string;
    expectedInputs: string[];
    expectedOutputs: string[];
    requiredCapabilities: string[];
    matchedBlockIds: string[];
    feasible: boolean;
    reasons: string[];
}

/** Draft proposal for one missing block implied by the inferred task graph. */
export interface ProposedBlockDraft {
    blockId: string;
    purpose: string;
    requiredCapabilities: string[];
    suggestedInputs: Array<{ localId: string; dataType: string; description: string }>;
    suggestedOutputs: Array<{ localId: string; dataType: string; description: string }>;
    suggestedConfigs: Array<{ id: string; hint: string; required: boolean; description: string }>;
}

/** Full graph-based feasibility assessment for a user request. */
export interface FlowFeasibilityAssessment {
    feasible: boolean;
    taskGraph: DirectedGraph;
    nodeAnalyses: TaskNodeAnalysis[];
    requiredCapabilities: string[];
    availableCapabilities: string[];
    missingCapabilities: string[];
    proposedBlocks: ProposedBlockDraft[];
    reason: string;
    recommendedAction: string;
}

/** Reflection signal used to refine an inferred task graph between design passes. */
export interface TaskGraphRefinementInput {
    issues: string[];
    improvementNotes: string[];
}

/** Parses a user request into required capabilities at a coarse level. */
export function inferRequiredCapabilities(userRequest: string): string[] {
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

/** Builds an inferred task graph from the user's natural-language request. */
export function inferTaskGraph(userRequest: string): DirectedGraph {
    // TODO(flow-agent): Replace these deterministic heuristics with a block-aware
    // task decomposition model once we have enough grounded examples to infer
    // richer operations without overfitting to a few prompts.
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

/** Refines an inferred task graph using reflection output from an earlier design pass. */
export function refineTaskGraph(graph: DirectedGraph, reflection: TaskGraphRefinementInput): DirectedGraph {
    // TODO(flow-agent): Track refinement provenance per node so later passes can
    // explain which reflection note changed which task-graph expectation.
    const exactCountMatch = reflection.improvementNotes.join(' ').match(/exactly\s+(\d+)/i);
    const expectedCountHint = exactCountMatch ? `exactly ${exactCountMatch[1]} items` : undefined;
    const wantsJson = reflection.improvementNotes.some(note => note.toLowerCase().includes('json only'));
    const wantsBlogQuality = reflection.improvementNotes.some(note =>
        note.toLowerCase().includes('publishable blog title'),
    );
    const wantsStability = reflection.improvementNotes.some(note => note.toLowerCase().includes('stabilize'));

    return {
        nodes: graph.nodes.map(node => {
            const data = { ...(node.data ?? {}) };
            const requiredCapabilities = new Set(((data.requiredCapabilities as string[] | undefined) ?? []).slice());
            const expectedOutputs = new Set(((data.expectedOutputs as string[] | undefined) ?? []).slice());
            const qualityHints = new Set(((data.qualityHints as string[] | undefined) ?? []).slice());

            if (String(data.operation ?? '').startsWith('generate')) {
                if (expectedCountHint) {
                    expectedOutputs.add(expectedCountHint);
                }
                if (wantsJson) {
                    requiredCapabilities.add('structured-output');
                    expectedOutputs.add('json object output');
                    qualityHints.add('Return machine-parseable JSON only.');
                }
                if (wantsBlogQuality) {
                    expectedOutputs.add('publishable blog titles');
                    qualityHints.add('Prefer polished, publication-ready title wording.');
                }
            }

            if (String(data.operation ?? '').startsWith('log') && wantsStability) {
                qualityHints.add('Highlight runtime failures and unstable output shapes during review.');
            }

            return {
                ...node,
                data: {
                    ...data,
                    requiredCapabilities: [...requiredCapabilities],
                    expectedOutputs: [...expectedOutputs],
                    qualityHints: [...qualityHints],
                },
            };
        }),
        edges: graph.edges.map(edge => ({ ...edge })),
    };
}

/** Matches inferred task-graph nodes to the currently available blocks. */
export function analyzeTaskGraph(graph: DirectedGraph): TaskNodeAnalysis[] {
    return graph.nodes.map(node => {
        const requiredCapabilities = ((node.data?.requiredCapabilities as string[] | undefined) ?? []).slice();
        const matchedBlockIds = availableFlowBlocks
            .filter(block => {
                const blockCapabilities = flowBlockCapabilityMap[block.id] ?? [];
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

/** Produces draft block specs for task-graph nodes that have no current block match. */
export function buildProposedBlocks(nodeAnalyses: TaskNodeAnalysis[]): ProposedBlockDraft[] {
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

/** Performs a full graph-based feasibility pass over the user request. */
export function assessFlowFeasibility(userRequest: string): FlowFeasibilityAssessment {
    return assessTaskGraphFeasibility(userRequest, inferTaskGraph(userRequest));
}

/** Performs a feasibility pass against a caller-provided task graph. */
export function assessTaskGraphFeasibility(userRequest: string, taskGraph: DirectedGraph): FlowFeasibilityAssessment {
    // TODO(flow-agent): Introduce a first-class capability taxonomy instead of
    // string matching so block proposals and feasibility checks share one model.
    const nodeAnalyses = analyzeTaskGraph(taskGraph);
    const requiredCapabilities = inferRequiredCapabilities(userRequest);
    const missingCapabilities = requiredCapabilities.filter(
        capability => !availableFlowCapabilities.includes(capability),
    );
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
        availableCapabilities: availableFlowCapabilities,
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

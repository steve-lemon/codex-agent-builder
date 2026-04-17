// Shared flow-analysis helpers used by flow design core and skill/tool wrappers.
import type { DirectedGraph } from '../graph/types';
import { availableFlowBlocks, availableFlowCapabilities, flowBlockCapabilityMap } from './catalog';
import { getFlowDesignManifest } from './manifest';
import {
    defaultFlowDesignTaskGraphAdvisor,
    getFlowDesignTaskGraphCatalog,
    type FlowDesignTaskGraphAdvisor,
    type FlowDesignTaskGraphTemplate,
} from './task-graphs';

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
    triggeredRuleIds?: string[];
}

/** Derives graph-level required capabilities from the inferred task graph itself. */
export function deriveRequiredCapabilitiesFromTaskGraph(taskGraph: DirectedGraph): string[] {
    const required = new Set<string>();

    for (const node of taskGraph.nodes) {
        for (const capability of (node.data?.requiredCapabilities as string[] | undefined) ?? []) {
            required.add(capability);
        }
    }

    return [...required];
}

/** Builds an inferred task graph from the user's natural-language request. */
export async function inferTaskGraph(
    userRequest: string,
    options: {
        taskGraphAdvisor?: FlowDesignTaskGraphAdvisor;
        taskGraphTemplates?: FlowDesignTaskGraphTemplate[];
    } = {},
): Promise<DirectedGraph> {
    const templates = options.taskGraphTemplates ?? (await getFlowDesignTaskGraphCatalog());
    const recommendation = await (options.taskGraphAdvisor ?? defaultFlowDesignTaskGraphAdvisor).recommend({
        userRequest,
        templates,
    });

    return recommendation.graph;
}

/** Refines an inferred task graph using reflection output from an earlier design pass. */
export async function refineTaskGraph(graph: DirectedGraph, reflection: TaskGraphRefinementInput): Promise<DirectedGraph> {
    // TODO(flow-agent): Track refinement provenance per node so later passes can
    // explain which reflection note changed which task-graph expectation.
    const exactCountMatch = reflection.improvementNotes.join(' ').match(/exactly\s+(\d+)/i);
    const expectedCountHint = exactCountMatch ? `exactly ${exactCountMatch[1]} items` : undefined;
    const wantsJson = reflection.improvementNotes.some(note => note.toLowerCase().includes('json only'));
    const wantsStability = reflection.improvementNotes.some(note => note.toLowerCase().includes('stabilize'));
    const manifest = await getFlowDesignManifest();
    const triggeredRules = manifest.knowledge.reflectionRules.filter(rule =>
        (reflection.triggeredRuleIds ?? []).includes(rule.id),
    );

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
            }

            if (String(data.operation ?? '').startsWith('log') && wantsStability) {
                qualityHints.add('Highlight runtime failures and unstable output shapes during review.');
            }

            for (const rule of triggeredRules) {
                const refinement = rule.taskGraphRefinement;
                if (!refinement) {
                    continue;
                }
                const prefixes = refinement.targetOperationPrefixes ?? ['generate'];
                const operation = String(data.operation ?? '');
                if (!prefixes.some(prefix => operation.startsWith(prefix))) {
                    continue;
                }
                for (const expectedOutput of refinement.expectedOutputs ?? []) {
                    expectedOutputs.add(expectedOutput);
                }
                for (const capability of refinement.requiredCapabilities ?? []) {
                    requiredCapabilities.add(capability);
                }
                for (const hint of refinement.qualityHints ?? []) {
                    qualityHints.add(hint);
                }
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
export async function assessFlowFeasibility(userRequest: string): Promise<FlowFeasibilityAssessment> {
    return assessTaskGraphFeasibility(userRequest, await inferTaskGraph(userRequest));
}

/** Performs a feasibility pass against a caller-provided task graph. */
export function assessTaskGraphFeasibility(_userRequest: string, taskGraph: DirectedGraph): FlowFeasibilityAssessment {
    // TODO(flow-agent): Introduce a first-class capability taxonomy instead of
    // string matching so block proposals and feasibility checks share one model.
    const nodeAnalyses = analyzeTaskGraph(taskGraph);
    const requiredCapabilities = deriveRequiredCapabilitiesFromTaskGraph(taskGraph);
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

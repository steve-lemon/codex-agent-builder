// Internal task-graph catalog and recommendation helpers for flow-design preflight analysis.
import { logDebug, logWarn } from '../../diagnostics/logger';
import type { DirectedGraph } from '../../graph/types';
import type { LlmGateway } from '../../llm/types';
import { defineStructuredSchema } from '../../llm/structured-schema';
import { runLiteAdvisor } from '../../advisors/lite';
import { getLiteAdvisorDefinition } from '../../advisors/resources';
import { getFlowDesignManifest } from './manifest';
import type { FlowDesignTaskGraphTemplateRecord } from './manifest-schemas';
import { z } from 'zod';

export type FlowDesignTaskGraphTemplate = FlowDesignTaskGraphTemplateRecord;

/** Structured recommendation produced by a task-graph advisor. */
export interface FlowDesignTaskGraphRecommendation {
    templateId: string;
    graph: DirectedGraph;
    confidence: number;
    rationale?: string;
    source: 'deterministic' | 'model';
}

/** Contract for task-graph recommendation. */
export interface FlowDesignTaskGraphAdvisor {
    recommend(args: {
        userRequest: string;
        templates: FlowDesignTaskGraphTemplate[];
        taskType?: string;
        operationModel?: string[];
    }): Promise<FlowDesignTaskGraphRecommendation>;
}

function createFlowDesignTaskGraphClassificationSchema(includeRationale: boolean) {
    return z.object({
        templateId: z.string(),
        confidence: z.number().min(0).max(1),
        ...(includeRationale ? { rationale: z.string() } : {}),
    });
}

/** Returns the configured task-graph template catalog used by flow-design analysis. */
export async function getFlowDesignTaskGraphCatalog(): Promise<FlowDesignTaskGraphTemplate[]> {
    return (await getFlowDesignManifest()).taskGraphTemplates;
}

function normalize(text: string): string {
    return text.toLowerCase();
}

function normalizeOperationModel(operationModel?: string[]): string[] {
    return (operationModel ?? []).map(item => normalize(item));
}

function hasExplicitEmailIntegrationIntent(userRequest: string): boolean {
    const lowered = normalize(userRequest);
    return (
        /(답장|회신|reply|respond|send)/.test(lowered) ||
        /(읽어|읽고|확인|받은|최신|latest|inbox|mailbox|thread)/.test(lowered)
    );
}

function scoreTemplate(args: {
    userRequest: string;
    template: FlowDesignTaskGraphTemplate;
    taskType?: string;
    operationModel?: string[];
}): number {
    const lowered = normalize(args.userRequest);
    let score = 0;

    for (const signal of args.template.signals) {
        if (lowered.includes(normalize(signal))) {
            score += 2;
        }
    }

    for (const example of args.template.examples) {
        const sharedTokens = normalize(example)
            .split(/\s+/)
            .filter(token => token.length > 1 && lowered.includes(token));
        score += Math.min(sharedTokens.length, 3);
    }

    if (args.taskType && args.template.taskTypes?.includes(args.taskType)) {
        score += 6;
    }

    const operationModel = normalizeOperationModel(args.operationModel);
    if (operationModel.length > 0) {
        const overlapCount = operationModel.filter(operation =>
            (args.template.operationModels ?? []).some(item => normalize(item) === operation),
        ).length;
        score += overlapCount * 3;

        // Keep the generic fallback available, but make it meaningfully less eager
        // when the request already points to a more specific operation model.
        if (
            args.template.id === 'generic-generation' &&
            operationModel.some(operation => operation !== 'generate' && operation !== 'transform')
        ) {
            score -= 4;
        }
    }

    if (args.template.id === 'generic-generation' && args.taskType && args.taskType !== 'text-generation') {
        score -= 3;
    }

    if (args.template.id === 'email-reply' && !hasExplicitEmailIntegrationIntent(args.userRequest)) {
        score -= 8;
    }

    return score;
}

function rankTemplates(args: {
    userRequest: string;
    templates: FlowDesignTaskGraphTemplate[];
    taskType?: string;
    operationModel?: string[];
}) {
    return args.templates
        .map(template => ({
            template,
            score: scoreTemplate({
                userRequest: args.userRequest,
                template,
                taskType: args.taskType,
                operationModel: args.operationModel,
            }),
        }))
        .sort((left, right) => right.score - left.score);
}

/** Default advisor that scores graph templates against the internal graph catalog. */
export class DeterministicFlowDesignTaskGraphAdvisor implements FlowDesignTaskGraphAdvisor {
    async recommend(args: {
        userRequest: string;
        templates: FlowDesignTaskGraphTemplate[];
        taskType?: string;
        operationModel?: string[];
    }): Promise<FlowDesignTaskGraphRecommendation> {
        const ranked = rankTemplates(args);

        const best = ranked[0];
        if (!best || best.score <= 0) {
            const fallbackTemplate =
                args.templates.find(template => template.id === 'generic-generation') ?? args.templates[0];
            const recommendation: FlowDesignTaskGraphRecommendation = {
                templateId: fallbackTemplate?.id ?? 'generic-generation',
                graph: fallbackTemplate?.graph ?? { nodes: [], edges: [] },
                confidence: 0.4,
                rationale:
                    'No strong task-graph template match was found, so the generic generation workflow was used.',
                source: 'deterministic',
            };
            logWarn({
                scope: 'flow-design',
                action: 'task_graph_fallback',
                message: 'No strong task-graph template match was found. Using fallback template.',
                data: {
                    selectedTemplateId: recommendation.templateId,
                },
            });
            return recommendation;
        }

        const recommendation: FlowDesignTaskGraphRecommendation = {
            templateId: best.template.id,
            graph: best.template.graph,
            confidence: Math.min(0.95, 0.5 + best.score / 10),
            rationale: `Matched the request against the internal flow-design task-graph catalog and selected '${best.template.label}'.`,
            source: 'deterministic',
        };
        logDebug({
            scope: 'flow-design',
            action: 'task_graph_selected',
            message: 'Selected task graph template.',
            data: {
                selectedTemplateId: recommendation.templateId,
                confidence: recommendation.confidence,
                source: recommendation.source,
            },
        });
        return recommendation;
    }
}

export class LlmBackedFlowDesignTaskGraphAdvisor implements FlowDesignTaskGraphAdvisor {
    constructor(
        private readonly gateway: LlmGateway,
        private readonly fallback: FlowDesignTaskGraphAdvisor = new DeterministicFlowDesignTaskGraphAdvisor(),
        private readonly options: {
            emitLogs?: boolean;
            onDecision?: (event: {
                type: 'model' | 'fallback-no-gateway' | 'fallback-threshold' | 'fallback-error';
                error?: unknown;
                durationMs?: number;
            }) => void;
        } = {},
    ) {}

    async recommend(args: {
        userRequest: string;
        templates: FlowDesignTaskGraphTemplate[];
        taskType?: string;
        operationModel?: string[];
    }): Promise<FlowDesignTaskGraphRecommendation> {
        const advisor = await getLiteAdvisorDefinition('flow-design.advisors', 'flow-design.task-graph');
        const includeRationale = advisor.includeRationale === true;
        const ranked = rankTemplates(args);
        const candidateLimit = advisor.candidateLimit ?? 3;
        const shortlisted = ranked.slice(0, Math.max(1, Math.min(candidateLimit, ranked.length)));
        return await runLiteAdvisor({
            advisorId: advisor.id,
            scope: 'flow-design',
            gateway: this.gateway,
            systemPrompt: advisor.systemPrompt,
            fallbackNote: advisor.fallbackNote,
            schema: defineStructuredSchema(
                'flow_design_task_graph_classification',
                createFlowDesignTaskGraphClassificationSchema(includeRationale),
            ),
            input: {
                userRequest: args.userRequest,
                taskType: args.taskType,
                operationModel: args.operationModel ?? [],
                templates: shortlisted.map(({ template, score }) => ({
                    id: template.id,
                    label: template.label,
                    scoreHint: score,
                    graphShape: {
                        nodes: template.graph.nodes.length,
                        edges: template.graph.edges.length,
                    },
                })),
            },
            emitLogs: this.options.emitLogs,
            onDecision: this.options.onDecision,
            shouldFallback: result =>
                typeof advisor.confidenceThreshold === 'number' &&
                typeof result.confidence === 'number' &&
                result.confidence < advisor.confidenceThreshold,
            mapResult: result => {
                const matchedTemplate = args.templates.find(template => template.id === result.templateId);
                if (!matchedTemplate) {
                    throw new Error(
                        `Model-backed task-graph result did not match the configured catalog: ${result.templateId}`,
                    );
                }
                return {
                    templateId: matchedTemplate.id,
                    graph: matchedTemplate.graph,
                    confidence: result.confidence ?? 0.7,
                    rationale: typeof result.rationale === 'string' ? result.rationale : undefined,
                    source: 'model',
                };
            },
            fallback: () => this.fallback.recommend(args),
        });
    }
}

export function createFlowDesignTaskGraphAdvisor(gateway?: LlmGateway): FlowDesignTaskGraphAdvisor {
    // TODO(flow-design): Move threshold tuning into a shared advisor profile so
    // task-type, task-graph, and delegation thresholds can be tuned together by resource.
    if (!gateway) {
        return defaultFlowDesignTaskGraphAdvisor;
    }
    return new LlmBackedFlowDesignTaskGraphAdvisor(gateway, defaultFlowDesignTaskGraphAdvisor);
}

/** Shared default task-graph advisor for flow-design preflight analysis. */
export const defaultFlowDesignTaskGraphAdvisor = new DeterministicFlowDesignTaskGraphAdvisor();

// Internal task-type catalog and recommendation helpers for flow-design intent analysis.
import { logDebug, logWarn } from '../diagnostics/logger';
import type { FlowDesignTaskType } from './types';
import { getFlowDesignManifest } from './manifest';
import type { FlowDesignTaskTypeDefinitionRecord } from './manifest-schemas';

export type FlowDesignTaskTypeDefinition = FlowDesignTaskTypeDefinitionRecord;

/** Structured recommendation produced by a task-type advisor. */
export interface FlowDesignTaskTypeRecommendation {
    taskType: FlowDesignTaskType;
    confidence: number;
    rationale: string;
    source: 'deterministic' | 'model';
}

/** Contract for flow-design task-type recommendation. */
export interface FlowDesignTaskTypeAdvisor {
    recommend(args: {
        userRequest: string;
        wantsJson: boolean;
        taskTypes: FlowDesignTaskTypeDefinition[];
    }): Promise<FlowDesignTaskTypeRecommendation>;
}

/** Optional model boundary for provider-backed task-type classification. */
export interface FlowDesignTaskTypeModel {
    classify(args: { userRequest: string; wantsJson: boolean; taskTypes: FlowDesignTaskTypeDefinition[] }): Promise<{
        taskType: string;
        confidence?: number;
        rationale?: string;
    }>;
}

/** Returns the configured task-type catalog used by flow-design analysis. */
export async function getFlowDesignTaskTypeCatalog(): Promise<FlowDesignTaskTypeDefinition[]> {
    return (await getFlowDesignManifest()).taskTypes;
}

function normalize(text: string): string {
    return text.toLowerCase();
}

function scoreTaskType(args: {
    userRequest: string;
    wantsJson: boolean;
    taskType: FlowDesignTaskTypeDefinition;
}): number {
    const lowered = normalize(args.userRequest);
    let score = 0;

    for (const signal of args.taskType.signals) {
        if (lowered.includes(normalize(signal))) {
            score += 2;
        }
    }

    for (const example of args.taskType.examples) {
        const loweredExample = normalize(example);
        const sharedTokens = loweredExample.split(/\s+/).filter(token => token.length > 1 && lowered.includes(token));
        score += Math.min(sharedTokens.length, 3);
    }

    if (args.wantsJson && args.taskType.hints?.preferredWhenJson) {
        score += 4;
    }

    if (!args.wantsJson && args.taskType.hints?.fallbackWhenPlainText) {
        score += 1;
    }

    return score;
}

/** Default advisor that scores task types against the internal task-type catalog. */
export class DeterministicFlowDesignTaskTypeAdvisor implements FlowDesignTaskTypeAdvisor {
    async recommend(args: {
        userRequest: string;
        wantsJson: boolean;
        taskTypes: FlowDesignTaskTypeDefinition[];
    }): Promise<FlowDesignTaskTypeRecommendation> {
        const manifest = await getFlowDesignManifest();
        const ranked = args.taskTypes
            .map(taskType => ({
                taskType,
                score: scoreTaskType({
                    userRequest: args.userRequest,
                    wantsJson: args.wantsJson,
                    taskType,
                }),
            }))
            .sort((left, right) => right.score - left.score);

        const best = ranked[0];
        if (!best || best.score <= 0) {
            const fallbackRecommendation: FlowDesignTaskTypeRecommendation = {
                taskType: args.wantsJson
                    ? manifest.defaults.taskTypeSelection.jsonPreferredTaskTypeId
                    : manifest.defaults.taskTypeSelection.plainTextFallbackTaskTypeId,
                confidence: args.wantsJson ? 0.6 : 0.4,
                rationale: args.wantsJson
                    ? 'No strong task-type match was found, so JSON intent became the fallback signal.'
                    : 'No strong task-type match was found, so plain text generation became the fallback.',
                source: 'deterministic',
            };
            logWarn({
                scope: 'flow-design',
                action: 'task_type_fallback',
                message: 'No strong task-type match was found. Falling back to configured default.',
                data: {
                    wantsJson: args.wantsJson,
                    selectedTaskType: fallbackRecommendation.taskType,
                },
            });
            return fallbackRecommendation;
        }

        const recommendation: FlowDesignTaskTypeRecommendation = {
            taskType: best.taskType.id,
            confidence: Math.min(0.95, 0.5 + best.score / 10),
            rationale: `Matched the request against the internal flow-design task catalog and selected '${best.taskType.label}'.`,
            source: 'deterministic',
        };
        logDebug({
            scope: 'flow-design',
            action: 'task_type_selected',
            message: 'Selected task type.',
            data: {
                selectedTaskType: recommendation.taskType,
                confidence: recommendation.confidence,
                source: recommendation.source,
            },
        });
        return recommendation;
    }
}

/** Advisor that consults a model first and falls back to the deterministic advisor when needed. */
export class ModelBackedFlowDesignTaskTypeAdvisor implements FlowDesignTaskTypeAdvisor {
    constructor(
        private readonly model: FlowDesignTaskTypeModel,
        private readonly fallback: FlowDesignTaskTypeAdvisor = new DeterministicFlowDesignTaskTypeAdvisor(),
    ) {}

    async recommend(args: {
        userRequest: string;
        wantsJson: boolean;
        taskTypes: FlowDesignTaskTypeDefinition[];
    }): Promise<FlowDesignTaskTypeRecommendation> {
        const result = await this.model.classify(args);
        const matchedTaskType = args.taskTypes.find(taskType => taskType.id === result.taskType);

        if (!matchedTaskType) {
            logWarn({
                scope: 'flow-design',
                action: 'task_type_model_miss',
                message: 'Model-backed task-type result did not match the configured catalog. Using fallback advisor.',
                data: {
                    requestedTaskType: result.taskType,
                },
            });
            return this.fallback.recommend(args);
        }

        const recommendation: FlowDesignTaskTypeRecommendation = {
            taskType: matchedTaskType.id,
            confidence: result.confidence ?? 0.7,
            rationale:
                result.rationale ??
                `Selected '${matchedTaskType.label}' using the configured model-backed task-type advisor.`,
            source: 'model',
        };
        logDebug({
            scope: 'flow-design',
            action: 'task_type_selected',
            message: 'Selected task type.',
            data: {
                selectedTaskType: recommendation.taskType,
                confidence: recommendation.confidence,
                source: recommendation.source,
            },
        });
        return recommendation;
    }
}

/** Shared default task-type advisor for flow-design intent analysis. */
export const defaultFlowDesignTaskTypeAdvisor = new DeterministicFlowDesignTaskTypeAdvisor();

// Internal task-graph catalog and recommendation helpers for flow-design preflight analysis.
import type { DirectedGraph } from '../graph/types';
import { getFlowDesignManifest } from './manifest';
import type { FlowDesignTaskGraphTemplateRecord } from './manifest-schemas';

export type FlowDesignTaskGraphTemplate = FlowDesignTaskGraphTemplateRecord;

/** Structured recommendation produced by a task-graph advisor. */
export interface FlowDesignTaskGraphRecommendation {
    templateId: string;
    graph: DirectedGraph;
    confidence: number;
    rationale: string;
    source: 'deterministic' | 'model';
}

/** Contract for task-graph recommendation. */
export interface FlowDesignTaskGraphAdvisor {
    recommend(args: {
        userRequest: string;
        templates: FlowDesignTaskGraphTemplate[];
    }): Promise<FlowDesignTaskGraphRecommendation>;
}

/** Optional model boundary for provider-backed task-graph classification. */
export interface FlowDesignTaskGraphModel {
    classify(args: { userRequest: string; templates: FlowDesignTaskGraphTemplate[] }): Promise<{
        templateId: string;
        confidence?: number;
        rationale?: string;
    }>;
}

/** Returns the configured task-graph template catalog used by flow-design analysis. */
export async function getFlowDesignTaskGraphCatalog(): Promise<FlowDesignTaskGraphTemplate[]> {
    return (await getFlowDesignManifest()).taskGraphTemplates;
}

function normalize(text: string): string {
    return text.toLowerCase();
}

function scoreTemplate(args: { userRequest: string; template: FlowDesignTaskGraphTemplate }): number {
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

    return score;
}

/** Default advisor that scores graph templates against the internal graph catalog. */
export class DeterministicFlowDesignTaskGraphAdvisor implements FlowDesignTaskGraphAdvisor {
    async recommend(args: {
        userRequest: string;
        templates: FlowDesignTaskGraphTemplate[];
    }): Promise<FlowDesignTaskGraphRecommendation> {
        const ranked = args.templates
            .map(template => ({
                template,
                score: scoreTemplate({
                    userRequest: args.userRequest,
                    template,
                }),
            }))
            .sort((left, right) => right.score - left.score);

        const best = ranked[0];
        if (!best || best.score <= 0) {
            const fallbackTemplate =
                args.templates.find(template => template.id === 'generic-generation') ?? args.templates[0];
            return {
                templateId: fallbackTemplate?.id ?? 'generic-generation',
                graph: fallbackTemplate?.graph ?? { nodes: [], edges: [] },
                confidence: 0.4,
                rationale:
                    'No strong task-graph template match was found, so the generic generation workflow was used.',
                source: 'deterministic',
            };
        }

        return {
            templateId: best.template.id,
            graph: best.template.graph,
            confidence: Math.min(0.95, 0.5 + best.score / 10),
            rationale: `Matched the request against the internal flow-design task-graph catalog and selected '${best.template.label}'.`,
            source: 'deterministic',
        };
    }
}

/** Advisor that consults a model first and falls back to the deterministic advisor when needed. */
export class ModelBackedFlowDesignTaskGraphAdvisor implements FlowDesignTaskGraphAdvisor {
    constructor(
        private readonly model: FlowDesignTaskGraphModel,
        private readonly fallback: FlowDesignTaskGraphAdvisor = new DeterministicFlowDesignTaskGraphAdvisor(),
    ) {}

    async recommend(args: {
        userRequest: string;
        templates: FlowDesignTaskGraphTemplate[];
    }): Promise<FlowDesignTaskGraphRecommendation> {
        const result = await this.model.classify(args);
        const matchedTemplate = args.templates.find(template => template.id === result.templateId);

        if (!matchedTemplate) {
            return this.fallback.recommend(args);
        }

        return {
            templateId: matchedTemplate.id,
            graph: matchedTemplate.graph,
            confidence: result.confidence ?? 0.7,
            rationale:
                result.rationale ??
                `Selected '${matchedTemplate.label}' using the configured model-backed task-graph advisor.`,
            source: 'model',
        };
    }
}

/** Shared default task-graph advisor for flow-design preflight analysis. */
export const defaultFlowDesignTaskGraphAdvisor = new DeterministicFlowDesignTaskGraphAdvisor();

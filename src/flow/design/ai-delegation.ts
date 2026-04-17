import { z } from 'zod';
import type { LlmGateway } from '../../llm/types';
import { defineStructuredSchema } from '../../llm/structured-schema';
import type { DirectedGraph } from '../../graph/types';
import { runLiteAdvisor } from '../../advisors/lite';
import { getLiteAdvisorDefinition } from '../../advisors/resources';

export interface FlowAiDelegationRecommendation {
    delegable: boolean;
    confidence?: number;
    rationale?: string;
    source: 'deterministic' | 'model';
}

export interface FlowAiDelegationAdvisor {
    recommend(args: {
        userRequest: string;
        operation: string;
        requiredCapabilities: string[];
        expectedInputs: string[];
        expectedOutputs: string[];
    }): Promise<FlowAiDelegationRecommendation>;
}

const FlowAiDelegationSchema = z.object({
    kind: z.literal('flow-ai-delegation'),
    delegable: z.boolean(),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
});

function isTaskNodeAiDelegableDeterministically(
    operation: string,
    requiredCapabilities: string[],
): FlowAiDelegationRecommendation {
    const normalizedOperation = operation.toLowerCase();
    const aiFriendlyPrefixes = [
        'generate',
        'analyze',
        'transform',
        'classify',
        'count',
        'extract',
        'summarize',
        'rewrite',
    ];
    if (!aiFriendlyPrefixes.some(prefix => normalizedOperation.startsWith(prefix))) {
        return {
            delegable: false,
            rationale: 'Operation does not look like text-centric AI processing.',
            source: 'deterministic',
        };
    }

    const blockedCapabilityPrefixes = ['email-', 'browser-', 'web-', 'http-', 'file-', 'image-', 'audio-', 'video-'];
    if (
        requiredCapabilities.some(capability => blockedCapabilityPrefixes.some(prefix => capability.startsWith(prefix)))
    ) {
        return {
            delegable: false,
            rationale: 'Required capabilities imply an external system dependency.',
            source: 'deterministic',
        };
    }

    return {
        delegable: requiredCapabilities.length > 0,
        rationale:
            requiredCapabilities.length > 0 ? 'Text-centric capability can be delegated to ai-generate.' : undefined,
        source: 'deterministic',
    };
}

export const defaultFlowAiDelegationAdvisor: FlowAiDelegationAdvisor = {
    async recommend(args) {
        return isTaskNodeAiDelegableDeterministically(args.operation, args.requiredCapabilities);
    },
};

export class LlmGatewayFlowAiDelegationAdvisor implements FlowAiDelegationAdvisor {
    constructor(private readonly gateway: LlmGateway) {}

    async recommend(args: {
        userRequest: string;
        operation: string;
        requiredCapabilities: string[];
        expectedInputs: string[];
        expectedOutputs: string[];
    }): Promise<FlowAiDelegationRecommendation> {
        const advisor = await getLiteAdvisorDefinition('flow-design.advisors', 'flow-design.ai-delegation');
        return await runLiteAdvisor({
            advisorId: advisor.id,
            scope: 'flow-design',
            gateway: this.gateway,
            systemPrompt: advisor.systemPrompt,
            fallbackNote: advisor.fallbackNote,
            schema: defineStructuredSchema('flow_ai_delegation_classification', FlowAiDelegationSchema),
            input: args,
            shouldFallback: result =>
                typeof advisor.confidenceThreshold === 'number' &&
                typeof result.confidence === 'number' &&
                result.confidence < advisor.confidenceThreshold,
            mapResult: result => ({
                delegable: result.delegable,
                confidence: result.confidence,
                rationale: result.rationale,
                source: 'model',
            }),
            fallback: () => defaultFlowAiDelegationAdvisor.recommend(args),
        });
    }
}

export function createFlowAiDelegationAdvisor(gateway?: LlmGateway): FlowAiDelegationAdvisor {
    // TODO(flow-design): Consult plugin/block manifests before fallback so external
    // blocks can declare whether a task should stay specialized instead of AI-delegated.
    if (!gateway) {
        return defaultFlowAiDelegationAdvisor;
    }
    return new LlmGatewayFlowAiDelegationAdvisor(gateway);
}

export function getTaskNodeOperation(node: DirectedGraph['nodes'][number]): string {
    return String(node.data?.operation ?? node.label ?? node.id);
}

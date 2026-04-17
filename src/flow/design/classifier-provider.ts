// Lightweight flow-design classifier provider backed by generic structured generation on an LLM gateway.
import type { LlmGateway } from '../../llm/types';
import type { FlowDesignLightweightClassifier } from './model-adapters';
import type { FlowDesignTaskGraphTemplate } from './task-graphs';
import type { FlowDesignTaskTypeDefinition } from './task-types';
import { buildTaskGraphClassificationRequest, buildTaskTypeClassificationRequest } from './classifier-requests';

/**
 * Provider that classifies flow-design requests by delegating to generic structured generation
 * on an existing LLM gateway. Prompts and schemas stay in the flow-design layer.
 */
export class LlmGatewayFlowDesignClassifierProvider implements FlowDesignLightweightClassifier {
    constructor(private readonly gateway: LlmGateway) {}

    async classifyTaskType(args: {
        userRequest: string;
        wantsJson: boolean;
        taskTypes: FlowDesignTaskTypeDefinition[];
    }): Promise<{
        taskType: string;
        confidence?: number;
        rationale?: string;
    }> {
        const result = await this.gateway.generateStructured(await buildTaskTypeClassificationRequest(args));

        return {
            taskType: result.taskType,
            confidence: result.confidence,
            rationale: result.rationale,
        };
    }

    async classifyTaskGraph(args: {
        userRequest: string;
        templates: FlowDesignTaskGraphTemplate[];
    }): Promise<{
        templateId: string;
        confidence?: number;
        rationale?: string;
    }> {
        const result = await this.gateway.generateStructured(await buildTaskGraphClassificationRequest(args));

        return {
            templateId: result.templateId,
            confidence: result.confidence,
            rationale: result.rationale,
        };
    }
}

// Wrapper sub-agent that delegates node configuration design to the shared core service.
import { NodeConfigDesignService } from '../design/core';
import type { NodeConfigKnowledgeSource } from '../design/knowledge';
import { createDefaultNodeBlockConfigStrategies, type NodeBlockConfigStrategy } from './strategies';
import type {
    NodeConfigurationDesignInput,
    NodeConfigurationDesignResult,
    NodeConfigurationValidationResult,
} from './types';

/** Designs concrete per-node configuration values for an already-structured flow draft. */
export class NodeConfigDesignAgent {
    private readonly service: NodeConfigDesignService;

    constructor(
        strategies: NodeBlockConfigStrategy[] = createDefaultNodeBlockConfigStrategies(),
        knowledgeSource?: NodeConfigKnowledgeSource,
    ) {
        this.service = new NodeConfigDesignService(strategies, knowledgeSource);
    }

    async design(input: NodeConfigurationDesignInput): Promise<NodeConfigurationDesignResult> {
        return await this.service.design(input);
    }

    validate(flow: import('../../types').FlowDocument): NodeConfigurationValidationResult {
        return this.service.validate(flow);
    }
}

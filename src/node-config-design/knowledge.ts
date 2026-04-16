// Knowledge-source abstraction for node-configuration design.
import type { NodeConfigurationDesignInput, NodeConfigurationStrategyDirective } from './types';

/** External knowledge source that can enrich node-config design inputs with extra guidance. */
export interface NodeConfigKnowledgeSource {
    getSharedNotes(input: NodeConfigurationDesignInput): string[] | Promise<string[]>;
    getStrategyDirectives(
        input: NodeConfigurationDesignInput,
    ): NodeConfigurationStrategyDirective[] | Promise<NodeConfigurationStrategyDirective[]>;
}

/** No-op knowledge source used when no external strategy guidance is configured. */
export class NullNodeConfigKnowledgeSource implements NodeConfigKnowledgeSource {
    getSharedNotes(): string[] {
        return [];
    }

    getStrategyDirectives(): NodeConfigurationStrategyDirective[] {
        return [];
    }
}

/** Shared default instance for callers that do not inject a custom knowledge source. */
export const defaultNodeConfigKnowledgeSource = new NullNodeConfigKnowledgeSource();

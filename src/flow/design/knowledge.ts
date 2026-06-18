// Knowledge-source abstraction for flow-design reasoning.
import type { FlowDesignReflection, DesignBrief, FlowDesignRequestNormalization } from './types';

/** External knowledge source that can enrich flow-design drafting and reflection. */
export interface FlowDesignKnowledgeSource {
    getDraftNotes(args: { brief: DesignBrief; request: FlowDesignRequestNormalization }): string[] | Promise<string[]>;
    getReflectionNotes(args: {
        brief: DesignBrief;
        request: FlowDesignRequestNormalization;
        sampleResult: {
            status: 'completed' | 'failed' | 'cancelled';
            output?: unknown;
            logs: string[];
        };
        reflection: FlowDesignReflection;
    }): string[] | Promise<string[]>;
}

/** No-op knowledge source used when no flow-design guidance is configured. */
export class NullFlowDesignKnowledgeSource implements FlowDesignKnowledgeSource {
    getDraftNotes(): string[] {
        return [];
    }

    getReflectionNotes(): string[] {
        return [];
    }
}

/** Shared default instance for callers that do not inject a custom knowledge source. */
export const defaultFlowDesignKnowledgeSource = new NullFlowDesignKnowledgeSource();

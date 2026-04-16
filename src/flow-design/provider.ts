// Provider abstraction for flow-design reasoning so deterministic and real implementations share one boundary.
import type { FlowDesignConnection, FlowDesignSession } from '../flow/design-monitor';
import type { FlowBlockDefinition } from '../flow/types';
import type { FlowFeasibilityAssessment } from './analysis';
import { analyzeFlowRequest, designFlowDraft, reflectFlowExecution } from './core';
import { defaultFlowDesignKnowledgeSource, type FlowDesignKnowledgeSource } from './knowledge';
import { createDefaultFlowDesignKnowledgeSource } from './knowledge-sources';
import type { FlowDesignDraftResult, FlowDesignIntent, FlowDesignReflection } from './types';

/** Provider contract for higher-level flow-design reasoning steps. */
export interface FlowDesignProvider {
    analyzeRequest(userRequest: string): Promise<FlowDesignIntent> | FlowDesignIntent;
    composeDraft(args: {
        userRequest: string;
        sampleInput: string;
        desiredCount: number;
        wantsJson: boolean;
        improvementNotes?: string[];
        preflight?: FlowFeasibilityAssessment;
        availableBlocks?: FlowBlockDefinition[];
        designSession?: FlowDesignSession;
        designConnection?: FlowDesignConnection;
        designSessionId?: string;
        toolName?: string;
    }): Promise<FlowDesignDraftResult> | FlowDesignDraftResult;
    reflectExecution(args: {
        userRequest: string;
        desiredCount: number;
        wantsJson: boolean;
        sampleResult: {
            status: 'completed' | 'failed' | 'cancelled';
            output?: unknown;
            logs: string[];
        };
    }): Promise<FlowDesignReflection> | FlowDesignReflection;
}

/** Deterministic provider used by tests, demos, and the current default runtime. */
export class DeterministicFlowDesignProvider implements FlowDesignProvider {
    constructor(
        private readonly knowledgeSource: FlowDesignKnowledgeSource = createDefaultFlowDesignKnowledgeSource(),
    ) {}

    async analyzeRequest(userRequest: string): Promise<FlowDesignIntent> {
        return await analyzeFlowRequest(userRequest);
    }

    async composeDraft(args: Parameters<FlowDesignProvider['composeDraft']>[0]): Promise<FlowDesignDraftResult> {
        const intent = await analyzeFlowRequest(args.userRequest);
        const guidanceNotes = await Promise.resolve(this.knowledgeSource.getDraftNotes(intent));
        return await designFlowDraft({
            ...args,
            guidanceNotes,
        });
    }

    async reflectExecution(args: Parameters<FlowDesignProvider['reflectExecution']>[0]): Promise<FlowDesignReflection> {
        const intent = await analyzeFlowRequest(args.userRequest);
        const baseReflection = reflectFlowExecution(args);
        const reflectionNotes = await Promise.resolve(
            this.knowledgeSource.getReflectionNotes({
                intent,
                sampleResult: args.sampleResult,
                reflection: baseReflection,
            }),
        );
        return reflectFlowExecution({
            ...args,
            reflectionNotes,
        });
    }
}

/** Shared default provider instance used when callers do not inject a custom implementation. */
export const defaultFlowDesignProvider = new DeterministicFlowDesignProvider(defaultFlowDesignKnowledgeSource);

// Provider abstraction for flow-design reasoning so deterministic and real implementations share one boundary.
import type { FlowDesignConnection, FlowDesignSession } from '../flow/design-monitor';
import type { FlowBlockDefinition } from '../flow/types';
import type { FlowFeasibilityAssessment } from './analysis';
import { analyzeFlowRequest, designFlowDraft, reflectFlowExecution } from './core';
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
    analyzeRequest(userRequest: string): FlowDesignIntent {
        return analyzeFlowRequest(userRequest);
    }

    composeDraft(args: Parameters<FlowDesignProvider['composeDraft']>[0]): FlowDesignDraftResult {
        return designFlowDraft(args);
    }

    reflectExecution(args: Parameters<FlowDesignProvider['reflectExecution']>[0]): FlowDesignReflection {
        return reflectFlowExecution(args);
    }
}

/** Shared default provider instance used when callers do not inject a custom implementation. */
export const defaultFlowDesignProvider = new DeterministicFlowDesignProvider();

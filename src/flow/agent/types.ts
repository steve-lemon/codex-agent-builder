// Wrapper-specific contracts for the flow design agent built on the shared core.
import type { FlowDesignConnection, FlowDesignSession } from '../design-monitor';
import type { FlowDesignProvider } from '../design/provider';
import type { FlowBlockDefinition } from '../types';
import type {
    DesignBrief,
    FlowDesignAiGenerateRequest,
    FlowDesignExecution,
    FlowDesignIntent,
    FlowDesignRequestNormalization,
    FlowDesignReflection,
    FlowDesignValidation,
} from '../design/types';

export * from '../design/types';

/** Mutable state carried across one design attempt. */
export interface FlowDesignAttemptState {
    iteration: number;
    userRequest: string;
    availableBlocks: FlowBlockDefinition[];
    improvementNotes: string[];
    normalizedRequest?: FlowDesignRequestNormalization;
    designBrief?: DesignBrief;
    intent?: FlowDesignIntent;
    flow?: import('../types').FlowDocument;
    validation?: FlowDesignValidation;
    execution?: FlowDesignExecution;
    reflection?: FlowDesignReflection;
    usedSkills: string[];
}

/** Immutable snapshot returned for each attempt. */
export interface FlowDesignAttemptResult {
    iteration: number;
    usedSkills: string[];
    intent: FlowDesignIntent;
    flow: import('../types').FlowDocument;
    validation: FlowDesignValidation;
    execution?: FlowDesignExecution;
    reflection?: FlowDesignReflection;
    improvementNotes: string[];
    normalizedRequest?: FlowDesignRequestNormalization;
    designBrief?: DesignBrief;
}

/** Final result returned by the flow design agent. */
export interface FlowDesignAgentResult {
    status: 'completed' | 'failed';
    userRequest: string;
    normalizedRequest?: FlowDesignRequestNormalization;
    designBrief?: DesignBrief;
    intent?: FlowDesignIntent;
    finalFlow?: import('../types').FlowDocument;
    validation?: FlowDesignValidation;
    execution?: FlowDesignExecution;
    reflection?: FlowDesignReflection;
    iterations: FlowDesignAttemptResult[];
    usedSkills: string[];
    error?: string;
}

/** Shared services used by design skills. */
export interface FlowDesignSkillServices {
    aiGenerate?: (request: FlowDesignAiGenerateRequest) => Promise<unknown>;
    designSession?: FlowDesignSession;
    provider?: FlowDesignProvider;
}

/** Skill contract used by the flow design agent pipeline. */
export interface FlowDesignSkill {
    name: string;
    applies(state: FlowDesignAttemptState): boolean;
    run(state: FlowDesignAttemptState, services: FlowDesignSkillServices): Promise<void>;
}

/** Constructor options for the flow design agent wrapper. */
export interface FlowDesignAgentOptions extends FlowDesignSkillServices {
    availableBlocks?: FlowBlockDefinition[];
    maxIterations?: number;
    skills?: FlowDesignSkill[];
    designConnection?: FlowDesignConnection;
}

// Contracts for the skill-based flow design agent.
import type { GraphExecutionPlan, GraphRunResult } from '../graph/types';
import type { FlowDesignConnection, FlowDesignSession } from '../flow/design-monitor';
import type { FlowAiGenerateRequest } from '../flow/runtime';
import type { FlowBlockDefinition, FlowDocument } from '../flow/types';

/** Coarse-grained task classification used by the flow design agent. */
export type FlowDesignTaskType = 'blog-title-generation' | 'json-generation' | 'text-generation' | 'unknown';

/** Parsed intent derived from the user's natural-language request. */
export interface FlowDesignIntent {
    /** Original user request. */
    userRequest: string;

    /** Coarse task category inferred from the request. */
    taskType: FlowDesignTaskType;

    /** Whether the user appears to want a JSON-shaped result. */
    wantsJson: boolean;

    /** Whether the user appears to want multiple outputs instead of a single result. */
    wantsMultiple: boolean;

    /** Target count used when the request implies repeated outputs. */
    desiredCount: number;

    /** Sample seed value used to exercise the designed flow. */
    sampleInput: string;
}

/** Validation summary for a designed flow draft. */
export interface FlowDesignValidation {
    /** Whether the flow passed structural validation. */
    isValid: boolean;

    /** Human-readable validation issues collected from nodes or planning. */
    issues: string[];

    /** Shared graph execution plan produced for the flow. */
    plan?: GraphExecutionPlan;
}

/** Example execution result captured from the designed flow. */
export interface FlowDesignExecution {
    /** Graph execution status. */
    status: GraphRunResult['status'];

    /** Final flow document after the example run. */
    flow: FlowDocument;

    /** Final value produced by the AI node output port. */
    output?: unknown;

    /** View block logs captured during execution. */
    logs: string[];

    /** Underlying graph execution result. */
    graphRun: GraphRunResult<string>;
}

/** Reflection result that decides whether another design attempt is needed. */
export interface FlowDesignReflection {
    /** Whether the sample run appears to satisfy the user's intent. */
    satisfied: boolean;

    /** Concise summary of the reflection outcome. */
    summary: string;

    /** Concrete issues that should feed the next retry. */
    issues: string[];

    /** Candidate improvement notes for the next attempt. */
    suggestedImprovements: string[];
}

/** Mutable state carried across one design attempt. */
export interface FlowDesignAttemptState {
    /** Attempt number starting at one. */
    iteration: number;

    /** Original request being solved. */
    userRequest: string;

    /** Blocks the agent is allowed to use while composing flows. */
    availableBlocks: FlowBlockDefinition[];

    /** Aggregated improvement notes carried from previous attempts. */
    improvementNotes: string[];

    /** Intent extracted from the user request. */
    intent?: FlowDesignIntent;

    /** Flow draft created for the current attempt. */
    flow?: FlowDocument;

    /** Validation result for the current flow draft. */
    validation?: FlowDesignValidation;

    /** Example execution details for the current flow draft. */
    execution?: FlowDesignExecution;

    /** Reflection outcome for the current flow draft. */
    reflection?: FlowDesignReflection;

    /** Skills used during this attempt, in execution order. */
    usedSkills: string[];
}

/** Immutable snapshot returned for each attempt. */
export interface FlowDesignAttemptResult {
    iteration: number;
    usedSkills: string[];
    intent: FlowDesignIntent;
    flow: FlowDocument;
    validation: FlowDesignValidation;
    execution?: FlowDesignExecution;
    reflection?: FlowDesignReflection;
    improvementNotes: string[];
}

/** Final result returned by the flow design agent. */
export interface FlowDesignAgentResult {
    /** Terminal run status. */
    status: 'completed' | 'failed';

    /** Original user request. */
    userRequest: string;

    /** Final parsed intent used to drive the design. */
    intent?: FlowDesignIntent;

    /** Final accepted flow document. */
    finalFlow?: FlowDocument;

    /** Final validation snapshot. */
    validation?: FlowDesignValidation;

    /** Final sample execution snapshot. */
    execution?: FlowDesignExecution;

    /** Final reflection snapshot. */
    reflection?: FlowDesignReflection;

    /** Attempt-by-attempt history. */
    iterations: FlowDesignAttemptResult[];

    /** Unique skills used across the full run. */
    usedSkills: string[];

    /** Error message when the run fails. */
    error?: string;
}

/** Extended AI request used by the flow design agent mock/runtime bridge. */
export interface FlowDesignAiGenerateRequest extends FlowAiGenerateRequest {
    /** Attempt number currently executing. */
    iteration: number;

    /** Original user request driving the overall flow design. */
    userRequest: string;

    /** Improvement notes accumulated from prior reflections. */
    improvementNotes: string[];
}

/** Shared services used by design skills. */
export interface FlowDesignSkillServices {
    /** Optional custom AI generator used for example execution. */
    aiGenerate?: (request: FlowDesignAiGenerateRequest) => Promise<unknown>;

    /** Optional live design session used to emit real-time graph updates. */
    designSession?: FlowDesignSession;
}

/** Skill contract used by the flow design agent pipeline. */
export interface FlowDesignSkill {
    /** Stable skill name used for tracing and reporting. */
    name: string;

    /** Whether the skill should run for the current attempt state. */
    applies(state: FlowDesignAttemptState): boolean;

    /** Executes the skill and mutates the attempt state. */
    run(state: FlowDesignAttemptState, services: FlowDesignSkillServices): Promise<void>;
}

/** Constructor options for the flow design agent. */
export interface FlowDesignAgentOptions extends FlowDesignSkillServices {
    /** Blocks that the agent may use while composing flows. */
    availableBlocks?: FlowBlockDefinition[];

    /** Maximum number of self-improvement attempts. */
    maxIterations?: number;

    /** Optional custom skill order. */
    skills?: FlowDesignSkill[];

    /** Optional connection used to stream real-time design updates to a client. */
    designConnection?: FlowDesignConnection;
}

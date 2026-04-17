// Skill-based agent that designs, validates, executes, and improves flows.
import { AgentError } from '../errors/agent-error';
import { getCatalogAvailableFlowBlocks } from '../flow-design/catalog';
import { FlowDesignSession } from '../flow/design-monitor';
import type { FlowBlockDefinition } from '../flow/types';
import { buildDefaultFlowDesignSkills } from './skills';
import type {
    FlowDesignAgentOptions,
    FlowDesignAgentResult,
    FlowDesignAttemptResult,
    FlowDesignAttemptState,
    FlowDesignSkill,
} from './types';

function snapshotAttempt(state: FlowDesignAttemptState): FlowDesignAttemptResult {
    if (!state.intent || !state.flow || !state.validation) {
        throw new AgentError('Flow design attempt could not be snapshotted because required state is missing');
    }

    return {
        iteration: state.iteration,
        usedSkills: [...state.usedSkills],
        intent: state.intent,
        flow: state.flow,
        validation: state.validation,
        execution: state.execution,
        reflection: state.reflection,
        improvementNotes: [...state.improvementNotes],
    };
}

/**
 * Coordinates a skill pipeline that turns a user request into a validated flow,
 * runs an example execution, reflects on the result, and retries when useful.
 */
export class FlowDesignAgent {
    private readonly maxIterations: number;
    private readonly availableBlocks: FlowBlockDefinition[];
    private readonly skills: FlowDesignSkill[];

    constructor(private readonly options: FlowDesignAgentOptions = {}) {
        this.maxIterations = Math.max(1, options.maxIterations ?? 3);
        this.availableBlocks = [...(options.availableBlocks ?? [])];
        this.skills = [...(options.skills ?? buildDefaultFlowDesignSkills())];
    }

    async design(userRequest: string): Promise<FlowDesignAgentResult> {
        const iterations: FlowDesignAttemptResult[] = [];
        const allUsedSkills = new Set<string>();
        let sharedImprovementNotes: string[] = [];
        const availableBlocks =
            this.availableBlocks.length > 0 ? this.availableBlocks : await getCatalogAvailableFlowBlocks();
        const designSession = this.options.designConnection
            ? new FlowDesignSession(`flow-design:${Date.now()}`, availableBlocks, this.options.designConnection)
            : undefined;

        designSession?.start({
            userRequest,
            iterationBudget: this.maxIterations,
        });

        try {
            for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
                if (iteration > 1) {
                    designSession?.clear({
                        iteration,
                        reason: 'retry',
                    });
                }

                const state: FlowDesignAttemptState = {
                    iteration,
                    userRequest,
                    availableBlocks,
                    improvementNotes: [...sharedImprovementNotes],
                    usedSkills: [],
                };

                try {
                    for (const skill of this.skills) {
                        if (!skill.applies(state)) {
                            continue;
                        }

                        state.usedSkills.push(skill.name);
                        allUsedSkills.add(skill.name);
                        await skill.run(state, {
                            aiGenerate: this.options.aiGenerate,
                            designSession,
                            provider: this.options.provider,
                        });
                    }
                } catch (error) {
                    const agentError = AgentError.from(error, 'Flow design agent failed');
                    designSession?.complete({
                        status: 'failed',
                        error: agentError.message,
                        iteration,
                    });
                    return {
                        status: 'failed',
                        userRequest,
                        intent: state.intent,
                        finalFlow: state.flow,
                        validation: state.validation,
                        execution: state.execution,
                        reflection: state.reflection,
                        iterations:
                            state.intent && state.flow && state.validation
                                ? [...iterations, snapshotAttempt(state)]
                                : iterations,
                        usedSkills: [...allUsedSkills],
                        error: agentError.message,
                    };
                }

                const attempt = snapshotAttempt(state);
                iterations.push(attempt);
                sharedImprovementNotes = [...attempt.improvementNotes];

                if (attempt.validation.isValid && attempt.reflection?.satisfied) {
                    designSession?.complete({
                        status: 'completed',
                        iteration,
                        usedSkills: [...allUsedSkills],
                    });
                    return {
                        status: 'completed',
                        userRequest,
                        intent: attempt.intent,
                        finalFlow: attempt.flow,
                        validation: attempt.validation,
                        execution: attempt.execution,
                        reflection: attempt.reflection,
                        iterations,
                        usedSkills: [...allUsedSkills],
                    };
                }
            }

            const lastAttempt = iterations.length > 0 ? iterations[iterations.length - 1] : undefined;
            designSession?.complete({
                status: 'failed',
                reason: 'retry-budget-exhausted',
                usedSkills: [...allUsedSkills],
            });
            return {
                status: 'failed',
                userRequest,
                intent: lastAttempt?.intent,
                finalFlow: lastAttempt?.flow,
                validation: lastAttempt?.validation,
                execution: lastAttempt?.execution,
                reflection: lastAttempt?.reflection,
                iterations,
                usedSkills: [...allUsedSkills],
                error: lastAttempt?.reflection?.issues.join(' ') || 'Flow design agent exhausted its retry budget.',
            };
        } finally {
            // The session may already be completed above. This ensures observers
            // are always closed when the agent scope ends.
            void this.options.designConnection?.close?.();
        }
    }
}

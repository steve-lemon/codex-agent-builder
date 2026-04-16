// Skill implementations for the flow design agent wrapper built on shared flow-design core.
import {
    analyzeFlowRequest,
    designFlowDraft,
    executeFlowDesignSample,
    reflectFlowExecution,
    validateDesignedFlow,
} from '../flow-design/core';
import type {
    FlowDesignAiGenerateRequest,
    FlowDesignAttemptState,
    FlowDesignSkill,
    FlowDesignSkillServices,
} from './types';

/** Extracts intent from the user's natural-language request. */
export class IntentAnalysisSkill implements FlowDesignSkill {
    readonly name = 'intent-analysis';

    applies(): boolean {
        return true;
    }

    async run(state: FlowDesignAttemptState, services: FlowDesignSkillServices): Promise<void> {
        state.intent = await Promise.resolve(
            services.provider?.analyzeRequest(state.userRequest) ?? analyzeFlowRequest(state.userRequest),
        );
    }
}

/** Builds a candidate flow using only the blocks already available to the agent. */
export class FlowCompositionSkill implements FlowDesignSkill {
    readonly name = 'flow-composition';

    applies(state: FlowDesignAttemptState): boolean {
        return state.intent !== undefined;
    }

    async run(state: FlowDesignAttemptState, services: FlowDesignSkillServices): Promise<void> {
        const intent = state.intent!;
        const result = services.provider
            ? await Promise.resolve(
                  services.provider.composeDraft({
                      userRequest: state.userRequest,
                      sampleInput: intent.sampleInput,
                      desiredCount: intent.desiredCount,
                      wantsJson: intent.wantsJson,
                      improvementNotes: state.improvementNotes,
                      availableBlocks: state.availableBlocks,
                      designSession: services.designSession,
                      toolName: 'flow-composition',
                  }),
              )
            : await designFlowDraft({
                  userRequest: state.userRequest,
                  sampleInput: intent.sampleInput,
                  desiredCount: intent.desiredCount,
                  wantsJson: intent.wantsJson,
                  improvementNotes: state.improvementNotes,
                  availableBlocks: state.availableBlocks,
                  designSession: services.designSession,
                  toolName: 'flow-composition',
              });

        state.flow = result.flow;
    }
}

/** Validates the flow draft and ensures it can be planned through the graph engine. */
export class FlowValidationSkill implements FlowDesignSkill {
    readonly name = 'flow-validation';

    applies(state: FlowDesignAttemptState): boolean {
        return state.flow !== undefined;
    }

    async run(state: FlowDesignAttemptState): Promise<void> {
        state.validation = validateDesignedFlow(state.flow!);
    }
}

/** Executes the designed flow with the shared graph executor and a deterministic AI runtime. */
export class FlowExecutionSkill implements FlowDesignSkill {
    readonly name = 'flow-execution';

    applies(state: FlowDesignAttemptState): boolean {
        return state.flow !== undefined && state.validation?.isValid === true;
    }

    async run(state: FlowDesignAttemptState, services: FlowDesignSkillServices): Promise<void> {
        const execution = await executeFlowDesignSample({
            flow: state.flow!,
            userRequest: state.userRequest,
            iteration: state.iteration,
            improvementNotes: state.improvementNotes,
            aiGenerate: services.aiGenerate
                ? async (request: FlowDesignAiGenerateRequest) => {
                      return await services.aiGenerate?.(request);
                  }
                : undefined,
        });

        state.execution = execution;
    }
}

/** Reflects on the sample run to decide whether another attempt is warranted. */
export class FlowReflectionSkill implements FlowDesignSkill {
    readonly name = 'flow-reflection';

    applies(state: FlowDesignAttemptState): boolean {
        return state.execution !== undefined && state.intent !== undefined;
    }

    async run(state: FlowDesignAttemptState, services: FlowDesignSkillServices): Promise<void> {
        const intent = state.intent!;
        state.reflection = await Promise.resolve(
            services.provider?.reflectExecution({
                userRequest: state.userRequest,
                desiredCount: intent.desiredCount,
                wantsJson: intent.wantsJson,
                sampleResult: {
                    status: state.execution!.status,
                    output: state.execution!.output,
                    logs: state.execution!.logs,
                },
            }) ??
                reflectFlowExecution({
                    userRequest: state.userRequest,
                    desiredCount: intent.desiredCount,
                    wantsJson: intent.wantsJson,
                    sampleResult: {
                        status: state.execution!.status,
                        output: state.execution!.output,
                        logs: state.execution!.logs,
                    },
                }),
        );
    }
}

/** Feeds reflection findings into the next iteration when the output is not good enough yet. */
export class FlowImprovementSkill implements FlowDesignSkill {
    readonly name = 'flow-improvement';

    applies(state: FlowDesignAttemptState): boolean {
        return state.reflection !== undefined;
    }

    async run(state: FlowDesignAttemptState): Promise<void> {
        if (state.reflection?.satisfied) {
            return;
        }

        for (const suggestion of state.reflection?.suggestedImprovements ?? []) {
            if (!state.improvementNotes.includes(suggestion)) {
                state.improvementNotes.push(suggestion);
            }
        }
    }
}

/** Default ordered skill pipeline used by the flow design agent. */
export function buildDefaultFlowDesignSkills(): FlowDesignSkill[] {
    return [
        new IntentAnalysisSkill(),
        new FlowCompositionSkill(),
        new FlowValidationSkill(),
        new FlowExecutionSkill(),
        new FlowReflectionSkill(),
        new FlowImprovementSkill(),
    ];
}

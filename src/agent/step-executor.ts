// Agent runtime flow and data contracts.
import type { PlanStep } from './schemas';
import type { AgentTracer } from '../observability/tracer';
import type { ToolRegistry } from '../tools';
import type { MultiSkillRouter } from './skill-router';
import { resolveToolExecutionPolicy } from '../policy/tool-policy';
import { resilientExecute } from '../resilience/resilient-execute';
import { CircuitBreaker } from '../resilience/circuit-breaker';
import type { ExecuteStepContext, PendingApproval, StepResult } from './types';
import { buildPendingApproval } from './approval';
import { AgentError } from '../errors/agent-error';
import { now } from '../tools/now';
import { resolveStepReferences } from './step-references';

export interface StepExecutorResult {
    stepResult?: StepResult;
    pendingApproval?: PendingApproval;
}

/** Executes each plan step while enforcing tool policy and approval semantics. */
export class StepExecutor {
    private readonly circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        coolDownMs: 1_000,
    });

    constructor(
        private readonly registry: ToolRegistry,
        private readonly skillRouter: MultiSkillRouter,
        private readonly tracer: AgentTracer,
    ) {}

    async executeStep(params: {
        runId: string;
        skillName: string;
        step: PlanStep;
        context: ExecuteStepContext;
    }): Promise<StepExecutorResult> {
        const { runId, skillName, step, context } = params;
        this.tracer.log(runId, 'step_start', { stepId: step.id, mode: step.mode });

        if (step.mode === 'reasoning') {
            const stepResult: StepResult = {
                stepId: step.id,
                mode: step.mode,
                output: { reasoning: step.reasoning ?? step.description },
            };
            this.tracer.log(runId, 'step_end', { stepId: step.id });
            return { stepResult };
        }

        if (step.mode === 'finalize') {
            const stepResult: StepResult = {
                stepId: step.id,
                mode: step.mode,
                output: { ready: true },
            };
            this.tracer.log(runId, 'step_end', { stepId: step.id });
            return { stepResult };
        }

        const toolCalls = step.toolCalls ?? [];
        const allowedToolNames = new Set(this.skillRouter.toolNamesForSkill(skillName as never));

        const executeOne = async (toolName: string, args: Record<string, unknown>) => {
            if (!allowedToolNames.has(toolName)) {
                throw new AgentError(`Tool ${toolName} is not allowed for skill ${skillName}`);
            }

            const tool = this.registry.get(toolName);
            if (!tool) {
                throw new AgentError(`Tool ${toolName} not found`);
            }

            const runState = await context.runState.get();
            const resolvedArgs = resolveStepReferences(args, runState.stepResults);

            if (tool.requiresConfirmation) {
                return { pendingApproval: buildPendingApproval(context.stepIndex, toolName, resolvedArgs) };
            }

            const policy = resolveToolExecutionPolicy(tool);
            this.tracer.log(runId, 'tool_start', { toolName, riskLevel: tool.riskLevel });

            const result = await resilientExecute({
                key: toolName,
                timeoutMs: policy.timeoutMs,
                retry: { maxAttempts: policy.maxAttempts, baseDelayMs: 50 },
                circuitBreaker: this.circuitBreaker,
                enableCircuitBreaker: policy.useCircuitBreaker,
                execute: async () => {
                    const execution = await this.registry.execute(
                        { toolName, args: resolvedArgs },
                        {
                            runId,
                            now: now(),
                            runState: context.runState,
                            designConnection: context.designConnection,
                        },
                    );
                    if (!execution.ok) {
                        throw new AgentError(execution.error ?? 'Tool execution failed', {
                            transient: /timeout|temporar|network/i.test(execution.error ?? ''),
                        });
                    }
                    return execution;
                },
            });

            this.tracer.log(runId, 'tool_end', { toolName, ok: true });
            return { result };
        };

        if (step.mode === 'single-tool') {
            const call = toolCalls[0];
            if (!call) {
                throw new AgentError(`Step ${step.id} expected one tool call`);
            }

            const outcome = await executeOne(call.toolName, call.args);
            if (outcome.pendingApproval) {
                this.tracer.log(runId, 'approval_wait', { stepId: step.id, toolName: call.toolName });
                return { pendingApproval: outcome.pendingApproval };
            }

            const stepResult: StepResult = {
                stepId: step.id,
                mode: step.mode,
                output: { description: step.description },
                toolResults: [outcome.result],
            };
            this.tracer.log(runId, 'step_end', { stepId: step.id });
            return { stepResult };
        }

        // parallel-tools: only run read-only and parallelSafe tools concurrently.
        const parallelCalls = toolCalls.filter(call => {
            const tool = this.registry.get(call.toolName);
            return tool && tool.riskLevel === 'read-only' && tool.parallelSafe;
        });

        const blockedCalls = toolCalls.filter(
            call => !parallelCalls.find(parallel => parallel.toolName === call.toolName),
        );

        if (blockedCalls.length > 0) {
            throw new AgentError(
                `parallel-tools step includes non parallel-safe/read-only tools: ${blockedCalls
                    .map(c => c.toolName)
                    .join(', ')}`,
            );
        }

        const results = await Promise.all(
            parallelCalls.map(async call => {
                const outcome = await executeOne(call.toolName, call.args);
                if (outcome.pendingApproval) {
                    throw new AgentError('parallel-tools cannot contain approval-required tools');
                }
                return outcome.result;
            }),
        );

        const stepResult: StepResult = {
            stepId: step.id,
            mode: step.mode,
            output: { description: step.description },
            toolResults: results,
        };
        this.tracer.log(runId, 'step_end', { stepId: step.id, tools: results.length });
        return { stepResult };
    }

    async executeApprovedTool(params: {
        runId: string;
        skillName: string;
        stepId: string;
        toolName: string;
        args: Record<string, unknown>;
        runState: ExecuteStepContext['runState'];
    }): Promise<StepResult> {
        const { runId, skillName, stepId, toolName, args, runState } = params;
        const allowedToolNames = new Set(this.skillRouter.toolNamesForSkill(skillName as never));

        if (!allowedToolNames.has(toolName)) {
            throw new AgentError(`Tool ${toolName} is not allowed for skill ${skillName}`);
        }

        const tool = this.registry.get(toolName);
        if (!tool) {
            throw new AgentError(`Tool ${toolName} not found`);
        }

        const policy = resolveToolExecutionPolicy(tool);
        const result = await resilientExecute({
            key: toolName,
            timeoutMs: policy.timeoutMs,
            retry: { maxAttempts: policy.maxAttempts, baseDelayMs: 50 },
            circuitBreaker: this.circuitBreaker,
            enableCircuitBreaker: policy.useCircuitBreaker,
            execute: async () => {
                const execution = await this.registry.execute(
                    { toolName, args },
                    {
                        runId,
                        now: now(),
                        runState,
                    },
                );
                if (!execution.ok) {
                    throw new AgentError(execution.error ?? 'Tool execution failed');
                }
                return execution;
            },
        });

        return {
            stepId,
            mode: 'single-tool',
            output: { resumedAfterApproval: true },
            toolResults: [result],
        };
    }
}

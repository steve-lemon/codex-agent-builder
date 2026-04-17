// Agent runtime flow and data contracts.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Planner } from './planner';
import { StepExecutor } from './step-executor';
import { Reflector } from './reflector';
import { Finalizer } from './finalizer';
import { SkillSelector, type SkillName } from './skill-selector';
import { MultiSkillRouter } from './skill-router';
import { resolveApprovalArgs } from './approval';
import type { LlmGateway } from '../llm/types';
import type { RuntimeRunResult, RunState, ApprovalDecision } from './types';
import type { RunStateStore } from '../state/types';
import type { ToolRegistry } from '../tools';
import { AgentTracer } from '../observability/tracer';
import { now } from '../tools/now';
import { AgentError } from '../errors/agent-error';
import { createLazyRunStateContext } from '../state/lazy-run-state';
import { buildToolManifest } from '../tools';
import { TraceStore } from '../observability/types';
import type { FlowDesignConnection } from '../flow/design-monitor';
import { UnifiedRunEventBus, type UnifiedRunEventConnection } from '../observability/unified-timeline';
import { addDiagnosticListener, removeDiagnosticListener, type DiagnosticListener } from '../diagnostics/logger';

/** Constructor dependencies required by the runtime coordinator. */
export interface AgentRuntimeOptions {
    llm: LlmGateway;
    store: RunStateStore;
    toolRegistry: ToolRegistry;
    tracer?: AgentTracer;
    traceStore?: TraceStore;
    flowDesignConnectionFactory?: (params: {
        runId: string;
        skillName: SkillName;
        userInput: string;
    }) => FlowDesignConnection | undefined;
    unifiedEventConnectionFactory?: (params: {
        runId: string;
        skillName: SkillName;
        userInput: string;
    }) => UnifiedRunEventConnection | undefined;

    // TODO(monitoring): Add a unified timeline persistence option if merged
    // trace/design streams need to be replayed after the live run ends.
}

/** Orchestrates selection, planning, execution, persistence, approvals, and tracing. */
export class AgentRuntime {
    public readonly tracer: AgentTracer;
    private readonly selector = new SkillSelector();
    private readonly router: MultiSkillRouter;
    private readonly planner: Planner;
    private readonly reflector: Reflector;
    private readonly finalizer: Finalizer;
    private readonly executor: StepExecutor;

    constructor(private readonly options: AgentRuntimeOptions) {
        this.tracer = options.tracer ?? new AgentTracer();
        this.router = new MultiSkillRouter(options.toolRegistry);
        this.planner = new Planner(options.llm);
        this.reflector = new Reflector(options.llm);
        this.finalizer = new Finalizer(options.llm);
        this.executor = new StepExecutor(options.toolRegistry, this.router, this.tracer);
    }

    getTracer(): AgentTracer {
        return this.tracer;
    }

    getOptions(): AgentRuntimeOptions {
        return this.options;
    }

    async run(userInput: string): Promise<RuntimeRunResult> {
        return this.startRun(userInput);
    }

    async runWithSkill(skillName: SkillName, userInput: string): Promise<RuntimeRunResult> {
        return this.startRun(userInput, skillName);
    }

    private async startRun(userInput: string, skillOverride?: SkillName): Promise<RuntimeRunResult> {
        const runId = randomUUID();
        const traceId = this.tracer.startTrace(runId);
        this.tracer.log(runId, 'run_start', { userInput });

        const skillName = skillOverride ?? (await this.selector.select(userInput));
        const skillInstructions = this.loadSkillInstructions(skillName);
        const allowedToolDefinitions = this.router.toolsForSkill(skillName);
        const allowedTools = allowedToolDefinitions.map(tool => tool.name);
        const toolManifests = allowedToolDefinitions.map(buildToolManifest);
        const unifiedConnection = this.options.unifiedEventConnectionFactory?.({
            runId,
            skillName,
            userInput,
        });
        const unifiedBus = unifiedConnection ? new UnifiedRunEventBus(runId, unifiedConnection) : undefined;
        const timelineTraceConnection = unifiedBus?.asTraceConnection();
        if (timelineTraceConnection) {
            this.tracer.attachConnection(runId, timelineTraceConnection);
        }
        const diagnosticListener = this.createDiagnosticTraceListener(runId);
        addDiagnosticListener(diagnosticListener);
        const externalDesignConnection = this.options.flowDesignConnectionFactory?.({
            runId,
            skillName,
            userInput,
        });
        const designConnection = this.combineFlowDesignConnections([
            externalDesignConnection,
            unifiedBus?.asFlowDesignConnection(),
        ]);

        this.tracer.log(runId, 'skill_selected', { skillName, allowedTools });
        this.tracer.log(runId, 'planner_call', {});

        const plan = await this.planner.createPlan({
            userInput,
            skillName,
            skillInstructions,
            allowedTools,
            toolManifests,
            toolDefinitions: allowedToolDefinitions,
        });

        const currentTime = now();
        const initialState: RunState = {
            runId,
            traceId,
            userInput,
            skillName,
            skillInstructions,
            allowedTools,
            plan,
            currentStepIndex: 0,
            resultNo: 0,
            stepResults: [],
            status: 'running',
            createdAt: currentTime,
            updatedAt: currentTime,
        };

        await this.options.store.save(initialState);
        try {
            const result = await this.executeUntilPauseOrComplete(runId, designConnection);
            this.tracer.log(runId, 'run_end', { status: result.status });
            if (result.status !== 'waiting_for_approval') {
                await this.tracer.flush(runId);
            }
            return { ...result, trace: this.tracer.getEvents(runId) };
        } finally {
            removeDiagnosticListener(diagnosticListener);
            if (timelineTraceConnection) {
                this.tracer.detachConnection(runId, timelineTraceConnection);
            }
            void designConnection?.close?.();
            unifiedBus?.close();
        }
    }

    async resume(runId: string, decision: ApprovalDecision): Promise<RuntimeRunResult> {
        const run = await this.options.store.get(runId);
        if (!run) {
            throw new AgentError(`Run not found: ${runId}`);
        }

        this.tracer.startTrace(runId, run.traceId);
        if (run.status !== 'waiting_for_approval' || !run.pendingApproval) {
            throw new AgentError(`Run ${runId} is not waiting for approval`);
        }

        this.tracer.log(runId, 'approval_decision', {
            decision: decision.decision,
            stepIndex: run.pendingApproval.stepIndex,
        });

        const resolved = resolveApprovalArgs(run.pendingApproval, decision);

        if (!resolved.approved) {
            await this.options.store.appendStepResult(runId, resolved.syntheticResult!);
            await this.options.store.update(runId, current => ({
                pendingApproval: undefined,
                status: 'running',
                currentStepIndex: current.currentStepIndex + 1,
                updatedAt: now(),
            }));
        } else {
            const approvedStep = run.plan.steps[run.pendingApproval.stepIndex];
            const stepResult = await this.executor.executeApprovedTool({
                runId,
                skillName: run.skillName,
                stepId: approvedStep?.id ?? `step-${run.pendingApproval.stepIndex}`,
                toolName: run.pendingApproval.toolCall.toolName,
                args: resolved.args,
                runState: this.createRunStateContext(runId),
            });

            await this.options.store.appendStepResult(runId, stepResult);
            await this.options.store.update(runId, current => ({
                pendingApproval: undefined,
                status: 'running',
                currentStepIndex: current.currentStepIndex + 1,
                updatedAt: now(),
            }));
        }

        const unifiedConnection = this.options.unifiedEventConnectionFactory?.({
            runId,
            skillName: run.skillName as SkillName,
            userInput: run.userInput,
        });
        const unifiedBus = unifiedConnection ? new UnifiedRunEventBus(runId, unifiedConnection) : undefined;
        const timelineTraceConnection = unifiedBus?.asTraceConnection();
        if (timelineTraceConnection) {
            this.tracer.attachConnection(runId, timelineTraceConnection);
        }
        const diagnosticListener = this.createDiagnosticTraceListener(runId);
        addDiagnosticListener(diagnosticListener);
        const externalDesignConnection = this.options.flowDesignConnectionFactory?.({
            runId,
            skillName: run.skillName as SkillName,
            userInput: run.userInput,
        });
        const designConnection = this.combineFlowDesignConnections([
            externalDesignConnection,
            unifiedBus?.asFlowDesignConnection(),
        ]);
        try {
            const result = await this.executeUntilPauseOrComplete(runId, designConnection);
            this.tracer.log(runId, 'run_end', { status: result.status });
            if (result.status !== 'waiting_for_approval') {
                await this.tracer.flush(runId);
            }
            return { ...result, trace: this.tracer.getEvents(runId) };
        } finally {
            removeDiagnosticListener(diagnosticListener);
            if (timelineTraceConnection) {
                this.tracer.detachConnection(runId, timelineTraceConnection);
            }
            void designConnection?.close?.();
            unifiedBus?.close();
        }
    }

    private async executeUntilPauseOrComplete(
        runId: string,
        designConnection?: FlowDesignConnection,
    ): Promise<RuntimeRunResult> {
        let run = await this.options.store.get(runId);
        if (!run) {
            throw new AgentError(`Run not found: ${runId}`);
        }

        while (run.currentStepIndex < run.plan.steps.length) {
            const stepIndex = run.currentStepIndex;
            const step = run.plan.steps[stepIndex];

            try {
                const result = await this.executor.executeStep({
                    runId,
                    skillName: run.skillName,
                    step,
                    context: {
                        runId,
                        stepIndex,
                        allowParallel: true,
                        runState: this.createRunStateContext(runId),
                        designConnection,
                    },
                });

                if (result.pendingApproval) {
                    run = await this.options.store.update(runId, current => ({
                        pendingApproval: result.pendingApproval,
                        status: 'waiting_for_approval',
                        updatedAt: now(),
                    }));

                    return {
                        runId,
                        status: run.status,
                        waitingApproval: run.pendingApproval,
                        trace: this.tracer.getEvents(runId),
                    };
                }

                await this.options.store.appendStepResult(runId, result.stepResult!);
                run = await this.options.store.update(runId, current => ({
                    currentStepIndex: current.currentStepIndex + 1,
                    updatedAt: now(),
                }));
            } catch (error) {
                const agentError = AgentError.from(error);
                this.tracer.log(runId, 'error', {
                    message: agentError.message,
                    stepIndex,
                });
                run = await this.options.store.update(runId, () => ({
                    status: 'failed',
                    updatedAt: now(),
                }));
                return {
                    runId,
                    status: run.status,
                    trace: this.tracer.getEvents(runId),
                };
            }
        }

        this.tracer.log(runId, 'reflector_call', {});
        const reflection = await this.reflector.reflect({
            userInput: run.userInput,
            stepResults: run.stepResults,
        });

        this.tracer.log(runId, 'finalizer_call', { isComplete: reflection.isComplete });
        const final = await this.finalizer.finalize({
            userInput: run.userInput,
            skillName: run.skillName,
            stepResults: run.stepResults,
        });

        run = await this.options.store.update(runId, () => ({
            status: 'completed',
            updatedAt: now(),
        }));

        return {
            runId,
            status: run.status,
            finalResult: final,
            trace: this.tracer.getEvents(runId),
        };
    }

    private loadSkillInstructions(skillName: SkillName): string {
        const filePath = join(process.cwd(), 'data', 'skills', skillName, 'SKILL.md');
        return readFileSync(filePath, 'utf-8');
    }

    private combineFlowDesignConnections(
        connections: Array<FlowDesignConnection | undefined>,
    ): FlowDesignConnection | undefined {
        const activeConnections = connections.filter(
            (connection): connection is FlowDesignConnection => connection !== undefined,
        );
        if (activeConnections.length === 0) {
            return undefined;
        }

        if (activeConnections.length === 1) {
            return activeConnections[0];
        }

        // TODO(monitoring): Introduce failure isolation / retry policy for each
        // downstream monitoring sink if one connection becomes unstable.
        return {
            send(event) {
                for (const connection of activeConnections) {
                    connection.send(event);
                }
            },
            close() {
                for (const connection of activeConnections) {
                    void connection.close?.();
                }
            },
        };
    }

    private createRunStateContext(runId: string) {
        return createLazyRunStateContext(this.options.store, runId);
    }

    private createDiagnosticTraceListener(runId: string): DiagnosticListener {
        return (level, event) => {
            // TODO(observability): Add correlation ids or planner/step linkage here so
            // diagnostic events can be tied back to a specific tool call or design pass.
            this.tracer.log(runId, `diagnostic_${level}`, {
                scope: event.scope,
                action: event.action,
                message: event.message,
                ...(event.data ?? {}),
            });
        };
    }
}

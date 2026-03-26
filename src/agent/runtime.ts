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
import type { ToolRegistry } from '../tools/registry';
import { AgentTracer } from '../observability/tracer';
import { now } from '../time/now';
import { AgentError } from '../errors/agent-error';
import { createLazyRunStateContext } from '../state/lazy-run-state';

/** Constructor dependencies required by the runtime coordinator. */
export interface AgentRuntimeOptions {
  llm: LlmGateway;
  store: RunStateStore;
  toolRegistry: ToolRegistry;
  tracer?: AgentTracer;
}

/** Orchestrates selection, planning, execution, persistence, approvals, and tracing. */
export class AgentRuntime {
  private readonly selector = new SkillSelector();
  private readonly router: MultiSkillRouter;
  private readonly planner: Planner;
  private readonly reflector: Reflector;
  private readonly finalizer: Finalizer;
  private readonly executor: StepExecutor;
  private readonly tracer: AgentTracer;

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

  async run(userInput: string): Promise<RuntimeRunResult> {
    const runId = randomUUID();
    this.tracer.log(runId, 'run_start', { userInput });

    const skillName = this.selector.select(userInput);
    const skillInstructions = this.loadSkillInstructions(skillName);
    const allowedTools = this.router.toolNamesForSkill(skillName);

    this.tracer.log(runId, 'skill_selected', { skillName, allowedTools });
    this.tracer.log(runId, 'planner_call', {});

    const plan = await this.planner.createPlan({
      userInput,
      skillName,
      skillInstructions,
      allowedTools
    });

    const currentTime = now();
    const initialState: RunState = {
      runId,
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
      updatedAt: currentTime
    };

    await this.options.store.save(initialState);
    const result = await this.executeUntilPauseOrComplete(runId);
    this.tracer.log(runId, 'run_end', { status: result.status });
    return result;
  }

  async resume(runId: string, decision: ApprovalDecision): Promise<RuntimeRunResult> {
    const run = await this.options.store.get(runId);
    if (!run) {
      throw new AgentError(`Run not found: ${runId}`);
    }

    if (run.status !== 'waiting_for_approval' || !run.pendingApproval) {
      throw new AgentError(`Run ${runId} is not waiting for approval`);
    }

    this.tracer.log(runId, 'approval_decision', {
      decision: decision.decision,
      stepIndex: run.pendingApproval.stepIndex
    });

    const resolved = resolveApprovalArgs(run.pendingApproval, decision);

    if (!resolved.approved) {
      await this.options.store.appendStepResult(runId, resolved.syntheticResult!);
      await this.options.store.update(runId, (current) => ({
        pendingApproval: undefined,
        status: 'running',
        currentStepIndex: current.currentStepIndex + 1,
        updatedAt: now()
      }));
    } else {
      const approvedStep = run.plan.steps[run.pendingApproval.stepIndex];
      const stepResult = await this.executor.executeApprovedTool({
        runId,
        skillName: run.skillName,
        stepId: approvedStep?.id ?? `step-${run.pendingApproval.stepIndex}`,
        toolName: run.pendingApproval.toolCall.toolName,
        args: resolved.args,
        runState: this.createRunStateContext(runId)
      });

      await this.options.store.appendStepResult(runId, stepResult);
      await this.options.store.update(runId, (current) => ({
        pendingApproval: undefined,
        status: 'running',
        currentStepIndex: current.currentStepIndex + 1,
        updatedAt: now()
      }));
    }

    const result = await this.executeUntilPauseOrComplete(runId);
    this.tracer.log(runId, 'run_end', { status: result.status });
    return result;
  }

  private async executeUntilPauseOrComplete(runId: string): Promise<RuntimeRunResult> {
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
            runState: this.createRunStateContext(runId)
          }
        });

        if (result.pendingApproval) {
          run = await this.options.store.update(runId, (current) => ({
            pendingApproval: result.pendingApproval,
            status: 'waiting_for_approval',
            updatedAt: now()
          }));

          return {
            runId,
            status: run.status,
            waitingApproval: run.pendingApproval,
            trace: this.tracer.getEvents(runId)
          };
        }

        await this.options.store.appendStepResult(runId, result.stepResult!);
        run = await this.options.store.update(runId, (current) => ({
          currentStepIndex: current.currentStepIndex + 1,
          updatedAt: now()
        }));
      } catch (error) {
        const agentError = AgentError.from(error);
        this.tracer.log(runId, 'error', {
          message: agentError.message,
          stepIndex
        });
        run = await this.options.store.update(runId, () => ({
          status: 'failed',
          updatedAt: now()
        }));
        return {
          runId,
          status: run.status,
          trace: this.tracer.getEvents(runId)
        };
      }
    }

    this.tracer.log(runId, 'reflector_call', {});
    const reflection = await this.reflector.reflect({
      userInput: run.userInput,
      stepResults: run.stepResults
    });

    this.tracer.log(runId, 'finalizer_call', { isComplete: reflection.isComplete });
    const final = await this.finalizer.finalize({
      userInput: run.userInput,
      skillName: run.skillName,
      stepResults: run.stepResults
    });

    run = await this.options.store.update(runId, () => ({
      status: 'completed',
      updatedAt: now()
    }));

    return {
      runId,
      status: run.status,
      finalResult: final,
      trace: this.tracer.getEvents(runId)
    };
  }

  private loadSkillInstructions(skillName: SkillName): string {
    const filePath = join(process.cwd(), 'src', 'skills', skillName, 'SKILL.md');
    return readFileSync(filePath, 'utf-8');
  }

  private createRunStateContext(runId: string) {
    return createLazyRunStateContext(this.options.store, runId);
  }
}

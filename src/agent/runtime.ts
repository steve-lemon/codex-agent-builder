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

export interface AgentRuntimeOptions {
  llm: LlmGateway;
  store: RunStateStore;
  toolRegistry: ToolRegistry;
  tracer?: AgentTracer;
}

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

    const now = new Date().toISOString();
    const initialState: RunState = {
      runId,
      userInput,
      skillName,
      skillInstructions,
      allowedTools,
      plan,
      currentStepIndex: 0,
      stepResults: [],
      status: 'running',
      createdAt: now,
      updatedAt: now
    };

    await this.options.store.save(initialState);
    const result = await this.executeUntilPauseOrComplete(runId);
    this.tracer.log(runId, 'run_end', { status: result.status });
    return result;
  }

  async resume(runId: string, decision: ApprovalDecision): Promise<RuntimeRunResult> {
    const run = await this.options.store.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status !== 'waiting_for_approval' || !run.pendingApproval) {
      throw new Error(`Run ${runId} is not waiting for approval`);
    }

    this.tracer.log(runId, 'approval_decision', {
      decision: decision.decision,
      stepIndex: run.pendingApproval.stepIndex
    });

    const resolved = resolveApprovalArgs(run.pendingApproval, decision);

    if (!resolved.approved) {
      await this.options.store.update(runId, (current) => ({
        ...current,
        pendingApproval: undefined,
        status: 'running',
        currentStepIndex: current.currentStepIndex + 1,
        stepResults: [...current.stepResults, resolved.syntheticResult!],
        updatedAt: new Date().toISOString()
      }));
    } else {
      const approvedStep = run.plan.steps[run.pendingApproval.stepIndex];
      const stepResult = await this.executor.executeApprovedTool({
        runId,
        skillName: run.skillName,
        stepId: approvedStep?.id ?? `step-${run.pendingApproval.stepIndex}`,
        toolName: run.pendingApproval.toolCall.toolName,
        args: resolved.args
      });

      await this.options.store.update(runId, (current) => ({
        ...current,
        pendingApproval: undefined,
        status: 'running',
        currentStepIndex: current.currentStepIndex + 1,
        stepResults: [...current.stepResults, stepResult],
        updatedAt: new Date().toISOString()
      }));
    }

    const result = await this.executeUntilPauseOrComplete(runId);
    this.tracer.log(runId, 'run_end', { status: result.status });
    return result;
  }

  private async executeUntilPauseOrComplete(runId: string): Promise<RuntimeRunResult> {
    let run = await this.options.store.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
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
            allowParallel: true
          }
        });

        if (result.pendingApproval) {
          run = await this.options.store.update(runId, (current) => ({
            ...current,
            pendingApproval: result.pendingApproval,
            status: 'waiting_for_approval',
            updatedAt: new Date().toISOString()
          }));

          return {
            runId,
            status: run.status,
            waitingApproval: run.pendingApproval,
            trace: this.tracer.getEvents(runId)
          };
        }

        run = await this.options.store.update(runId, (current) => ({
          ...current,
          currentStepIndex: current.currentStepIndex + 1,
          stepResults: [...current.stepResults, result.stepResult!],
          updatedAt: new Date().toISOString()
        }));
      } catch (error) {
        this.tracer.log(runId, 'error', {
          message: error instanceof Error ? error.message : String(error),
          stepIndex
        });
        run = await this.options.store.update(runId, (current) => ({
          ...current,
          status: 'failed',
          updatedAt: new Date().toISOString()
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

    run = await this.options.store.update(runId, (current) => ({
      ...current,
      status: 'completed',
      updatedAt: new Date().toISOString()
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
}

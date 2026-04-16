// Product-facing facade for flow design, preflight, and node-config operations.
import { AgentRuntime, type AgentRuntimeOptions } from '../agent';
import { CallbackFlowDesignConnection } from '../flow/design-monitor';
import { CallbackUnifiedRunEventConnection } from '../observability/unified-timeline';
import { FakeLlmGateway, GeminiGateway, OpenAiGateway } from '../llm';
import { InMemoryRunStateStore } from '../state/memory-store';
import { buildDefaultToolRegistry } from '../tools';
import type { ProductDesignRunResult, ProductFlowSkill, FlowDesignProductApi, ProductMonitoringHooks } from './types';
import { normalizeProductDesignRunResult } from './normalize';
import type { ApprovalDecision } from '../agent/types';

export interface FlowDesignProductOptions {
    runtime?: AgentRuntime;
    runtimeOptions?: Partial<AgentRuntimeOptions>;
}

/** Product-ready facade that exposes explicit flow-related agent entrypoints. */
export class FlowDesignProduct implements FlowDesignProductApi {
    private readonly baseRuntime: AgentRuntime;
    private readonly baseRuntimeOptions: AgentRuntimeOptions;

    constructor(private readonly options: FlowDesignProductOptions = {}) {
        this.baseRuntime = options.runtime ?? new AgentRuntime(this.resolveRuntimeOptions(options.runtimeOptions));
        this.baseRuntimeOptions = options.runtime?.getOptions() ?? this.resolveRuntimeOptions(options.runtimeOptions);
    }

    getRuntime(): AgentRuntime {
        return this.baseRuntime;
    }

    async preflight(userRequest: string, hooks?: ProductMonitoringHooks): Promise<ProductDesignRunResult> {
        return this.runSkill('flow-preflight-validator', userRequest, hooks);
    }

    async design(userRequest: string, hooks?: ProductMonitoringHooks): Promise<ProductDesignRunResult> {
        return this.runSkill('flow-designer', userRequest, hooks);
    }

    async designNodeConfiguration(
        userRequest: string,
        hooks?: ProductMonitoringHooks,
    ): Promise<ProductDesignRunResult> {
        return this.runSkill('node-config-designer', userRequest, hooks);
    }

    async resume(runId: string, decision: ApprovalDecision): Promise<ProductDesignRunResult> {
        const resumed = await this.baseRuntime.resume(runId, decision);
        const skillName = resumed.finalResult?.payload?.kind ?? 'flow-designer';
        return normalizeProductDesignRunResult(skillName, resumed);
    }

    private async runSkill(
        skillName: ProductFlowSkill,
        userRequest: string,
        hooks?: ProductMonitoringHooks,
    ): Promise<ProductDesignRunResult> {
        if (!hooks?.onDesignEvent && !hooks?.onTimelineEvent) {
            return normalizeProductDesignRunResult(
                skillName,
                await this.baseRuntime.runWithSkill(skillName, userRequest),
            );
        }

        const runtime = new AgentRuntime({
            ...this.baseRuntimeOptions,
            flowDesignConnectionFactory: hooks?.onDesignEvent
                ? () => new CallbackFlowDesignConnection(event => hooks.onDesignEvent?.(event))
                : undefined,
            unifiedEventConnectionFactory: hooks?.onTimelineEvent
                ? () => new CallbackUnifiedRunEventConnection(event => hooks.onTimelineEvent?.(event))
                : undefined,
        });

        return normalizeProductDesignRunResult(skillName, await runtime.runWithSkill(skillName, userRequest));
    }

    private resolveRuntimeOptions(options?: Partial<AgentRuntimeOptions>): AgentRuntimeOptions {
        const provider = String(process.env.LLM_PROVIDER ?? '').toLowerCase();
        const useRealOpenAi = String(process.env.USE_REAL_OPENAI ?? 'false').toLowerCase() === 'true';
        const useRealGemini = String(process.env.USE_REAL_GEMINI ?? 'false').toLowerCase() === 'true';

        return {
            llm:
                options?.llm ??
                (provider === 'gemini' || useRealGemini
                    ? new GeminiGateway()
                    : provider === 'openai' || useRealOpenAi
                    ? new OpenAiGateway()
                    : new FakeLlmGateway()),
            store: options?.store ?? new InMemoryRunStateStore(),
            toolRegistry: options?.toolRegistry ?? buildDefaultToolRegistry(),
            tracer: options?.tracer,
            traceStore: options?.traceStore,
            flowDesignConnectionFactory: options?.flowDesignConnectionFactory,
            unifiedEventConnectionFactory: options?.unifiedEventConnectionFactory,
        };
    }
}

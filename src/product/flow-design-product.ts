// Product-facing facade for flow design, preflight, and node-config operations.
import { AgentRuntime, type AgentRuntimeOptions } from '../agent';
import { ensureProjectEnvLoaded } from '../env/project-env';
import { getCatalogAvailableFlowBlocks } from '../flow/design/catalog';
import { CallbackFlowDesignConnection } from '../flow/design-monitor';
import { CallbackUnifiedRunEventConnection } from '../observability/unified-timeline';
import { FakeLlmGateway, GeminiGateway, OpenAiGateway } from '../llm';
import { InMemoryRunStateStore } from '../state/memory-store';
import { buildDefaultToolRegistry } from '../tools';
import type { ProductDesignRunResult, ProductFlowSkill, FlowDesignProductApi, ProductMonitoringHooks } from './types';
import { normalizeProductDesignRunResult } from './normalize';
import type { ApprovalDecision, StepResult } from '../agent/types';
import type { FlowDocument } from '../flow/types';

export interface FlowDesignProductOptions {
    runtime?: AgentRuntime;
    runtimeOptions?: Partial<AgentRuntimeOptions>;
}

/** Product-ready facade that exposes explicit flow-related agent entrypoints. */
export class FlowDesignProduct implements FlowDesignProductApi {
    private readonly baseRuntimePromise: Promise<AgentRuntime>;
    private readonly baseRuntimeOptionsPromise: Promise<AgentRuntimeOptions>;

    constructor(private readonly options: FlowDesignProductOptions = {}) {
        ensureProjectEnvLoaded();
        this.baseRuntimeOptionsPromise = options.runtime
            ? Promise.resolve(options.runtime.getOptions())
            : this.resolveRuntimeOptions(options.runtimeOptions);
        this.baseRuntimePromise = options.runtime
            ? Promise.resolve(options.runtime)
            : this.baseRuntimeOptionsPromise.then(runtimeOptions => new AgentRuntime(runtimeOptions));
    }

    async getRuntime(): Promise<AgentRuntime> {
        return await this.baseRuntimePromise;
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
        const runtime = await this.baseRuntimePromise;
        const resumed = await runtime.resume(runId, decision);
        const skillName = resumed.finalResult?.payload?.kind ?? 'flow-designer';
        return normalizeProductDesignRunResult(skillName, resumed, {
            finalFlow: await this.loadFinalFlow(runtime, resumed.runId),
        });
    }

    private async runSkill(
        skillName: ProductFlowSkill,
        userRequest: string,
        hooks?: ProductMonitoringHooks,
    ): Promise<ProductDesignRunResult> {
        if (!hooks?.onDesignEvent && !hooks?.onTimelineEvent) {
            const runtime = await this.baseRuntimePromise;
            const result = await runtime.runWithSkill(skillName, userRequest);
            return normalizeProductDesignRunResult(skillName, result, {
                finalFlow: await this.loadFinalFlow(runtime, result.runId),
            });
        }

        const runtime = new AgentRuntime({
            ...(await this.baseRuntimeOptionsPromise),
            flowDesignConnectionFactory: hooks?.onDesignEvent
                ? () => new CallbackFlowDesignConnection(event => hooks.onDesignEvent?.(event))
                : undefined,
            unifiedEventConnectionFactory: hooks?.onTimelineEvent
                ? () => new CallbackUnifiedRunEventConnection(event => hooks.onTimelineEvent?.(event))
                : undefined,
        });

        const result = await runtime.runWithSkill(skillName, userRequest);
        return normalizeProductDesignRunResult(skillName, result, {
            finalFlow: await this.loadFinalFlow(runtime, result.runId),
        });
    }

    private async loadFinalFlow(runtime: AgentRuntime, runId: string): Promise<FlowDocument | undefined> {
        const runState = await runtime.getOptions().store.get(runId);
        if (!runState) {
            return undefined;
        }

        const availableBlocks = await getCatalogAvailableFlowBlocks();
        const finalFlow = this.extractFinalFlow(runState.stepResults, availableBlocks);
        return finalFlow;
    }

    private extractFinalFlow(
        stepResults: StepResult[],
        availableBlocks: FlowDocument['blocks'],
    ): FlowDocument | undefined {
        const availableBlockMap = new Map(availableBlocks.map(block => [block.id, block]));
        for (const stepResult of [...stepResults].reverse()) {
            const toolResults = stepResult.toolResults ?? [];
            for (const toolResult of toolResults) {
                if (!toolResult.ok || !toolResult.data || typeof toolResult.data !== 'object') {
                    continue;
                }

                const flow = (toolResult.data as { flow?: unknown }).flow;
                if (this.isFlowDocument(flow) && this.isKnownFlowDocument(flow, availableBlockMap)) {
                    return {
                        ...flow,
                        blocks:
                            flow.blocks.length > 0
                                ? flow.blocks
                                      .map(block => availableBlockMap.get(block.id))
                                      .filter((block): block is NonNullable<typeof block> => block !== undefined)
                                : availableBlocks,
                    };
                }
            }
        }

        return undefined;
    }

    private isFlowDocument(value: unknown): value is FlowDocument {
        if (!value || typeof value !== 'object') {
            return false;
        }

        const candidate = value as Partial<FlowDocument>;
        return Array.isArray(candidate.blocks) && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
    }

    private isKnownFlowDocument(
        flow: FlowDocument,
        availableBlockMap: Map<string, FlowDocument['blocks'][number]>,
    ): boolean {
        return flow.nodes.every(node => availableBlockMap.has(node.blockId));
    }

    private async resolveRuntimeOptions(options?: Partial<AgentRuntimeOptions>): Promise<AgentRuntimeOptions> {
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
            toolRegistry: options?.toolRegistry ?? (await buildDefaultToolRegistry()),
            tracer: options?.tracer,
            traceStore: options?.traceStore,
            flowDesignConnectionFactory: options?.flowDesignConnectionFactory,
            unifiedEventConnectionFactory: options?.unifiedEventConnectionFactory,
        };
    }
}

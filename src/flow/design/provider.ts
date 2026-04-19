// Provider abstraction for flow-design reasoning so deterministic and real implementations share one boundary.
import type { FlowDesignConnection, FlowDesignSession } from '../design-monitor';
import type { FlowBlockDefinition } from '../types';
import type { FlowFeasibilityAssessment } from './analysis';
import { buildLegacyFlowDesignIntent, designFlowDraft, normalizeFlowRequest, reflectFlowExecution } from './core';
import { buildDesignBrief } from './architecture';
import { defaultFlowDesignKnowledgeSource, type FlowDesignKnowledgeSource } from './knowledge';
import { createDefaultFlowDesignKnowledgeSource } from './knowledge-sources';
import {
    defaultFlowDesignTaskTypeAdvisor,
    getFlowDesignTaskTypeCatalog,
    type FlowDesignTaskTypeAdvisor,
} from './task-types';
import type {
    DesignBrief,
    FlowDesignDraftResult,
    FlowDesignIntent,
    FlowDesignReflection,
    FlowDesignRequestNormalization,
} from './types';

/** Provider contract for higher-level flow-design reasoning steps. */
export interface FlowDesignProvider {
    normalizeRequest?(userRequest: string): Promise<FlowDesignRequestNormalization> | FlowDesignRequestNormalization;
    buildBrief?(userRequest: string): Promise<DesignBrief> | DesignBrief;
    analyzeRequest(userRequest: string): Promise<FlowDesignIntent> | FlowDesignIntent;
    composeDraft(args: {
        userRequest: string;
        sampleInput: string;
        desiredCount: number;
        wantsJson: boolean;
        improvementNotes?: string[];
        preflight?: FlowFeasibilityAssessment;
        availableBlocks?: FlowBlockDefinition[];
        designSession?: FlowDesignSession;
        designConnection?: FlowDesignConnection;
        designSessionId?: string;
        toolName?: string;
    }): Promise<FlowDesignDraftResult> | FlowDesignDraftResult;
    reflectExecution(args: {
        userRequest: string;
        desiredCount: number;
        wantsJson: boolean;
        sampleResult: {
            status: 'completed' | 'failed' | 'cancelled';
            output?: unknown;
            logs: string[];
        };
    }): Promise<FlowDesignReflection> | FlowDesignReflection;
}

/** Deterministic provider used by tests, demos, and the current default runtime. */
export class DeterministicFlowDesignProvider implements FlowDesignProvider {
    constructor(
        private readonly knowledgeSource: FlowDesignKnowledgeSource = createDefaultFlowDesignKnowledgeSource(),
        private readonly taskTypeAdvisor: FlowDesignTaskTypeAdvisor = defaultFlowDesignTaskTypeAdvisor,
    ) {}

    async normalizeRequest(userRequest: string): Promise<FlowDesignRequestNormalization> {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        return await normalizeFlowRequest(userRequest, {
            taskTypeAdvisor: this.taskTypeAdvisor,
            taskTypes,
        });
    }

    async buildBrief(userRequest: string): Promise<DesignBrief> {
        return await buildDesignBrief(await this.normalizeRequest(userRequest));
    }

    async analyzeRequest(userRequest: string): Promise<FlowDesignIntent> {
        const normalizedRequest = await this.normalizeRequest(userRequest);
        const designBrief = await this.buildBrief(userRequest);
        return buildLegacyFlowDesignIntent({
            normalizedRequest,
            designBrief,
        });
    }

    async composeDraft(args: Parameters<FlowDesignProvider['composeDraft']>[0]): Promise<FlowDesignDraftResult> {
        const normalizedRequest = await this.normalizeRequest(args.userRequest);
        const designBrief = await this.buildBrief(args.userRequest);
        const guidanceNotes = await Promise.resolve(
            this.knowledgeSource.getDraftNotes({
                brief: designBrief,
                request: normalizedRequest,
            }),
        );
        return await designFlowDraft({
            ...args,
            guidanceNotes,
        });
    }

    async reflectExecution(args: Parameters<FlowDesignProvider['reflectExecution']>[0]): Promise<FlowDesignReflection> {
        const normalizedRequest = await this.normalizeRequest(args.userRequest);
        const designBrief = await this.buildBrief(args.userRequest);
        const baseReflection = await reflectFlowExecution(args);
        const reflectionNotes = await Promise.resolve(
            this.knowledgeSource.getReflectionNotes({
                brief: designBrief,
                request: normalizedRequest,
                sampleResult: args.sampleResult,
                reflection: baseReflection,
            }),
        );
        return await reflectFlowExecution({
            ...args,
            reflectionNotes,
        });
    }
}

/** Shared default provider instance used when callers do not inject a custom implementation. */
export const defaultFlowDesignProvider = new DeterministicFlowDesignProvider(defaultFlowDesignKnowledgeSource);

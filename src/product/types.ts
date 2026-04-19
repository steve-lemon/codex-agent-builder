// Product-facing DTOs for the flow design product facade.
import type { ApprovalDecision, FinalResult, PendingApproval, RuntimeRunResult } from '../agent/types';
import type { FlowDesignEvent } from '../flow/design-monitor';
import type { FlowDesignDetailsDto } from '../flow/design/dto';
import type { UnifiedRunEvent } from '../observability/unified-timeline';
import type {
    FlowDesignerFinalPayload,
    FlowPreflightValidatorFinalPayload,
    NodeConfigDesignerFinalPayload,
} from '../agent/types';
import type { TraceEvent } from '../observability/types';
import type { NodeConfigDesignDetailsDto } from '../flow/node-config/design/dto';
import type { FlowDocument } from '../flow/types';
import type { FlowOutputContract } from '../flow/output-contract';
import type { ArchitectureReview, DesignBrief } from '../flow/design/types';

export type ProductFlowSkill = 'flow-preflight-validator' | 'flow-designer' | 'node-config-designer';

export type RequirementFulfillmentLevel = 'fulfilled' | 'uncertain' | 'partial' | 'not-fulfilled';

export type RequirementAssessmentReasonCategory =
    | 'execution'
    | 'capability'
    | 'classification'
    | 'output-contract'
    | 'runtime'
    | 'evidence';

export type RequirementAssessmentReasonCode =
    | 'execution-failed'
    | 'execution-completed-without-solution'
    | 'missing-capabilities'
    | 'generic-task-graph-fallback'
    | 'mock-model-config'
    | 'json-contract-not-preserved'
    | 'json-schema-missing'
    | 'plain-text-format-drift'
    | 'synthetic-sample-validation'
    | 'architecture-confidence-limited'
    | 'architecture-evidence-thin';

export interface RequirementAssessmentReason {
    category: RequirementAssessmentReasonCategory;
    code: RequirementAssessmentReasonCode;
    message: string;
}

export interface RequirementAssessment {
    executionSucceeded: boolean;
    fulfillmentLevel: RequirementFulfillmentLevel;
    summary: string;
    caveats: string[];
    reasons: RequirementAssessmentReason[];
}

/** Optional per-call monitoring hooks for product-facing design runs. */
export interface ProductMonitoringHooks {
    onDesignEvent?: (event: FlowDesignEvent) => void;
    onTimelineEvent?: (event: UnifiedRunEvent) => void;
}

/** Normalized product-facing result used by preflight, design, and node-config flows. */
export interface ProductDesignRunResult {
    skillName: ProductFlowSkill;
    runId: string;
    status: RuntimeRunResult['status'];
    summary?: string;
    success?: boolean;
    requirementAssessment: RequirementAssessment;
    nextActions: string[];
    finalResult?: FinalResult;
    flowDesign: FlowDesignDetailsDto;
    nodeConfiguration: NodeConfigDesignDetailsDto;
    flowDesignerPayload?: FlowDesignerFinalPayload;
    preflightPayload?: FlowPreflightValidatorFinalPayload;
    nodeConfigPayload?: NodeConfigDesignerFinalPayload;
    waitingApproval?: PendingApproval;
    trace: TraceEvent[];
    finalFlow?: FlowDocument;
    outputContract: FlowOutputContract;
    architectureBrief?: DesignBrief;
    architectureReview?: ArchitectureReview;
}

/** Product-facing API for flow-related agent features. */
export interface FlowDesignProductApi {
    preflight(userRequest: string, hooks?: ProductMonitoringHooks): Promise<ProductDesignRunResult>;
    design(userRequest: string, hooks?: ProductMonitoringHooks): Promise<ProductDesignRunResult>;
    designNodeConfiguration(userRequest: string, hooks?: ProductMonitoringHooks): Promise<ProductDesignRunResult>;
    resume(runId: string, decision: ApprovalDecision): Promise<ProductDesignRunResult>;
}

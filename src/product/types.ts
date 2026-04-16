// Product-facing DTOs for the flow design product facade.
import type { ApprovalDecision, FinalResult, PendingApproval, RuntimeRunResult } from '../agent/types';
import type { FlowDesignEvent } from '../flow/design-monitor';
import type { FlowDesignDetailsDto } from '../flow-design/dto';
import type { UnifiedRunEvent } from '../observability/unified-timeline';
import type {
    FlowDesignerFinalPayload,
    FlowPreflightValidatorFinalPayload,
    NodeConfigDesignerFinalPayload,
} from '../agent/types';
import type { TraceEvent } from '../observability/types';
import type { NodeConfigDesignDetailsDto } from '../node-config-design/dto';

export type ProductFlowSkill = 'flow-preflight-validator' | 'flow-designer' | 'node-config-designer';

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
    nextActions: string[];
    finalResult?: FinalResult;
    flowDesign: FlowDesignDetailsDto;
    nodeConfiguration: NodeConfigDesignDetailsDto;
    flowDesignerPayload?: FlowDesignerFinalPayload;
    preflightPayload?: FlowPreflightValidatorFinalPayload;
    nodeConfigPayload?: NodeConfigDesignerFinalPayload;
    waitingApproval?: PendingApproval;
    trace: TraceEvent[];
}

/** Product-facing API for flow-related agent features. */
export interface FlowDesignProductApi {
    preflight(userRequest: string, hooks?: ProductMonitoringHooks): Promise<ProductDesignRunResult>;
    design(userRequest: string, hooks?: ProductMonitoringHooks): Promise<ProductDesignRunResult>;
    designNodeConfiguration(userRequest: string, hooks?: ProductMonitoringHooks): Promise<ProductDesignRunResult>;
    resume(runId: string, decision: ApprovalDecision): Promise<ProductDesignRunResult>;
}

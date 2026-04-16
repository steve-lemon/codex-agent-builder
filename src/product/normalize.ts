// Normalizers that map runtime-level results into product-facing DTOs.
import { getFlowDesignDetails, getNodeConfigurationDetails } from '../agent/design-details';
import {
    getFlowDesignerPayload,
    getFlowPreflightValidatorPayload,
    getNodeConfigDesignerPayload,
} from '../agent/final-result-payload';
import type { RuntimeRunResult } from '../agent/types';
import type { ProductDesignRunResult, ProductFlowSkill } from './types';

/** Converts a runtime result into the product-facing normalized response shape. */
export function normalizeProductDesignRunResult(
    skillName: ProductFlowSkill,
    result: RuntimeRunResult,
): ProductDesignRunResult {
    const finalResult = result.finalResult;
    const designDetails = finalResult?.designDetails;

    return {
        skillName,
        runId: result.runId,
        status: result.status,
        summary: finalResult?.summary,
        success: finalResult?.success,
        nextActions: finalResult?.nextActions ?? [],
        finalResult,
        flowDesign: getFlowDesignDetails(designDetails),
        nodeConfiguration: getNodeConfigurationDetails(designDetails),
        flowDesignerPayload: getFlowDesignerPayload(finalResult?.payload),
        preflightPayload: getFlowPreflightValidatorPayload(finalResult?.payload),
        nodeConfigPayload: getNodeConfigDesignerPayload(finalResult?.payload),
        waitingApproval: result.waitingApproval,
        trace: result.trace,
    };
}

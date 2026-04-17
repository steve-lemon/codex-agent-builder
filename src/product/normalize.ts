// Normalizers that map runtime-level results into product-facing DTOs.
import { getFlowDesignDetails, getNodeConfigurationDetails } from '../agent/design-details';
import {
    getFlowDesignerPayload,
    getFlowPreflightValidatorPayload,
    getNodeConfigDesignerPayload,
} from '../agent/final-result-payload';
import type { RuntimeRunResult } from '../agent/types';
import type { FlowDocument } from '../flow/types';
import type { ProductDesignRunResult, ProductFlowSkill, RequirementAssessment } from './types';

function collectRequirementAssessment(args: {
    result: RuntimeRunResult;
    finalFlow?: FlowDocument;
}): RequirementAssessment {
    const finalResult = args.result.finalResult;
    const flowDesign = finalResult?.designDetails?.flowDesign;
    const payload = finalResult?.payload;
    const executionSucceeded = args.result.status === 'completed' && finalResult?.success === true;
    const missingCapabilities =
        flowDesign?.missingCapabilities ??
        (payload && 'missingCapabilities' in payload ? payload.missingCapabilities : []) ??
        [];
    const usedTaskGraphFallback = args.result.trace.some(
        event => event.type === 'diagnostic_warn' && event.data?.action === 'task_graph_fallback',
    );
    const usesMockModel =
        args.finalFlow?.nodes.some(
            node =>
                node.blockId === 'ai-generate' &&
                typeof node.config?.model === 'string' &&
                node.config.model.startsWith('mock-'),
        ) ?? false;
    const caveats: string[] = [];

    if (usedTaskGraphFallback) {
        caveats.push('Task-graph classification fell back to a generic template.');
    }
    if (usesMockModel) {
        caveats.push('The final flow still uses a mock AI model configuration.');
    }
    if (missingCapabilities.length > 0) {
        caveats.push(`Missing capabilities remain: ${missingCapabilities.join(', ')}`);
    }

    if (!executionSucceeded) {
        return {
            executionSucceeded: false,
            fulfillmentLevel: 'not-fulfilled',
            summary: 'The run did not complete successfully, so the requirement is not yet fulfilled.',
            caveats,
        };
    }

    if (missingCapabilities.length > 0) {
        return {
            executionSucceeded: true,
            fulfillmentLevel: 'partial',
            summary:
                'The run completed, but the requirement is only partially covered because some capabilities are still missing.',
            caveats,
        };
    }

    if (usedTaskGraphFallback || usesMockModel) {
        return {
            executionSucceeded: true,
            fulfillmentLevel: 'uncertain',
            summary:
                'The run completed successfully, but requirement fulfillment is still uncertain because the design relied on generic fallback or mock execution settings.',
            caveats,
        };
    }

    return {
        executionSucceeded: true,
        fulfillmentLevel: 'fulfilled',
        summary: 'The run completed successfully and the current design appears to fulfill the requirement.',
        caveats,
    };
}

/** Converts a runtime result into the product-facing normalized response shape. */
export function normalizeProductDesignRunResult(
    skillName: ProductFlowSkill,
    result: RuntimeRunResult,
    options: { finalFlow?: FlowDocument } = {},
): ProductDesignRunResult {
    const finalResult = result.finalResult;
    const designDetails = finalResult?.designDetails;
    const requirementAssessment = collectRequirementAssessment({
        result,
        finalFlow: options.finalFlow,
    });

    return {
        skillName,
        runId: result.runId,
        status: result.status,
        summary: finalResult?.summary,
        success: finalResult?.success,
        requirementAssessment,
        nextActions: finalResult?.nextActions ?? [],
        finalResult,
        flowDesign: getFlowDesignDetails(designDetails),
        nodeConfiguration: getNodeConfigurationDetails(designDetails),
        flowDesignerPayload: getFlowDesignerPayload(finalResult?.payload),
        preflightPayload: getFlowPreflightValidatorPayload(finalResult?.payload),
        nodeConfigPayload: getNodeConfigDesignerPayload(finalResult?.payload),
        waitingApproval: result.waitingApproval,
        trace: result.trace,
        finalFlow: options.finalFlow,
    };
}

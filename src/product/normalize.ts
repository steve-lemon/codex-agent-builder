// Normalizers that map runtime-level results into product-facing DTOs.
import { getFlowDesignDetails, getNodeConfigurationDetails } from '../agent/design-details';
import {
    getFlowDesignerPayload,
    getFlowPreflightValidatorPayload,
    getNodeConfigDesignerPayload,
} from '../agent/final-result-payload';
import { isMockLikeRuntimeModel } from '../llm/runtime-model-alias';
import type { RuntimeRunResult } from '../agent/types';
import type { FlowDocument } from '../flow/types';
import { inferFlowOutputContract } from '../flow/output-contract';
import type {
    ProductDesignRunResult,
    ProductFlowSkill,
    RequirementAssessment,
    RequirementAssessmentReason,
} from './types';

function buildRequirementAssessmentSummary(args: {
    executionSucceeded: boolean;
    fulfillmentLevel: RequirementAssessment['fulfillmentLevel'];
    reasons: RequirementAssessmentReason[];
}): string {
    if (!args.executionSucceeded) {
        return 'The run did not complete successfully, so the requirement is not yet fulfilled.';
    }

    if (args.fulfillmentLevel === 'partial') {
        return 'The run completed, but the requirement is only partially covered because some capabilities are still missing.';
    }

    if (args.fulfillmentLevel === 'fulfilled') {
        return 'The run completed successfully and the current design appears to fulfill the requirement.';
    }

    const reasonMessages = args.reasons.map(reason => reason.message.toLowerCase());
    return `The run completed successfully, but requirement fulfillment is still uncertain because ${reasonMessages.join(
        ' and ',
    )}.`;
}

function collectRequirementAssessment(args: {
    result: RuntimeRunResult;
    finalFlow?: FlowDocument;
    outputContract: ProductDesignRunResult['outputContract'];
}): RequirementAssessment {
    // TODO(product): Consider advisor-backed fulfillment scoring so classification,
    // output-contract, and runtime evidence can be weighted more consistently.
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
                isMockLikeRuntimeModel(node.config.model),
        ) ?? false;
    const primaryAiNode = args.finalFlow?.nodes.find(node => node.blockId === 'ai-generate');
    const actualJsonOutput = primaryAiNode?.config?.jsonOutput?.trim().toLowerCase() === 'true';
    const outputSchema = primaryAiNode?.config?.outputSchema?.trim() ?? '';
    const caveats: string[] = [];
    const reasons: RequirementAssessmentReason[] = [];

    if (usedTaskGraphFallback) {
        const message = 'the design relied on a generic task-graph fallback';
        caveats.push('Task-graph classification fell back to a generic template.');
        reasons.push({
            category: 'classification',
            code: 'generic-task-graph-fallback',
            message,
        });
    }
    if (usesMockModel) {
        const message = 'the final flow still uses mock execution settings';
        caveats.push('The final flow still uses a mock AI model configuration.');
        reasons.push({
            category: 'runtime',
            code: 'mock-model-config',
            message,
        });
    }
    if (args.outputContract.format === 'json' && !actualJsonOutput) {
        caveats.push('The final flow did not preserve the requested JSON output contract.');
        reasons.push({
            category: 'output-contract',
            code: 'json-contract-not-preserved',
            message: 'the requested JSON output contract was not preserved',
        });
    }
    if (args.outputContract.format === 'json' && actualJsonOutput && !outputSchema) {
        caveats.push('The final flow enables JSON output but does not define an output schema.');
        reasons.push({
            category: 'output-contract',
            code: 'json-schema-missing',
            message: 'structured JSON output still lacks an explicit output schema',
        });
    }
    if (args.outputContract.format === 'plain-text' && actualJsonOutput) {
        caveats.push('The final flow switched to JSON output even though the request preferred plain text.');
        reasons.push({
            category: 'output-contract',
            code: 'plain-text-format-drift',
            message: 'the flow output format drifted away from the requested plain-text preference',
        });
    }
    if (missingCapabilities.length > 0) {
        caveats.push(`Missing capabilities remain: ${missingCapabilities.join(', ')}`);
        reasons.push({
            category: 'capability',
            code: 'missing-capabilities',
            message: `some capabilities are still missing (${missingCapabilities.join(', ')})`,
        });
    }

    if (!executionSucceeded) {
        reasons.unshift({
            category: 'execution',
            code: 'execution-failed',
            message: 'the run did not complete successfully',
        });
        return {
            executionSucceeded: false,
            fulfillmentLevel: 'not-fulfilled',
            summary: buildRequirementAssessmentSummary({
                executionSucceeded: false,
                fulfillmentLevel: 'not-fulfilled',
                reasons,
            }),
            caveats,
            reasons,
        };
    }

    if (missingCapabilities.length > 0) {
        return {
            executionSucceeded: true,
            fulfillmentLevel: 'partial',
            summary: buildRequirementAssessmentSummary({
                executionSucceeded: true,
                fulfillmentLevel: 'partial',
                reasons,
            }),
            caveats,
            reasons,
        };
    }

    if (reasons.length > 0) {
        return {
            executionSucceeded: true,
            fulfillmentLevel: 'uncertain',
            summary: buildRequirementAssessmentSummary({
                executionSucceeded: true,
                fulfillmentLevel: 'uncertain',
                reasons,
            }),
            caveats,
            reasons,
        };
    }

    return {
        executionSucceeded: true,
        fulfillmentLevel: 'fulfilled',
        summary: buildRequirementAssessmentSummary({
            executionSucceeded: true,
            fulfillmentLevel: 'fulfilled',
            reasons,
        }),
        caveats,
        reasons,
    };
}

function composeProductSummary(args: {
    rawSummary?: string;
    requirementAssessment: RequirementAssessment;
}): string | undefined {
    if (!args.rawSummary) {
        return args.rawSummary;
    }

    const caveatSuffix =
        args.requirementAssessment.caveats.length > 0
            ? ` Caveats: ${args.requirementAssessment.caveats.join(' ')}`
            : '';

    switch (args.requirementAssessment.fulfillmentLevel) {
        case 'fulfilled':
            return args.rawSummary;
        case 'uncertain':
            return `${args.rawSummary} Current requirement assessment: ${args.requirementAssessment.summary}${caveatSuffix}`.trim();
        case 'partial':
            return `${args.rawSummary} Current requirement assessment: ${args.requirementAssessment.summary}${caveatSuffix}`.trim();
        case 'not-fulfilled':
            return `${args.rawSummary} Current requirement assessment: ${args.requirementAssessment.summary}${caveatSuffix}`.trim();
    }
}

/** Converts a runtime result into the product-facing normalized response shape. */
export function normalizeProductDesignRunResult(
    skillName: ProductFlowSkill,
    result: RuntimeRunResult,
    options: { finalFlow?: FlowDocument } = {},
): ProductDesignRunResult {
    const finalResult = result.finalResult;
    const userInput =
        result.trace.find(event => event.type === 'run_start')?.data?.userInput ??
        result.trace[0]?.data?.userInput ??
        '';
    const outputContract = inferFlowOutputContract(String(userInput));
    const designDetails = finalResult?.designDetails;
    const requirementAssessment = collectRequirementAssessment({
        result,
        finalFlow: options.finalFlow,
        outputContract,
    });

    return {
        skillName,
        runId: result.runId,
        status: result.status,
        summary: composeProductSummary({
            rawSummary: finalResult?.summary,
            requirementAssessment,
        }),
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
        outputContract,
    };
}

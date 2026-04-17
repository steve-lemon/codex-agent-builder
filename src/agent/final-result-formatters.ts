// Skill-specific final-result formatters used by gateway implementations.
import { createEmptyFlowDesignDetailsDto, toFlowDesignDetailsDto } from '../flow/design/dto';
import { createEmptyNodeConfigDesignDetailsDto, toNodeConfigDesignDetailsDto } from '../flow/node-config/design/dto';
import type { FlowOutputContract } from '../flow/output-contract';
import { getFakeFinalCopy } from '../llm/fake-copy';
import { buildFinalResultDesignDetails } from './design-details';
import {
    buildFlowDesignerPayload,
    buildFlowPreflightValidatorPayload,
    buildNodeConfigDesignerPayload,
} from './final-result-payload';
import type { FinalResult, StepResult } from './types';

interface PreflightData {
    feasible?: boolean;
    missingCapabilities?: string[];
    proposedBlocks?: Array<{ blockId: string }>;
}

interface ReflectionData {
    satisfied?: boolean;
    issues?: string[];
    improvementNotes?: string[];
    nodeConfigSkillImprovements?: string[];
    nodeConfigStrategyDirectives?: Array<{
        strategyId: string;
        note: string;
    }>;
}

interface NodeConfigurationData {
    flow?: {
        nodes?: Array<{
            blockId?: string;
            config?: Record<string, string>;
        }>;
    };
    suggestions?: Array<{ nodeId: string }>;
    appliedStrategyIds?: string[];
    nodeStrategyAssignments?: Array<{ nodeId: string; strategyId: string }>;
    probeInsightsApplied?: string[];
}

interface IntentData {
    outputContract?: FlowOutputContract;
    wantsJson?: boolean;
}

function findToolData<T>(stepResults: StepResult[], toolName: string): T | undefined {
    const step = stepResults.find(result => JSON.stringify(result).includes(`"toolName":"${toolName}"`)) as
        | { toolResults?: Array<{ data?: T }> }
        | undefined;

    return step?.toolResults?.[0]?.data;
}

function findAllToolData<T>(stepResults: StepResult[], toolName: string): T[] {
    return stepResults
        .filter(result => JSON.stringify(result).includes(`"toolName":"${toolName}"`))
        .map(result => (result as { toolResults?: Array<{ data?: T }> }).toolResults?.[0]?.data)
        .filter((value): value is T => value !== undefined);
}

function findPrimaryAiNodeConfiguration(nodeConfiguration?: NodeConfigurationData) {
    return nodeConfiguration?.flow?.nodes?.find(node => node.blockId === 'ai-generate');
}

function describeOutputContractState(
    outputContract: FlowOutputContract | undefined,
    nodeConfiguration?: NodeConfigurationData,
): {
    summarySuffix?: string;
    nextAction?: string;
} {
    if (!outputContract) {
        return {};
    }

    const aiNode = findPrimaryAiNodeConfiguration(nodeConfiguration);
    const jsonOutputEnabled = aiNode?.config?.jsonOutput?.trim().toLowerCase() === 'true';
    const outputSchema = aiNode?.config?.outputSchema?.trim() ?? '';

    if (outputContract.format === 'json') {
        if (!jsonOutputEnabled) {
            return {
                summarySuffix: ' The configured flow did not preserve the requested JSON output contract.',
                nextAction: 'Align the AI node output mode with the requested JSON contract.',
            };
        }
        if (!outputSchema) {
            return {
                summarySuffix: ' The configured flow enables JSON output but still lacks an explicit output schema.',
                nextAction: 'Add an explicit output schema for the requested JSON response.',
            };
        }
    }

    if (outputContract.format === 'plain-text' && jsonOutputEnabled) {
        return {
            summarySuffix: ' The configured flow drifted toward JSON output even though the request preferred plain text.',
            nextAction: 'Restore the plain-text output mode requested by the user.',
        };
    }

    return {};
}

/** Formats the final result for a `flow-preflight-validator` run. */
export function formatFlowPreflightValidatorFinalResult(stepResults: StepResult[]): FinalResult {
    const preflightData = findToolData<PreflightData>(stepResults, 'prevalidateFlowDesignRequest');

    return {
        summary:
            preflightData?.feasible === false
                ? `Handled with skill flow-preflight-validator. The inferred task graph is not feasible with current blocks. Missing capabilities: ${(
                      preflightData?.missingCapabilities ?? []
                  ).join(', ')}.`
                : 'Handled with skill flow-preflight-validator. The inferred task graph is feasible with the current blocks.',
        success: preflightData?.feasible !== false,
        nextActions:
            preflightData?.feasible === false
                ? [
                      `Review proposed blocks: ${(preflightData?.proposedBlocks ?? [])
                          .map(block => block.blockId)
                          .join(', ')}`,
                      `Add capabilities: ${(preflightData?.missingCapabilities ?? []).join(', ')}`,
                  ]
                : ['Proceed to flow design'],
        payload: buildFlowPreflightValidatorPayload({
            feasible: preflightData?.feasible !== false,
            missingCapabilities: preflightData?.missingCapabilities ?? [],
            proposedBlockIds: (preflightData?.proposedBlocks ?? []).map(block => block.blockId),
        }),
        designDetails: buildFinalResultDesignDetails({
            flowDesign: toFlowDesignDetailsDto({
                improvements:
                    preflightData?.feasible === false
                        ? [`Add capabilities: ${(preflightData?.missingCapabilities ?? []).join(', ')}`]
                        : [],
                feasible: preflightData?.feasible !== false,
                missingCapabilities: preflightData?.missingCapabilities ?? [],
            }),
        }),
    };
}

/** Formats the final result for a `node-config-designer` run. */
export async function formatNodeConfigDesignerFinalResult(): Promise<FinalResult> {
    const fakeFinalCopy = await getFakeFinalCopy();
    return {
        summary: fakeFinalCopy.nodeConfigDesigner.summary,
        success: true,
        nextActions: [...fakeFinalCopy.nodeConfigDesigner.nextActions],
        payload: buildNodeConfigDesignerPayload({
            requiresExistingFlowDraft: true,
            suggestedNextTools: ['designFlowNodeConfigurations', 'validateFlowNodeConfigurations'],
        }),
        designDetails: buildFinalResultDesignDetails({
            nodeConfiguration: createEmptyNodeConfigDesignDetailsDto({
                improvements: [...fakeFinalCopy.nodeConfigDesigner.improvements],
            }),
        }),
    };
}

/** Formats the final result for a `flow-designer` run. */
export async function formatFlowDesignerFinalResult(stepResults: StepResult[]): Promise<FinalResult> {
    const fakeFinalCopy = await getFakeFinalCopy();
    const feasibilityData = findToolData<PreflightData>(stepResults, 'prevalidateFlowDesignRequest');
    const reflections = findAllToolData<ReflectionData>(stepResults, 'reflectFlowResult');
    const refinedGraphs = stepResults.filter(result => JSON.stringify(result).includes('"toolName":"refineTaskGraph"'));
    const nodeConfigurations = findAllToolData<NodeConfigurationData>(stepResults, 'designFlowNodeConfigurations');

    // TODO(flow-agent): Persist pass-by-pass design details instead of only the
    // last configured snapshot so UIs can show how strategy assignments changed
    // across retries.

    if (feasibilityData?.feasible === false) {
        const missingCapabilities = feasibilityData.missingCapabilities ?? [];
        return {
            summary: `Handled with skill flow-designer. The request is not feasible with current blocks because these capabilities are missing: ${missingCapabilities.join(
                ', ',
            )}.`,
            success: false,
            nextActions: [
                `Review proposed blocks: ${(feasibilityData.proposedBlocks ?? [])
                    .map(block => block.blockId)
                    .join(', ')}`,
                `Add blocks or tools for: ${missingCapabilities.join(', ')}`,
                'Retry flow design after the missing capabilities are available',
            ],
            payload: buildFlowDesignerPayload({
                feasible: false,
                missingCapabilities,
            }),
            designDetails: buildFinalResultDesignDetails({
                flowDesign: toFlowDesignDetailsDto({
                    improvements: [
                        `Add missing capabilities before attempting another flow design pass: ${missingCapabilities.join(
                            ', ',
                        )}`,
                    ],
                    feasible: false,
                    missingCapabilities,
                }),
            }),
        };
    }

    const latestReflection = reflections[reflections.length - 1];
    const latestConfiguration = nodeConfigurations[nodeConfigurations.length - 1];
    const analyzedIntent = findToolData<IntentData>(stepResults, 'analyzeFlowRequest');
    const outputContractState = describeOutputContractState(analyzedIntent?.outputContract, latestConfiguration);
    const latestNodeConfigImprovements = latestReflection?.nodeConfigSkillImprovements ?? [];
    const designPassCount = Math.max(reflections.length, 1);
    const taskGraphRefinementCount = refinedGraphs.length;
    const configuredNodeCount = latestConfiguration?.suggestions?.length ?? 0;
    const probeInsightCount = latestConfiguration?.probeInsightsApplied?.length ?? 0;
    const nodeConfigurationDetails = latestConfiguration
        ? toNodeConfigDesignDetailsDto(latestConfiguration, latestNodeConfigImprovements)
        : createEmptyNodeConfigDesignDetailsDto({
              improvements: latestNodeConfigImprovements,
          });

    if (latestReflection?.satisfied === false) {
        return {
            summary: `Handled with skill flow-designer. The flow still needs improvement after ${designPassCount} design pass(es) while configuring ${configuredNodeCount} node(s).`,
            success: false,
            nextActions: [
                ...(outputContractState.nextAction ? [outputContractState.nextAction] : []),
                ...(latestReflection.issues ?? []).slice(0, 2).map(issue => `Address issue: ${issue}`),
                ...(latestReflection.improvementNotes ?? []).slice(0, 2).map(note => `Retry with improvement: ${note}`),
                ...latestNodeConfigImprovements.slice(0, 2).map(note => `Update node-config strategy: ${note}`),
            ],
            payload: buildFlowDesignerPayload({
                feasible: true,
                designPassCount,
                taskGraphRefinementCount,
                configuredNodeCount,
                probeInsightCount,
            }),
            designDetails: buildFinalResultDesignDetails({
                flowDesign: toFlowDesignDetailsDto({
                    improvements: latestReflection.issues ?? [],
                    feasible: true,
                    missingCapabilities: [],
                    designPassCount,
                    taskGraphRefinementCount,
                }),
                nodeConfiguration: nodeConfigurationDetails,
            }),
        };
    }

    if (latestReflection?.satisfied === true) {
        return {
            summary: `Handled with skill flow-designer. The flow executed successfully after ${designPassCount} design pass(es), ${taskGraphRefinementCount} task-graph refinement step(s), and ${configuredNodeCount} configured node(s)${
                probeInsightCount > 0 ? ` informed by ${probeInsightCount} probe insight(s)` : ''
            }. The current reflection judged the result satisfactory for the request based on the available sample validation.${outputContractState.summarySuffix ?? ''}`,
            success: true,
            nextActions:
                designPassCount > 1
                    ? [
                          ...(outputContractState.nextAction ? [outputContractState.nextAction] : []),
                          'Review the revised flow draft and keep the applied improvement notes for future runs',
                      ]
                    : [
                          ...(outputContractState.nextAction ? [outputContractState.nextAction] : []),
                          'Review the generated flow and sample output',
                      ],
            payload: buildFlowDesignerPayload({
                feasible: true,
                designPassCount,
                taskGraphRefinementCount,
                configuredNodeCount,
                probeInsightCount,
            }),
            designDetails: buildFinalResultDesignDetails({
                flowDesign: toFlowDesignDetailsDto({
                    improvements: latestReflection.improvementNotes ?? [],
                    feasible: true,
                    missingCapabilities: [],
                    designPassCount,
                    taskGraphRefinementCount,
                }),
                nodeConfiguration: nodeConfigurationDetails,
            }),
        };
    }

    return {
        summary: `Handled with skill flow-designer. No reflection result was produced.${outputContractState.summarySuffix ?? ''}`,
        success: true,
        nextActions: [...(outputContractState.nextAction ? [outputContractState.nextAction] : []), fakeFinalCopy.generic.reviewTraceLogs],
        payload: buildFlowDesignerPayload({
            feasible: true,
            designPassCount,
            taskGraphRefinementCount,
            configuredNodeCount,
            probeInsightCount,
        }),
        designDetails: buildFinalResultDesignDetails({
            flowDesign: createEmptyFlowDesignDetailsDto({
                feasible: true,
                designPassCount,
                taskGraphRefinementCount,
            }),
            nodeConfiguration: nodeConfigurationDetails,
        }),
    };
}

/** Formats a generic fallback final result when no specialized formatter applies. */
export async function formatGenericFinalResult(skillName: string, stepResults: StepResult[]): Promise<FinalResult> {
    const fakeFinalCopy = await getFakeFinalCopy();
    return {
        summary: `Handled with skill ${skillName}. Processed ${stepResults.length} step results.`,
        success: true,
        nextActions: [fakeFinalCopy.generic.reviewTraceLogs],
        designDetails: buildFinalResultDesignDetails({
            flowDesign: createEmptyFlowDesignDetailsDto(),
            nodeConfiguration: createEmptyNodeConfigDesignDetailsDto(),
        }),
    };
}

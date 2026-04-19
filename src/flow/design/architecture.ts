import type { ProductDesignRunResult } from '../../product/types';
import { inferFlowOutputContract } from '../output-contract';
import { getFlowDesignSampleInputDefaults } from './resources';
import type {
    ArchitectureKnowledgeResourceRecord,
    DesignBriefRecord,
    ArchitectureReviewRecord,
} from './architecture-schemas';
import type { FlowDesignIntent, FlowDesignRequestNormalization } from './types';
import { loadArchitectureKnowledgeResource } from './architecture-resources';

function unique(values: string[]): string[] {
    return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function detectConcreteGraphJson(userRequest: string): boolean {
    return (
        /[\{\[]/.test(userRequest) &&
        (((/"nodes"\s*:/.test(userRequest) || /["']nodes["']\s*:/.test(userRequest)) &&
            (/"edges"\s*:/.test(userRequest) || /["']edges["']\s*:/.test(userRequest))) ||
            /"blockId"\s*:/.test(userRequest) ||
            /["']blockId["']\s*:/.test(userRequest))
    );
}

function inferOperationModel(userRequest: string, taskType: string): DesignBriefRecord['mission']['operationModel'] {
    const lowered = `${userRequest} ${taskType}`.toLowerCase();
    const operations: DesignBriefRecord['mission']['operationModel'] = [];

    if (/count|카운트|개수|수를 세/.test(lowered)) {
        operations.push('count');
    }
    if (/extract|추출/.test(lowered)) {
        operations.push('extract');
    }
    if (/transform|변환|분리/.test(lowered)) {
        operations.push('transform');
    }
    if (/summarize|요약/.test(lowered)) {
        operations.push('summarize');
    }
    if (/explain|설명|무엇을 하는지|의미|용도/.test(lowered)) {
        operations.push('explain');
    }
    if (/generate|생성|만들/.test(lowered)) {
        operations.push('generate');
    }
    if (/validate|검증/.test(lowered)) {
        operations.push('validate');
    }
    if (/classify|분류/.test(lowered)) {
        operations.push('classify');
    }
    if (operations.length === 0) {
        operations.push('transform');
    }

    return unique(operations) as DesignBriefRecord['mission']['operationModel'];
}

function mapOutputFormat(
    outputContract: ReturnType<typeof inferFlowOutputContract>,
): DesignBriefRecord['outputContract']['format'] {
    if (outputContract.format === 'json') {
        return 'json';
    }
    if (outputContract.format === 'plain-text' && /markdown|md/i.test('plain-text')) {
        return 'markdown';
    }
    if (outputContract.format === 'plain-text') {
        return 'plain-text';
    }
    return 'unspecified';
}

function inferInputFormat(userRequest: string): DesignBriefRecord['inputContract']['format'] {
    const lowered = userRequest.toLowerCase();
    const mentionsJson = lowered.includes('json');
    const mentionsText = lowered.includes('text') || lowered.includes('텍스트') || lowered.includes('문장');

    if (mentionsJson && mentionsText) {
        return 'mixed';
    }
    if (mentionsJson) {
        return 'json';
    }
    if (mentionsText) {
        return 'text';
    }
    return 'unknown';
}

function buildMissionSummary(
    userRequest: string,
    taskType: string,
    operationModel: DesignBriefRecord['mission']['operationModel'],
): string {
    if (operationModel.includes('count')) {
        return `Count the requested elements for task type ${taskType}.`;
    }
    if (operationModel.includes('explain')) {
        return `Explain the meaning or purpose of the provided input for task type ${taskType}.`;
    }
    if (operationModel.includes('generate')) {
        return `Generate the requested output for task type ${taskType}.`;
    }
    return `Satisfy the user request for task type ${taskType}.`;
}

function makeRepresentativeSample(intent: FlowDesignIntent): DesignBriefRecord['validationPlan']['sampleCases'] {
    const baseCase = {
        id: 'representative',
        role: 'representative' as const,
        source:
            intent.sampleInputSource && intent.sampleInputSource !== 'default'
                ? ('synthetic' as const)
                : ('inferred' as const),
        input: intent.sampleInput,
        assertions: [] as string[],
    };

    if (intent.taskType.includes('graph') || intent.sampleInputSource === 'synthetic-graph-json') {
        return [
            {
                ...baseCase,
                assertions: ['The explanation should describe major nodes, edges, and overall purpose.'],
            },
        ];
    }

    if (/count|카운트|개수|count/.test(intent.userRequest.toLowerCase())) {
        return [
            {
                ...baseCase,
                assertions: ['The output must preserve exact counts for the representative sample.'],
            },
        ];
    }

    return [
        {
            ...baseCase,
            assertions: ['The output should satisfy the core transformation implied by the request.'],
        },
    ];
}

function matchesKnowledge(args: {
    resourceEntryMatch: ArchitectureKnowledgeResourceRecord['heuristics'][number]['match'];
    operationModel: DesignBriefRecord['mission']['operationModel'];
    taskType: string;
    sampleInputSource?: FlowDesignIntent['sampleInputSource'];
    outputFormat: DesignBriefRecord['outputContract']['format'];
}): boolean {
    const match = args.resourceEntryMatch ?? {};
    if (match.operationModels && !match.operationModels.some(item => args.operationModel.includes(item))) {
        return false;
    }
    if (match.taskTypes && !match.taskTypes.includes(args.taskType)) {
        return false;
    }
    if (match.sampleSource && !match.sampleSource.includes(args.sampleInputSource ?? 'default')) {
        return false;
    }
    if (match.outputFormats && !match.outputFormats.includes(args.outputFormat)) {
        return false;
    }
    return true;
}

function isFlowDesignIntent(input: FlowDesignIntent | FlowDesignRequestNormalization): input is FlowDesignIntent {
    return 'sampleInput' in input;
}

async function resolveArchitectureSample(input: FlowDesignIntent | FlowDesignRequestNormalization) {
    if (isFlowDesignIntent(input)) {
        return {
            sampleInput: input.sampleInput,
            sampleInputSource: input.sampleInputSource,
        };
    }
    const defaults = await getFlowDesignSampleInputDefaults(input.taskType, input.userRequest);
    return {
        sampleInput: defaults.sampleInput,
        sampleInputSource: defaults.source,
    };
}

export async function buildDesignBrief(
    input: FlowDesignIntent | FlowDesignRequestNormalization,
): Promise<DesignBriefRecord> {
    const knowledge = await loadArchitectureKnowledgeResource();
    const { sampleInput, sampleInputSource } = await resolveArchitectureSample(input);
    const operationModel = inferOperationModel(input.userRequest, input.taskType);
    const outputFormat = mapOutputFormat(input.outputContract);
    const concreteGraphJson = detectConcreteGraphJson(input.userRequest);
    const inputSource: DesignBriefRecord['inputContract']['source'] =
        sampleInputSource && sampleInputSource !== 'default'
            ? 'synthetic'
            : concreteGraphJson
            ? 'user-provided'
            : 'inferred';

    const representativeSamples = makeRepresentativeSample({
        ...input,
        sampleInput,
        sampleInputSource,
    });
    const heuristicMatches = knowledge.heuristics.filter(entry =>
        matchesKnowledge({
            resourceEntryMatch: entry.match,
            operationModel,
            taskType: input.taskType,
            sampleInputSource,
            outputFormat,
        }),
    );
    const validationMatches = knowledge.validationPatterns.filter(entry =>
        matchesKnowledge({
            resourceEntryMatch: entry.match,
            operationModel,
            taskType: input.taskType,
            sampleInputSource,
            outputFormat,
        }),
    );
    const riskMatches = knowledge.knownRisks.filter(entry =>
        matchesKnowledge({
            resourceEntryMatch: entry.match,
            operationModel,
            taskType: input.taskType,
            sampleInputSource,
            outputFormat,
        }),
    );
    const qualityBarMatches = knowledge.qualityBars.filter(entry =>
        matchesKnowledge({
            resourceEntryMatch: entry.match,
            operationModel,
            taskType: input.taskType,
            sampleInputSource,
            outputFormat,
        }),
    );

    const executionStrategy =
        heuristicMatches.find(entry => entry.guidance.executionPosture)?.guidance.executionPosture ??
        (operationModel.includes('count')
            ? 'deterministic-first'
            : operationModel.includes('explain')
            ? 'ai-first'
            : 'hybrid');
    const fulfillmentCeiling =
        qualityBarMatches[0]?.fulfillmentCeiling ?? (inputSource === 'synthetic' ? 'uncertain' : 'fulfilled');
    const validationAssertions = unique([
        ...representativeSamples.flatMap(item => item.assertions),
        ...validationMatches.flatMap(entry => entry.assertions ?? []),
    ]);
    const successCriteria = unique([
        ...(input.desiredCount > 1
            ? [`Produce exactly ${input.desiredCount} useful outputs.`]
            : ['Produce one useful output.']),
        ...validationMatches.flatMap(entry => entry.successCriteria ?? []),
        ...(outputFormat === 'json' ? ['Preserve the requested JSON output contract.'] : []),
        ...(outputFormat === 'markdown' ? ['Preserve the requested markdown explanation format.'] : []),
    ]);
    const designPrinciples = unique([
        ...heuristicMatches.flatMap(entry => entry.guidance.designPrinciples ?? []),
        ...(operationModel.includes('count') ? ['Keep the count logic exact and easy to validate.'] : []),
        ...(operationModel.includes('explain')
            ? ['Keep the explanation grounded in the observed structure rather than vague prose.']
            : []),
        ...(inputSource === 'synthetic'
            ? ['Do not overstate fulfillment when only synthetic evidence is available.']
            : []),
    ]);
    const riskFlags = unique(riskMatches.flatMap(entry => entry.note));
    const strategicAssumptions = unique([
        ...heuristicMatches.flatMap(entry => entry.guidance.assumptions ?? []),
        ...(inputSource !== 'user-provided'
            ? [
                  'Representative validation may require inferred or synthetic evidence because the request does not include full concrete input.',
              ]
            : []),
    ]).map(statement => ({
        statement,
        source: statement.includes('Representative validation') ? ('inferred' as const) : ('knowledge' as const),
    }));
    const knowledgeReferences = [
        ...heuristicMatches.map(entry => ({
            resourceId: 'flow-design.architecture-knowledge',
            noteId: entry.id,
            appliedTo: 'execution-posture',
            summary:
                (entry.guidance.rationale ?? entry.guidance.designPrinciples ?? ['Applied heuristic guidance.'])[0] ??
                'Applied heuristic guidance.',
        })),
        ...validationMatches.map(entry => ({
            resourceId: 'flow-design.architecture-knowledge',
            noteId: entry.id,
            appliedTo: 'validation-plan',
            summary:
                (entry.assertions ?? entry.successCriteria ?? ['Applied validation guidance.'])[0] ??
                'Applied validation guidance.',
        })),
        ...riskMatches.map(entry => ({
            resourceId: 'flow-design.architecture-knowledge',
            noteId: entry.id,
            appliedTo: 'risk-review',
            summary: entry.note[0] ?? 'Applied risk guidance.',
        })),
        ...qualityBarMatches.map(entry => ({
            resourceId: 'flow-design.architecture-knowledge',
            noteId: entry.id,
            appliedTo: 'fulfillment-ceiling',
            summary: `Fulfillment should not exceed ${entry.fulfillmentCeiling}.`,
        })),
    ];

    return {
        mission: {
            summary: buildMissionSummary(input.userRequest, input.taskType, operationModel),
            goal: input.userRequest,
            operationModel,
        },
        inputContract: {
            format: inferInputFormat(input.userRequest),
            source: inputSource,
            concreteInputPresent: inputSource === 'user-provided',
            missingRequiredInput:
                inputSource !== 'user-provided' &&
                operationModel.includes('explain') &&
                input.userRequest.toLowerCase().includes('json'),
            notes: unique([
                ...(sampleInputSource === 'synthetic-graph-json'
                    ? ['A conservative synthetic graph JSON sample is being used for design-time validation.']
                    : []),
            ]),
        },
        outputContract: {
            format: outputFormat,
            structured: input.outputContract.format === 'json',
            cardinality: input.desiredCount > 1 ? 'multiple' : 'single',
            schemaExpectation:
                outputFormat === 'json' ? 'machine-readable object or array matching the request contract' : undefined,
        },
        executionPosture: {
            strategy: executionStrategy,
            rationale: unique([
                ...heuristicMatches.flatMap(entry => entry.guidance.rationale ?? []),
                ...(executionStrategy === 'deterministic-first'
                    ? ['This task is easier to validate exactly when deterministic capability is available.']
                    : executionStrategy === 'ai-first'
                    ? ['This task primarily depends on interpretation or explanation quality.']
                    : [
                          'A mixed approach is appropriate because both structural constraints and generative reasoning matter.',
                      ]),
            ]),
        },
        successCriteria,
        validationPlan: {
            sampleCases: representativeSamples,
            assertions: validationAssertions,
            confidenceCeiling: fulfillmentCeiling,
        },
        designPrinciples,
        riskFlags,
        strategicAssumptions,
        knowledgeReferences,
    };
}

export function buildArchitectureReview(args: {
    brief: DesignBriefRecord;
    result: ProductDesignRunResult;
    reviewRules?: ArchitectureKnowledgeResourceRecord['reviewRules'];
}): ArchitectureReviewRecord {
    const reviewRules = args.reviewRules ?? [];
    const findings: string[] = [];
    const adjustments: string[] = [];

    if (!args.result.requirementAssessment.executionSucceeded) {
        findings.push('Execution did not finish successfully, so the strategy could not be fully validated.');
        adjustments.push('Stabilize the tactical execution path before trusting the current strategy.');
    }

    if (args.brief.inputContract.source === 'synthetic') {
        findings.push('Validation relied on synthetic evidence rather than a real user-provided sample.');
        adjustments.push(
            'Re-run validation against a real representative input before upgrading fulfillment confidence.',
        );
    }

    if (args.result.requirementAssessment.fulfillmentLevel === 'uncertain') {
        findings.push('Current fulfillment remains uncertain under the architecture confidence ceiling.');
    }

    if (
        args.result.requirementAssessment.reasons.some(reason => reason.code === 'generic-task-graph-fallback') &&
        args.brief.mission.operationModel.some(operation => operation !== 'generate' && operation !== 'transform')
    ) {
        findings.push(
            'The tactical flow stayed on a generic task-graph fallback despite a more specific strategic operation model.',
        );
        adjustments.push(
            'Align task-graph selection more closely with the architecture brief before trusting generic fallback flow shapes.',
        );
    }

    for (const rule of reviewRules) {
        const match = matchesKnowledge({
            resourceEntryMatch: rule.match,
            operationModel: args.brief.mission.operationModel,
            taskType: 'architecture-review',
            sampleInputSource: args.brief.inputContract.source === 'synthetic' ? 'synthetic-graph-json' : 'default',
            outputFormat: args.brief.outputContract.format,
        });
        if (!match) {
            continue;
        }
        findings.push(...(rule.findings ?? []));
        adjustments.push(...(rule.adjustments ?? []));
    }

    return {
        strategyFit: args.result.status === 'completed' ? 'good' : 'mixed',
        evidenceAdequacy:
            args.brief.validationPlan.sampleCases.length >= 1 && args.brief.validationPlan.assertions.length > 0
                ? args.brief.inputContract.source === 'synthetic'
                    ? 'thin'
                    : 'sufficient'
                : 'insufficient',
        syntheticReliance:
            args.brief.inputContract.source === 'synthetic'
                ? 'high'
                : args.brief.inputContract.source === 'inferred'
                ? 'bounded'
                : 'none',
        keyFindings: unique(findings),
        recommendedAdjustments: unique(adjustments),
    };
}

export interface PlannerStrategyBrief {
    mission: string;
    operationModel: string[];
    executionPosture: DesignBriefRecord['executionPosture']['strategy'];
    outputFormat: DesignBriefRecord['outputContract']['format'];
    confidenceCeiling: DesignBriefRecord['validationPlan']['confidenceCeiling'];
    riskFlags: string[];
    designPrinciples: string[];
    sampleSource: DesignBriefRecord['inputContract']['source'];
}

export function summarizeDesignBriefForPlanner(brief: DesignBriefRecord): PlannerStrategyBrief {
    return {
        mission: brief.mission.summary,
        operationModel: [...brief.mission.operationModel],
        executionPosture: brief.executionPosture.strategy,
        outputFormat: brief.outputContract.format,
        confidenceCeiling: brief.validationPlan.confidenceCeiling,
        riskFlags: [...brief.riskFlags],
        designPrinciples: brief.designPrinciples.slice(0, 4),
        sampleSource: brief.inputContract.source,
    };
}

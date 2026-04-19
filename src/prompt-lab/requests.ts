import type { StructuredGenerationInput } from '../llm/types';
import { defineStructuredSchema } from '../llm/structured-schema';
import type { ProductDesignRunResult } from '../product/types';
import type { AdvisorEvaluationReport } from '../flow/design/advisor-evaluation';
import { getPromptLabManifest } from './manifest';
import { PromptLabCodexPromptSchema, PromptLabSelfReviewSchema } from './schemas';
import type {
    PromptLabExecutionTimingSummary,
    PromptLabLanguage,
    PromptLabSelfReview,
    PromptLabSessionRecord,
} from './types';

function buildRunSnapshot(
    session: PromptLabSessionRecord,
    result: ProductDesignRunResult,
    advisorEvaluation?: AdvisorEvaluationReport,
    executionTiming?: PromptLabExecutionTimingSummary,
) {
    return {
        sessionId: session.sessionId,
        requirement: session.requirement,
        language: session.config.language,
        provider: session.config.provider,
        mainModel: session.config.mainModel,
        liteModel: session.config.liteModel,
        skillName: result.skillName,
        status: result.status,
        summary: result.summary,
        success: result.success,
        requirementAssessment: result.requirementAssessment,
        nextActions: result.nextActions,
        flowDesign: result.flowDesign,
        nodeConfiguration: result.nodeConfiguration,
        outputContract: result.outputContract,
        architectureBrief: result.architectureBrief,
        architectureReview: result.architectureReview,
        syntheticValidationUsed: result.requirementAssessment.reasons.some(
            reason => reason.code === 'synthetic-sample-validation',
        ),
        executionTiming,
        payload: result.finalResult?.payload,
        trace: result.trace.slice(-20),
        advisorEvaluation: advisorEvaluation
            ? {
                  summary: advisorEvaluation.summary,
                  suitableForLiteUsage: advisorEvaluation.suitableForLiteUsage,
                  overallPassRate: advisorEvaluation.overallPassRate,
                  overallFallbackRate: advisorEvaluation.overallFallbackRate,
                  suites: advisorEvaluation.suites.map(item => ({
                      advisorId: item.advisorId,
                      passRate: item.passRate,
                      fallbackRate: item.fallbackRate,
                      suitability: item.suitability,
                  })),
              }
            : undefined,
    };
}

function buildSelfReviewRunSnapshot(
    session: PromptLabSessionRecord,
    result: ProductDesignRunResult,
    advisorEvaluation?: AdvisorEvaluationReport,
    executionTiming?: PromptLabExecutionTimingSummary,
) {
    return {
        sessionId: session.sessionId,
        requirement: session.requirement,
        language: session.config.language,
        provider: session.config.provider,
        mainModel: session.config.mainModel,
        liteModel: session.config.liteModel,
        skillName: result.skillName,
        status: result.status,
        summary: result.summary,
        success: result.success,
        requirementAssessment: {
            executionSucceeded: result.requirementAssessment.executionSucceeded,
            fulfillmentLevel: result.requirementAssessment.fulfillmentLevel,
            summary: result.requirementAssessment.summary,
            reasons: result.requirementAssessment.reasons.slice(0, 4),
            caveats: result.requirementAssessment.caveats.slice(0, 4),
        },
        architectureBrief: result.architectureBrief
            ? {
                  mission: result.architectureBrief.mission,
                  executionPosture: result.architectureBrief.executionPosture,
                  designPrinciples: result.architectureBrief.designPrinciples.slice(0, 4),
                  validationPlan: {
                      confidenceCeiling: result.architectureBrief.validationPlan.confidenceCeiling,
                      assertions: result.architectureBrief.validationPlan.assertions.slice(0, 4),
                      sampleCases: result.architectureBrief.validationPlan.sampleCases.slice(0, 3).map(item => ({
                          id: item.id,
                          role: item.role,
                          source: item.source,
                          input: item.input,
                          expectedResult: item.expectedResult,
                          assertions: item.assertions.slice(0, 3),
                      })),
                  },
              }
            : undefined,
        architectureReview: result.architectureReview
            ? {
                  strategyFit: result.architectureReview.strategyFit,
                  evidenceAdequacy: result.architectureReview.evidenceAdequacy,
                  syntheticReliance: result.architectureReview.syntheticReliance,
                  keyFindings: result.architectureReview.keyFindings.slice(0, 4),
                  recommendedAdjustments: result.architectureReview.recommendedAdjustments.slice(0, 4),
              }
            : undefined,
        outputContract: result.outputContract,
        syntheticValidationUsed: result.requirementAssessment.reasons.some(
            reason => reason.code === 'synthetic-sample-validation',
        ),
        executionTiming: executionTiming
            ? {
                  totalDurationMs: executionTiming.totalDurationMs,
                  advisorTimingStatus: executionTiming.advisorTimingStatus,
                  stages: executionTiming.stages.slice(0, 8),
              }
            : undefined,
        flowSummary: result.flowDesign
            ? {
                  feasible: result.flowDesign.feasible,
                  missingCapabilities: result.flowDesign.missingCapabilities.slice(0, 6),
                  improvements: result.flowDesign.improvements.slice(0, 4),
              }
            : undefined,
        nodeConfigurationSummary: result.nodeConfiguration
            ? {
                  configuredNodeCount: result.nodeConfiguration.configuredNodeCount,
                  appliedStrategies: result.nodeConfiguration.appliedStrategies.slice(0, 6),
                  nodeStrategyAssignments: result.nodeConfiguration.nodeStrategyAssignments.slice(0, 6),
              }
            : undefined,
        trace: result.trace.slice(-6).map(item => ({
            ts: item.ts,
            type: item.type,
            stage: item.stage,
            message: item.message,
            data: item.data,
        })),
        advisorEvaluation: advisorEvaluation
            ? {
                  summary: advisorEvaluation.summary,
                  suitableForLiteUsage: advisorEvaluation.suitableForLiteUsage,
                  overallPassRate: advisorEvaluation.overallPassRate,
                  overallFallbackRate: advisorEvaluation.overallFallbackRate,
              }
            : undefined,
    };
}

function derivePromptGuardrails(requirement: string, userFeedback: string) {
    const combined = `${requirement}\n${userFeedback}`.toLowerCase();
    const includesAny = (...patterns: RegExp[]) => patterns.some(pattern => pattern.test(combined));

    return {
        allowExamples: includesAny(/예시/, /\bexample\b/, /샘플/),
        allowErrorOutput: includesAny(/오류/, /\berror\b/, /에러/, /exception/),
        allowFallbackRules: includesAny(/fallback/i, /폴백/, /대체 규칙/, /예외 처리/),
        preferJsonOnly: includesAny(/json/, /json만/, /json으로만/, /오직 json/, /only json/, /json object/),
    };
}

export async function buildPromptLabSelfReviewRequest(args: {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    advisorEvaluation?: AdvisorEvaluationReport;
    executionTiming?: PromptLabExecutionTimingSummary;
    language: PromptLabLanguage;
}): Promise<StructuredGenerationInput<typeof PromptLabSelfReviewSchema>> {
    const manifest = await getPromptLabManifest();

    return {
        purpose: 'lite',
        input: [
            {
                role: 'system',
                content: manifest.selfReview.systemPrompt,
            },
            {
                role: 'user',
                content: JSON.stringify({
                    language: args.language,
                    run: buildSelfReviewRunSnapshot(
                        args.session,
                        args.result,
                        args.advisorEvaluation,
                        args.executionTiming,
                    ),
                }),
            },
        ],
        schema: defineStructuredSchema('prompt_lab_self_review', PromptLabSelfReviewSchema),
    };
}

export async function buildPromptLabCodexPromptRequest(args: {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    advisorEvaluation?: AdvisorEvaluationReport;
    selfReview: PromptLabSelfReview;
    userFeedback: string;
    language: PromptLabLanguage;
}): Promise<StructuredGenerationInput<typeof PromptLabCodexPromptSchema>> {
    const manifest = await getPromptLabManifest();

    return {
        purpose: 'lite',
        input: [
            {
                role: 'system',
                content: manifest.codexPrompt.systemPrompt,
            },
            {
                role: 'user',
                content: JSON.stringify({
                    language: args.language,
                    run: buildRunSnapshot(args.session, args.result, args.advisorEvaluation),
                    selfReview: args.selfReview,
                    userFeedback: args.userFeedback,
                    guardrails: derivePromptGuardrails(args.session.requirement, args.userFeedback),
                    outputContract: args.result.outputContract,
                }),
            },
        ],
        schema: defineStructuredSchema('prompt_lab_codex_prompt', PromptLabCodexPromptSchema),
    };
}

export async function buildPromptLabCodexPromptRewriteRequest(args: {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    advisorEvaluation?: AdvisorEvaluationReport;
    selfReview: PromptLabSelfReview;
    userFeedback: string;
    language: PromptLabLanguage;
    draftPrompt: string;
}): Promise<StructuredGenerationInput<typeof PromptLabCodexPromptSchema>> {
    const manifest = await getPromptLabManifest();

    return {
        purpose: 'lite',
        input: [
            {
                role: 'system',
                content: manifest.codexPrompt.rewriteSystemPrompt,
            },
            {
                role: 'user',
                content: JSON.stringify({
                    language: args.language,
                    requirement: args.session.requirement,
                    run: buildRunSnapshot(args.session, args.result, args.advisorEvaluation),
                    selfReview: args.selfReview,
                    userFeedback: args.userFeedback,
                    draftPrompt: args.draftPrompt,
                    guardrails: derivePromptGuardrails(args.session.requirement, args.userFeedback),
                    outputContract: args.result.outputContract,
                }),
            },
        ],
        schema: defineStructuredSchema('prompt_lab_codex_prompt_rewrite', PromptLabCodexPromptSchema),
    };
}

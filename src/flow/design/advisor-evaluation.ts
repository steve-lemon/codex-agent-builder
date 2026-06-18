import { getLiteAdvisorDefinition } from '../../advisors/resources';
import type {
    LiteAdvisorEvaluationScenarioRecord,
    LiteAdvisorEvaluationSuiteRecord,
} from '../../advisors/resource-schemas';
import type { LlmGateway } from '../../llm/types';
import { loadResource } from '../../resources/loader';
import { LlmGatewayFlowAiDelegationAdvisor, type FlowAiDelegationRecommendation } from './ai-delegation';
import {
    LlmBackedFlowDesignTaskGraphAdvisor,
    getFlowDesignTaskGraphCatalog,
    type FlowDesignTaskGraphRecommendation,
} from './task-graphs';
import {
    LlmBackedFlowDesignTaskTypeAdvisor,
    getFlowDesignTaskTypeCatalog,
    type FlowDesignTaskTypeRecommendation,
} from './task-types';

export type AdvisorEvaluationSuitability = 'suitable' | 'borderline' | 'not-suitable' | 'inconclusive';
export type AdvisorEvaluationResolution = 'model' | 'fallback-no-gateway' | 'fallback-threshold' | 'fallback-error';
export type AdvisorEvaluationStatus = 'passed' | 'inconclusive' | 'failed';
export type AdvisorLatencyRisk = 'acceptable' | 'warning' | 'high';

export interface AdvisorEvaluationTimingStats {
    sampleCount: number;
    averageMs: number | null;
    p95Ms: number | null;
    maxMs: number | null;
}

export interface AdvisorEvaluationScenarioResult {
    scenarioId: string;
    label?: string;
    passed: boolean;
    source: 'deterministic' | 'model';
    resolution: AdvisorEvaluationResolution;
    actual: Record<string, unknown>;
    expected: Record<string, unknown>;
    rationale?: string;
    fallbackErrorMessage?: string;
    liteDurationMs?: number;
}

export interface AdvisorEvaluationSuiteResult {
    advisorId: string;
    label: string;
    description?: string;
    passedScenarios: number;
    totalScenarios: number;
    passRate: number;
    liteDecisionRate: number;
    litePassRate: number;
    fallbackRate: number;
    acceptedLiteModel: boolean;
    suitability: AdvisorEvaluationSuitability;
    evaluationStatus: AdvisorEvaluationStatus;
    timing: AdvisorEvaluationTimingStats;
    latencyRisk: AdvisorLatencyRisk;
    summary: string;
    scenarios: AdvisorEvaluationScenarioResult[];
}

export interface AdvisorEvaluationRunComparison {
    previousRecordedAt: string;
    previousSessionId: string;
    deltaLiteDecisionRate: number;
    deltaLitePassRate: number;
    deltaFallbackRate: number;
    deltaAverageLiteDurationMs: number | null;
}

export interface AdvisorEvaluationReport {
    provider: string;
    liteModel: string;
    recordedAt: string;
    suiteCount: number;
    totalScenarios: number;
    overallPassRate: number;
    overallLiteDecisionRate: number;
    overallLitePassRate: number;
    overallFallbackRate: number;
    overallTiming: AdvisorEvaluationTimingStats;
    suitableForLiteUsage: boolean;
    qualitySuitability: AdvisorEvaluationSuitability;
    latencyRisk: AdvisorLatencyRisk;
    summary: string;
    comparison?: AdvisorEvaluationRunComparison;
    suites: AdvisorEvaluationSuiteResult[];
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function computeTimingStats(samples: number[]): AdvisorEvaluationTimingStats {
    if (samples.length === 0) {
        return {
            sampleCount: 0,
            averageMs: null,
            p95Ms: null,
            maxMs: null,
        };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return {
        sampleCount: samples.length,
        averageMs: round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
        p95Ms: round(sorted[p95Index] ?? sorted[sorted.length - 1] ?? 0),
        maxMs: round(sorted[sorted.length - 1] ?? 0),
    };
}

function isExpectedMatch(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
    return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function computeSuitability(args: {
    acceptedLiteModel: boolean;
    liteDecisionRate: number;
    litePassRate: number;
    fallbackRate: number;
    allFallbackErrors: boolean;
}): AdvisorEvaluationSuitability {
    if (args.allFallbackErrors) {
        return 'inconclusive';
    }
    if (args.acceptedLiteModel) {
        return 'suitable';
    }
    if (args.liteDecisionRate >= 0.5 && args.litePassRate >= 0.6 && args.fallbackRate <= 0.5) {
        return 'borderline';
    }
    return 'not-suitable';
}

function computeLatencyRisk(args: {
    averageMs: number | null;
    p95Ms: number | null;
    maxAverageLatencyMs?: number;
    maxP95LatencyMs?: number;
    allFallbackErrors: boolean;
}): AdvisorLatencyRisk {
    if (args.allFallbackErrors || args.averageMs === null) {
        return 'warning';
    }
    const averageExceeded =
        typeof args.maxAverageLatencyMs === 'number' && typeof args.averageMs === 'number'
            ? args.averageMs > args.maxAverageLatencyMs
            : false;
    const p95Exceeded =
        typeof args.maxP95LatencyMs === 'number' && typeof args.p95Ms === 'number'
            ? args.p95Ms > args.maxP95LatencyMs
            : false;
    if (averageExceeded && p95Exceeded) {
        return 'high';
    }
    if (averageExceeded || p95Exceeded) {
        return 'warning';
    }
    return 'acceptable';
}

function buildDecisionTracker() {
    let resolution: AdvisorEvaluationResolution = 'fallback-no-gateway';
    let fallbackErrorMessage: string | undefined;
    let durationMs: number | undefined;

    return {
        onDecision(event: { type: AdvisorEvaluationResolution; error?: unknown; durationMs?: number }) {
            resolution = event.type;
            durationMs = event.durationMs;
            if (event.type === 'fallback-error') {
                fallbackErrorMessage = event.error instanceof Error ? event.error.message : String(event.error);
            }
        },
        snapshot() {
            return {
                resolution,
                fallbackErrorMessage,
                durationMs,
            };
        },
    };
}

async function evaluateTaskTypeScenario(
    gateway: LlmGateway,
    scenario: LiteAdvisorEvaluationScenarioRecord,
): Promise<AdvisorEvaluationScenarioResult> {
    const tracker = buildDecisionTracker();
    const advisor = new LlmBackedFlowDesignTaskTypeAdvisor(gateway, undefined, {
        emitLogs: false,
        onDecision: tracker.onDecision,
    });
    const recommendation: FlowDesignTaskTypeRecommendation = await advisor.recommend({
        userRequest: String(scenario.input.userRequest ?? ''),
        wantsJson: Boolean(scenario.input.wantsJson),
        taskTypes: await getFlowDesignTaskTypeCatalog(),
    });
    const actual = {
        taskType: recommendation.taskType,
        confidence: recommendation.confidence,
    };
    const snapshot = tracker.snapshot();
    return {
        scenarioId: scenario.id,
        label: scenario.label,
        passed: isExpectedMatch(scenario.expected, actual),
        source: recommendation.source,
        resolution: snapshot.resolution,
        actual,
        expected: scenario.expected,
        rationale: recommendation.rationale,
        fallbackErrorMessage: snapshot.fallbackErrorMessage,
        liteDurationMs: snapshot.durationMs,
    };
}

async function evaluateTaskGraphScenario(
    gateway: LlmGateway,
    scenario: LiteAdvisorEvaluationScenarioRecord,
): Promise<AdvisorEvaluationScenarioResult> {
    const tracker = buildDecisionTracker();
    const advisor = new LlmBackedFlowDesignTaskGraphAdvisor(gateway, undefined, {
        emitLogs: false,
        onDecision: tracker.onDecision,
    });
    const recommendation: FlowDesignTaskGraphRecommendation = await advisor.recommend({
        userRequest: String(scenario.input.userRequest ?? ''),
        templates: await getFlowDesignTaskGraphCatalog(),
    });
    const actual = {
        templateId: recommendation.templateId,
        confidence: recommendation.confidence,
    };
    const snapshot = tracker.snapshot();
    return {
        scenarioId: scenario.id,
        label: scenario.label,
        passed: isExpectedMatch(scenario.expected, actual),
        source: recommendation.source,
        resolution: snapshot.resolution,
        actual,
        expected: scenario.expected,
        rationale: recommendation.rationale,
        fallbackErrorMessage: snapshot.fallbackErrorMessage,
        liteDurationMs: snapshot.durationMs,
    };
}

async function evaluateAiDelegationScenario(
    gateway: LlmGateway,
    scenario: LiteAdvisorEvaluationScenarioRecord,
): Promise<AdvisorEvaluationScenarioResult> {
    const tracker = buildDecisionTracker();
    const advisor = new LlmGatewayFlowAiDelegationAdvisor(gateway, {
        emitLogs: false,
        onDecision: tracker.onDecision,
    });
    const recommendation: FlowAiDelegationRecommendation = await advisor.recommend({
        userRequest: String(scenario.input.userRequest ?? ''),
        operation: String(scenario.input.operation ?? ''),
        requiredCapabilities: Array.isArray(scenario.input.requiredCapabilities)
            ? (scenario.input.requiredCapabilities as string[])
            : [],
        expectedInputs: Array.isArray(scenario.input.expectedInputs) ? (scenario.input.expectedInputs as string[]) : [],
        expectedOutputs: Array.isArray(scenario.input.expectedOutputs)
            ? (scenario.input.expectedOutputs as string[])
            : [],
    });
    const actual = {
        delegable: recommendation.delegable,
        confidence: recommendation.confidence,
    };
    const snapshot = tracker.snapshot();
    return {
        scenarioId: scenario.id,
        label: scenario.label,
        passed: isExpectedMatch(scenario.expected, actual),
        source: recommendation.source,
        resolution: snapshot.resolution,
        actual,
        expected: scenario.expected,
        rationale: recommendation.rationale,
        fallbackErrorMessage: snapshot.fallbackErrorMessage,
        liteDurationMs: snapshot.durationMs,
    };
}

async function evaluateSuite(
    gateway: LlmGateway,
    suite: LiteAdvisorEvaluationSuiteRecord,
): Promise<AdvisorEvaluationSuiteResult> {
    const advisorDef = await getLiteAdvisorDefinition('flow-design.advisors', suite.advisorId);
    const scenarios =
        suite.advisorId === 'flow-design.task-type'
            ? await Promise.all(suite.scenarios.map(scenario => evaluateTaskTypeScenario(gateway, scenario)))
            : suite.advisorId === 'flow-design.task-graph'
            ? await Promise.all(suite.scenarios.map(scenario => evaluateTaskGraphScenario(gateway, scenario)))
            : await Promise.all(suite.scenarios.map(scenario => evaluateAiDelegationScenario(gateway, scenario)));

    const passedScenarios = scenarios.filter(item => item.passed).length;
    const fallbackCount = scenarios.filter(item => item.source !== 'model').length;
    const liteDecisionCount = scenarios.filter(item => item.source === 'model').length;
    const litePassedCount = scenarios.filter(item => item.source === 'model' && item.passed).length;
    const fallbackErrorCount = scenarios.filter(item => item.resolution === 'fallback-error').length;
    const passRate = round(passedScenarios / scenarios.length);
    const liteDecisionRate = round(liteDecisionCount / scenarios.length);
    const litePassRate = liteDecisionCount > 0 ? round(litePassedCount / liteDecisionCount) : 0;
    const fallbackRate = round(fallbackCount / scenarios.length);
    const timing = computeTimingStats(
        scenarios.map(item => item.liteDurationMs).filter((value): value is number => typeof value === 'number'),
    );
    const minPassRate = suite.acceptance?.minPassRate ?? 0.8;
    const maxFallbackRate = suite.acceptance?.maxFallbackRate ?? 0.25;
    const acceptedLiteModel = liteDecisionRate > 0 && litePassRate >= minPassRate && fallbackRate <= maxFallbackRate;
    const allFallbackErrors = fallbackErrorCount === scenarios.length;
    const latencyRisk = computeLatencyRisk({
        averageMs: timing.averageMs,
        p95Ms: timing.p95Ms,
        maxAverageLatencyMs: suite.acceptance?.maxAverageLatencyMs,
        maxP95LatencyMs: suite.acceptance?.maxP95LatencyMs,
        allFallbackErrors,
    });
    const suitability = computeSuitability({
        acceptedLiteModel,
        liteDecisionRate,
        litePassRate,
        fallbackRate,
        allFallbackErrors,
    });
    const evaluationStatus: AdvisorEvaluationStatus = allFallbackErrors
        ? 'inconclusive'
        : acceptedLiteModel
        ? 'passed'
        : 'failed';

    return {
        advisorId: suite.advisorId,
        label: suite.label ?? advisorDef.label ?? suite.advisorId,
        description: suite.description ?? advisorDef.description,
        passedScenarios,
        totalScenarios: scenarios.length,
        passRate,
        liteDecisionRate,
        litePassRate,
        fallbackRate,
        acceptedLiteModel,
        suitability,
        evaluationStatus,
        timing,
        latencyRisk,
        summary:
            evaluationStatus === 'inconclusive'
                ? `${
                      suite.label ?? suite.advisorId
                  } could not evaluate the lite model directly because every scenario fell back after advisor execution errors. Average lite attempt latency was ${
                      timing.averageMs ?? 'n/a'
                  } ms.`
                : acceptedLiteModel
                ? `${
                      suite.label ?? suite.advisorId
                  } met the lite-model quality target with lite pass rate ${litePassRate}, fallback rate ${fallbackRate}, and average lite latency ${
                      timing.averageMs ?? 'n/a'
                  } ms. Latency risk is ${latencyRisk}.`
                : `${
                      suite.label ?? suite.advisorId
                  } did not meet the lite-model quality target. Lite decision rate was ${liteDecisionRate}, lite pass rate was ${litePassRate}, fallback rate was ${fallbackRate}, and average lite latency was ${
                      timing.averageMs ?? 'n/a'
                  } ms. Latency risk is ${latencyRisk}.`,
        scenarios,
    };
}

export async function evaluateFlowDesignAdvisors(args: {
    gateway: LlmGateway;
    provider: string;
    liteModel: string;
    comparison?: AdvisorEvaluationRunComparison;
}): Promise<AdvisorEvaluationReport> {
    const resource = await loadResource('flow-design.advisor-evals');
    const suites = await Promise.all(resource.suites.map(suite => evaluateSuite(args.gateway, suite)));
    const totalScenarios = suites.reduce((sum, suite) => sum + suite.totalScenarios, 0);
    const passedScenarios = suites.reduce((sum, suite) => sum + suite.passedScenarios, 0);
    const totalLiteDecisions = suites.reduce(
        (sum, suite) => sum + suite.scenarios.filter(item => item.source === 'model').length,
        0,
    );
    const totalLitePassed = suites.reduce(
        (sum, suite) => sum + suite.scenarios.filter(item => item.source === 'model' && item.passed).length,
        0,
    );
    const totalFallbacks = suites.reduce(
        (sum, suite) => sum + suite.scenarios.filter(item => item.source !== 'model').length,
        0,
    );
    const overallPassRate = totalScenarios > 0 ? round(passedScenarios / totalScenarios) : 0;
    const overallLiteDecisionRate = totalScenarios > 0 ? round(totalLiteDecisions / totalScenarios) : 0;
    const overallLitePassRate = totalLiteDecisions > 0 ? round(totalLitePassed / totalLiteDecisions) : 0;
    const overallFallbackRate = totalScenarios > 0 ? round(totalFallbacks / totalScenarios) : 0;
    const overallTiming = computeTimingStats(
        suites.flatMap(suite =>
            suite.scenarios
                .map(item => item.liteDurationMs)
                .filter((value): value is number => typeof value === 'number'),
        ),
    );
    const qualitySuitability = suites.every(suite => suite.acceptedLiteModel)
        ? 'suitable'
        : suites.every(suite => suite.evaluationStatus === 'inconclusive')
        ? 'inconclusive'
        : suites.some(suite => suite.acceptedLiteModel)
        ? 'borderline'
        : 'not-suitable';
    const latencyRisk: AdvisorLatencyRisk = suites.some(suite => suite.latencyRisk === 'high')
        ? 'high'
        : suites.some(suite => suite.latencyRisk === 'warning')
        ? 'warning'
        : 'acceptable';
    const suitableForLiteUsage = qualitySuitability === 'suitable' && latencyRisk === 'acceptable';
    const allInconclusive = suites.every(suite => suite.evaluationStatus === 'inconclusive');

    return {
        provider: args.provider,
        liteModel: args.liteModel,
        recordedAt: new Date().toISOString(),
        suiteCount: suites.length,
        totalScenarios,
        overallPassRate,
        overallLiteDecisionRate,
        overallLitePassRate,
        overallFallbackRate,
        overallTiming,
        suitableForLiteUsage,
        qualitySuitability,
        latencyRisk,
        summary: allInconclusive
            ? `The current lite model could not be evaluated directly because all advisor scenarios fell back after execution errors. Average lite attempt latency was ${
                  overallTiming.averageMs ?? 'n/a'
              } ms.`
            : suitableForLiteUsage
            ? `The current lite model passed advisor evaluation with lite pass rate ${overallLitePassRate} and average lite latency ${
                  overallTiming.averageMs ?? 'n/a'
              } ms.`
            : qualitySuitability === 'suitable' && latencyRisk !== 'acceptable'
            ? `The current lite model met advisor quality targets, but latency risk is ${latencyRisk}. Lite decision rate was ${overallLiteDecisionRate}, lite pass rate was ${overallLitePassRate}, and average lite latency was ${
                  overallTiming.averageMs ?? 'n/a'
              } ms.`
            : `The current lite model did not fully meet advisor evaluation targets. Lite decision rate was ${overallLiteDecisionRate}, lite pass rate was ${overallLitePassRate}, fallback rate was ${overallFallbackRate}, and average lite latency was ${
                  overallTiming.averageMs ?? 'n/a'
              } ms. Latency risk is ${latencyRisk}.`,
        comparison: args.comparison,
        suites,
    };
}

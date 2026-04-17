import { join } from 'node:path';
import { addDiagnosticListener, removeDiagnosticListener, type DiagnosticListener } from '../diagnostics/logger';
import { AgentError } from '../errors/agent-error';
import { evaluateFlowDesignAdvisors, type AdvisorEvaluationReport } from '../flow/design/advisor-evaluation';
import { FlowDesignProduct } from '../product';
import type { ProductDesignRunResult, ProductFlowSkill } from '../product/types';
import { FakeLlmGateway, GeminiGateway, OpenAiGateway, type LlmGateway } from '../llm';
import {
    appendNdjson,
    appendPromptLabAdvisorEvaluationHistory,
    createPromptLabSession,
    readPromptLabAdvisorEvaluationHistory,
    writeJson,
    writeText,
} from './files';
import { getPromptLabManifest } from './manifest';
import {
    buildPromptLabCodexPromptRequest,
    buildPromptLabCodexPromptRewriteRequest,
    buildPromptLabSelfReviewRequest,
} from './requests';
import type {
    PromptLabAdvisorEvalArtifacts,
    PromptLabArtifactPaths,
    PromptLabCodexPrompt,
    PromptLabExecutionTimingSummary,
    PromptLabEventHooks,
    PromptLabRunArtifacts,
    PromptLabSelfReview,
    PromptLabSessionConfig,
    PromptLabSessionRecord,
} from './types';
import yaml from 'js-yaml';

export interface PromptLabProductOptions {
    productFactory?: (gateway: LlmGateway) => FlowDesignProduct;
}

export class PromptLabRunError extends AgentError {
    constructor(
        message: string,
        public readonly session: PromptLabSessionRecord,
        public readonly paths: PromptLabArtifactPaths,
        public readonly clipboardText: string,
        options?: { cause?: unknown; code?: string },
    ) {
        super(message, {
            cause: options?.cause,
            code: options?.code ?? 'PROMPT_LAB_RUN_FAILED',
        });
    }
}

function assertProviderConfiguration(config: PromptLabSessionConfig): void {
    if (config.provider === 'openai') {
        const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
        const hasProxy = Boolean(process.env.OPENAI_STRUCTURED_PROXY_URL);
        if (!hasApiKey && !hasProxy) {
            throw new AgentError(
                'Prompt Lab cannot start with OpenAI because neither OPENAI_API_KEY nor OPENAI_STRUCTURED_PROXY_URL is configured.',
                {
                    code: 'PROMPT_LAB_OPENAI_NOT_CONFIGURED',
                },
            );
        }
        return;
    }

    if (config.provider === 'gemini') {
        const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
        if (!hasGeminiKey) {
            throw new AgentError(
                'Prompt Lab cannot start with Gemini because GEMINI_API_KEY or GOOGLE_API_KEY is missing.',
                {
                    code: 'PROMPT_LAB_GEMINI_NOT_CONFIGURED',
                },
            );
        }
    }
}

function createGateway(config: PromptLabSessionConfig): LlmGateway {
    assertProviderConfiguration(config);

    if (config.provider === 'openai') {
        return new OpenAiGateway({ model: config.mainModel, liteModel: config.liteModel });
    }

    if (config.provider === 'gemini') {
        return new GeminiGateway({ model: config.mainModel, liteModel: config.liteModel });
    }

    return new FakeLlmGateway();
}

async function runFlowSkill(
    product: FlowDesignProduct,
    skillName: ProductFlowSkill,
    requirement: string,
    hooks?: PromptLabEventHooks,
) {
    if (skillName === 'flow-preflight-validator') {
        return await product.preflight(requirement, hooks);
    }
    if (skillName === 'node-config-designer') {
        return await product.designNodeConfiguration(requirement, hooks);
    }
    return await product.design(requirement, hooks);
}

function renderCodexPromptMarkdown(prompt: PromptLabCodexPrompt): string {
    return [
        `# ${prompt.title}`,
        '',
        prompt.summary,
        '',
        '## Prompt',
        '',
        prompt.codexPrompt,
        '',
        '## Usage Notes',
        '',
        ...prompt.usageNotes.map(note => `- ${note}`),
        '',
    ].join('\n');
}

function renderAdvisorEvaluationMarkdown(report: AdvisorEvaluationReport): string {
    return [
        '# Advisor Evaluation',
        '',
        `- Provider: ${report.provider}`,
        `- Lite Model: ${report.liteModel}`,
        `- Recorded At: ${report.recordedAt}`,
        `- Overall Scenario Pass Rate: ${report.overallPassRate}`,
        `- Overall Lite Decision Rate: ${report.overallLiteDecisionRate}`,
        `- Overall Lite Pass Rate: ${report.overallLitePassRate}`,
        `- Overall Fallback Rate: ${report.overallFallbackRate}`,
        `- Average Lite Latency (ms): ${report.overallTiming.averageMs ?? 'n/a'}`,
        `- P95 Lite Latency (ms): ${report.overallTiming.p95Ms ?? 'n/a'}`,
        `- Max Lite Latency (ms): ${report.overallTiming.maxMs ?? 'n/a'}`,
        `- Suitable For Lite Usage: ${String(report.suitableForLiteUsage)}`,
        `- Quality Suitability: ${report.qualitySuitability}`,
        `- Latency Risk: ${report.latencyRisk}`,
        '',
        report.summary,
        '',
        ...(report.comparison
            ? [
                  '## Previous Run Comparison',
                  '',
                  `- Previous Recorded At: ${report.comparison.previousRecordedAt}`,
                  `- Previous Session ID: ${report.comparison.previousSessionId}`,
                  `- Delta Lite Decision Rate: ${report.comparison.deltaLiteDecisionRate}`,
                  `- Delta Lite Pass Rate: ${report.comparison.deltaLitePassRate}`,
                  `- Delta Fallback Rate: ${report.comparison.deltaFallbackRate}`,
                  `- Delta Average Lite Latency (ms): ${report.comparison.deltaAverageLiteDurationMs ?? 'n/a'}`,
                  '',
              ]
            : []),
        ...report.suites.flatMap(suite => [
            `## ${suite.label}`,
            '',
            `- Advisor ID: ${suite.advisorId}`,
            `- Scenario Pass Rate: ${suite.passRate}`,
            `- Lite Decision Rate: ${suite.liteDecisionRate}`,
            `- Lite Pass Rate: ${suite.litePassRate}`,
            `- Fallback Rate: ${suite.fallbackRate}`,
            `- Average Lite Latency (ms): ${suite.timing.averageMs ?? 'n/a'}`,
            `- P95 Lite Latency (ms): ${suite.timing.p95Ms ?? 'n/a'}`,
            `- Max Lite Latency (ms): ${suite.timing.maxMs ?? 'n/a'}`,
            `- Evaluation Status: ${suite.evaluationStatus}`,
            `- Suitability: ${suite.suitability}`,
            `- Latency Risk: ${suite.latencyRisk}`,
            `- Accepted Lite Model: ${String(suite.acceptedLiteModel)}`,
            '',
            suite.summary,
            '',
            '### Scenarios',
            '',
            ...suite.scenarios.map(
                scenario =>
                    `- ${scenario.label ?? scenario.scenarioId}: ${scenario.passed ? 'pass' : 'fail'} (${
                        scenario.source
                    })`,
            ),
            '',
        ]),
    ].join('\n');
}

function buildAdvisorEvaluationComparison(args: {
    currentProvider: string;
    currentLiteModel: string;
    history: Awaited<ReturnType<typeof readPromptLabAdvisorEvaluationHistory>>;
}): {
    previousEntry?: (typeof args.history)[number];
    comparison?: AdvisorEvaluationReport['comparison'];
} {
    const previous = args.history.find(
        entry => entry.provider === args.currentProvider && entry.liteModel === args.currentLiteModel,
    );
    if (!previous) {
        return {};
    }

    return {
        previousEntry: previous,
        comparison: {
            previousRecordedAt: previous.recordedAt,
            previousSessionId: previous.sessionId,
            deltaLiteDecisionRate: 0,
            deltaLitePassRate: 0,
            deltaFallbackRate: 0,
            deltaAverageLiteDurationMs: 0,
        },
    };
}

function looksCodeLikeCodexPrompt(prompt: string): boolean {
    return [
        /```/,
        /^\s*function\s+\w+/m,
        /^\s*(const|let|var)\s+\w+\s*=/m,
        /^\s*def\s+\w+\s*\(/m,
        /^\s*class\s+\w+/m,
        /console\.log\s*\(/,
        /charCodeAt\s*\(/,
        /^\s*\/\/\s*(Input|Output|Requirements?)/m,
        /^\s*#\s*(Input|Output|Requirements?)/m,
        /\breturn\s+\{/,
        /\b(write|implement|create)\s+(a|an)\s+function\b/i,
        /함수(?:를)?\s*(작성|구현|만들)/,
        /코드(?:를)?\s*(작성|구현|생성)/,
        /javascript|typescript|python/i,
    ].some(pattern => pattern.test(prompt));
}

function splitPromptSentences(prompt: string): string[] {
    return prompt
        .split(/(?<=[.!?。다요])\s+|\n+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);
}

function findPrimaryAiNode(result: ProductDesignRunResult) {
    return result.finalFlow?.nodes.find(node => node.blockId === 'ai-generate');
}

function inferJsonOutputContract(result: ProductDesignRunResult, requirement: string, userFeedback: string) {
    const aiNode = findPrimaryAiNode(result);
    const wantsJsonFromText = result.outputContract.format === 'json';
    const jsonOutputEnabled = aiNode?.config?.jsonOutput?.trim().toLowerCase() === 'true';
    const outputSchema = aiNode?.config?.outputSchema?.trim() ?? '';

    if (!wantsJsonFromText && !jsonOutputEnabled && !outputSchema) {
        return undefined;
    }

    const hasConsonantVowelSchema =
        /consonants/i.test(outputSchema) && /vowels/i.test(outputSchema) && /integer/i.test(outputSchema);

    if (hasConsonantVowelSchema) {
        return '출력은 JSON 객체 하나로만 반환하고, 형식은 {"consonants": 정수, "vowels": 정수}이어야 합니다. 설명이나 추가 텍스트는 포함하지 마세요.';
    }

    return '출력은 JSON 객체 하나로만 반환하세요. 설명이나 추가 텍스트는 포함하지 마세요.';
}

export function sanitizeCodexPromptText(
    requirement: string,
    userFeedback: string,
    prompt: string,
    result?: ProductDesignRunResult,
): string {
    const combined = `${requirement}\n${userFeedback}`.toLowerCase();
    const allowsExamples = /예시|\bexample\b|샘플/.test(combined);
    const allowsErrorOutput = /오류|에러|\berror\b|exception/.test(combined);
    const allowsFallbackRules = /fallback|폴백|대체 규칙|예외 처리/.test(combined);

    const filtered = splitPromptSentences(prompt).filter(sentence => {
        const normalized = sentence.toLowerCase();

        if (!allowsExamples && /예시|example|샘플/.test(normalized)) {
            return false;
        }

        if (!allowsErrorOutput && /오류|에러|\berror\b|exception/.test(normalized)) {
            return false;
        }

        if (!allowsFallbackRules && /fallback|폴백|대체 규칙/.test(normalized)) {
            return false;
        }

        if (/codexprompt|usage\s*notes|usagenotes/.test(normalized)) {
            return false;
        }

        if (
            /['"]title['"].*['"]summary['"]|['"]summary['"].*['"]codexprompt['"]|['"]title['"].*['"]usagenotes['"]/i.test(
                normalized,
            )
        ) {
            return false;
        }

        return true;
    });

    let normalized = filtered.join(' ').replace(/\s+/g, ' ').trim() || prompt.trim();
    const jsonContract = result ? inferJsonOutputContract(result, requirement, userFeedback) : undefined;
    const prefersPlainText = result?.outputContract.format === 'plain-text';

    if (jsonContract) {
        const hasJsonContract =
            /json 객체 하나로만 반환|json object only|only json|형식은\s*\{.*consonants.*vowels.*\}/i.test(normalized);
        if (!hasJsonContract) {
            normalized = `${normalized} ${jsonContract}`.trim();
        }
    }

    if (prefersPlainText) {
        normalized = normalized.replace(
            /출력은 자음 개수와 모음 개수를 명확히 구분하여 알려 주세요\.?/g,
            '출력은 간결한 평문으로 반환하세요.',
        );
    }

    return normalized;
}

function localizeAssessmentSummary(language: 'ko' | 'en', summary: string): string {
    if (language !== 'ko') {
        return summary;
    }

    if (summary.startsWith('some capabilities are still missing (')) {
        return summary.replace('some capabilities are still missing', '일부 capability가 아직 부족합니다');
    }

    const mapping: Record<string, string> = {
        'The run did not complete successfully, so the requirement is not yet fulfilled.':
            '실행이 성공적으로 완료되지 않았으므로, 요구사항은 아직 충족되지 않았습니다.',
        'The run completed, but the requirement is still not fulfilled because the run completed but did not produce the requested result.':
            '실행은 완료되었지만, 요청된 결과를 실제로 만들어내지 못해 요구사항은 아직 충족되지 않았습니다.',
        'The run completed, but the requirement is only partially covered because some capabilities are still missing.':
            '실행은 완료되었지만, 일부 capability가 아직 부족하여 요구사항을 부분적으로만 충족합니다.',
        'The run completed successfully, but requirement fulfillment is still uncertain because the design relied on a generic task-graph fallback and the final flow still uses mock execution settings.':
            '실행은 성공적으로 완료되었지만, 일반 task graph fallback과 mock 실행 설정에 의존했기 때문에 요구사항 충족 여부는 아직 불확실합니다.',
        'The run completed successfully, but requirement fulfillment is still uncertain because the design relied on a generic task-graph fallback.':
            '실행은 성공적으로 완료되었지만, 일반 task graph fallback에 의존했기 때문에 요구사항 충족 여부는 아직 불확실합니다.',
        'The run completed successfully, but requirement fulfillment is still uncertain because the final flow still uses mock execution settings.':
            '실행은 성공적으로 완료되었지만, 최종 flow가 아직 mock 실행 설정을 사용하고 있어 요구사항 충족 여부는 아직 불확실합니다.',
        'The run completed successfully, but requirement fulfillment is still uncertain because the requested JSON output contract was not preserved.':
            '실행은 성공적으로 완료되었지만, 요청된 JSON 출력 계약이 최종 flow에서 유지되지 않아 요구사항 충족 여부는 아직 불확실합니다.',
        'The run completed successfully, but requirement fulfillment is still uncertain because structured JSON output still lacks an explicit output schema.':
            '실행은 성공적으로 완료되었지만, 구조화된 JSON 출력에 필요한 명시적 스키마가 아직 없어 요구사항 충족 여부는 아직 불확실합니다.',
        'The run completed successfully, but requirement fulfillment is still uncertain because the flow output format drifted away from the requested plain-text preference.':
            '실행은 성공적으로 완료되었지만, 최종 flow의 출력 형식이 요청된 평문 선호에서 벗어나 요구사항 충족 여부는 아직 불확실합니다.',
        'The run completed successfully, but requirement fulfillment is still uncertain because validation relied on a synthetic sample input (synthetic-graph-json).':
            '실행은 성공적으로 완료되었지만, synthetic graph JSON 샘플 기반으로만 검증되었기 때문에 요구사항 충족 여부는 아직 불확실합니다.',
        'The run completed successfully and the current design appears to fulfill the requirement.':
            '실행은 성공적으로 완료되었고, 현재 설계는 요구사항을 충족하는 것으로 보입니다.',
        'the run did not complete successfully': '실행이 성공적으로 완료되지 않았습니다.',
        'the run completed but did not produce the requested result':
            '실행은 완료되었지만 요청된 결과를 만들어내지 못했습니다.',
        'some capabilities are still missing': '일부 capability가 아직 부족합니다.',
        'the design relied on a generic task-graph fallback': '설계가 일반 task graph fallback에 의존했습니다.',
        'the final flow still uses mock execution settings': '최종 flow가 아직 mock 실행 설정을 사용하고 있습니다.',
        'the requested JSON output contract was not preserved': '요청된 JSON 출력 계약이 유지되지 않았습니다.',
        'structured JSON output still lacks an explicit output schema':
            '구조화된 JSON 출력에 필요한 명시적 스키마가 아직 없습니다.',
        'the flow output format drifted away from the requested plain-text preference':
            '출력 형식이 요청된 평문 선호에서 벗어났습니다.',
        'validation relied on a synthetic sample input (synthetic-graph-json)':
            'synthetic graph JSON 샘플 기반으로만 검증되었습니다.',
    };

    return mapping[summary] ?? summary;
}

function localizeAssessmentCaveat(language: 'ko' | 'en', caveat: string): string {
    if (language !== 'ko') {
        return caveat;
    }

    const mapping: Record<string, string> = {
        'Task-graph classification fell back to a generic template.':
            'Task graph 분류가 generic 템플릿으로 fallback 되었습니다.',
        'The final flow still uses a mock AI model configuration.':
            '최종 플로우가 아직 mock AI 모델 설정을 사용하고 있습니다.',
        'The final flow did not preserve the requested JSON output contract.':
            '최종 flow가 요청된 JSON 출력 계약을 유지하지 못했습니다.',
        'The final flow enables JSON output but does not define an output schema.':
            '최종 flow가 JSON 출력을 사용하지만 출력 스키마를 정의하지 않았습니다.',
        'The final flow switched to JSON output even though the request preferred plain text.':
            '최종 flow가 요청된 평문 선호와 달리 JSON 출력으로 바뀌었습니다.',
        'Validation relied on a synthetic sample input (synthetic-graph-json).':
            '검증이 synthetic graph JSON 샘플 입력에 의존했습니다.',
    };

    return mapping[caveat] ?? caveat;
}

function localizeAssessmentReasonCategory(language: 'ko' | 'en', category: string): string {
    if (language !== 'ko') {
        return category;
    }

    const mapping: Record<string, string> = {
        execution: '실행',
        capability: '기능',
        classification: '분류',
        'output-contract': '출력 계약',
        runtime: '런타임',
        evidence: '검증 근거',
    };

    return mapping[category] ?? category;
}

function dedupeLocalizedAssessmentCaveats(args: {
    language: 'ko' | 'en';
    caveats: string[];
    reasons: Array<{ message: string }>;
}): string[] {
    const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').replace(/[.]/g, '').trim();

    const reasonTexts = new Set(
        args.reasons.map(reason => normalize(localizeAssessmentSummary(args.language, reason.message))),
    );

    return args.caveats.filter(caveat => !reasonTexts.has(normalize(localizeAssessmentCaveat(args.language, caveat))));
}

function renderSummaryMarkdown(args: {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    advisorEvaluation?: AdvisorEvaluationReport;
    executionTiming?: PromptLabExecutionTimingSummary;
    selfReview: PromptLabSelfReview;
    userFeedback: string;
    codexPrompt: PromptLabCodexPrompt;
}): string {
    const isKorean = args.session.config.language === 'ko';
    const sections = isKorean
        ? {
              title: 'Prompt Lab 세션',
              requirement: '요구사항',
              agentResult: '에이전트 결과',
              requirementAssessment: '요구 충족도 평가',
              selfReview: '자가 평가',
              advisorEvaluation: 'Advisor 평가',
              executionTiming: '실행 시간',
              userFeedback: '사용자 피드백',
              finalPromptSummary: '최종 Codex 프롬프트 요약',
              sessionId: '세션 ID',
              skill: '스킬',
              provider: 'Provider',
              mainModel: '메인 모델',
              liteModel: 'Lite 모델',
              language: '언어',
              status: '상태',
              summary: '요약',
              success: '성공',
              executionSucceeded: '실행 성공',
              fulfillmentLevel: '충족도 수준',
              assessmentReasons: '판단 근거',
          }
        : {
              title: 'Prompt Lab Session',
              requirement: 'Requirement',
              agentResult: 'Agent Result',
              requirementAssessment: 'Requirement Assessment',
              selfReview: 'Self Review',
              advisorEvaluation: 'Advisor Evaluation',
              executionTiming: 'Execution Timing',
              userFeedback: 'User Feedback',
              finalPromptSummary: 'Final Codex Prompt Summary',
              sessionId: 'Session ID',
              skill: 'Skill',
              provider: 'Provider',
              mainModel: 'Main Model',
              liteModel: 'Lite Model',
              language: 'Language',
              status: 'Status',
              summary: 'Summary',
              success: 'Success',
              executionSucceeded: 'Execution Succeeded',
              fulfillmentLevel: 'Fulfillment Level',
              assessmentReasons: 'Assessment Signals',
          };
    const fulfillmentLevel = isKorean
        ? {
              fulfilled: '충족',
              uncertain: '불확실',
              partial: '부분 충족',
              'not-fulfilled': '미충족',
          }[args.result.requirementAssessment.fulfillmentLevel] ?? args.result.requirementAssessment.fulfillmentLevel
        : args.result.requirementAssessment.fulfillmentLevel;
    const visibleCaveats = dedupeLocalizedAssessmentCaveats({
        language: args.session.config.language,
        caveats: args.result.requirementAssessment.caveats,
        reasons: args.result.requirementAssessment.reasons,
    });

    return [
        `# ${sections.title}`,
        '',
        `- ${sections.sessionId}: ${args.session.sessionId}`,
        `- ${sections.skill}: ${args.session.config.skillName}`,
        `- ${sections.provider}: ${args.session.config.provider}`,
        `- ${sections.mainModel}: ${args.session.config.mainModel}`,
        `- ${sections.liteModel}: ${args.session.config.liteModel}`,
        `- ${sections.language}: ${args.session.config.language}`,
        '',
        `## ${sections.requirement}`,
        '',
        args.session.requirement,
        '',
        `## ${sections.agentResult}`,
        '',
        `- ${sections.status}: ${args.result.status}`,
        `- ${sections.summary}: ${args.result.summary ?? 'n/a'}`,
        `- ${sections.success}: ${String(args.result.success ?? false)}`,
        '',
        `## ${sections.requirementAssessment}`,
        '',
        `- ${sections.executionSucceeded}: ${String(args.result.requirementAssessment.executionSucceeded)}`,
        `- ${sections.fulfillmentLevel}: ${fulfillmentLevel}`,
        `- ${sections.summary}: ${localizeAssessmentSummary(
            args.session.config.language,
            args.result.requirementAssessment.summary,
        )}`,
        ...(args.result.requirementAssessment.reasons.length > 0
            ? [
                  '',
                  `- ${sections.assessmentReasons}:`,
                  ...args.result.requirementAssessment.reasons.map(
                      item =>
                          `  - [${localizeAssessmentReasonCategory(
                              args.session.config.language,
                              item.category,
                          )}] ${localizeAssessmentSummary(args.session.config.language, item.message)}`,
                  ),
              ]
            : []),
        ...(visibleCaveats.length > 0
            ? [
                  '',
                  ...visibleCaveats.map(item => `- ${localizeAssessmentCaveat(args.session.config.language, item)}`),
                  '',
              ]
            : ['']),
        ...(args.advisorEvaluation
            ? [
                  `## ${sections.advisorEvaluation}`,
                  '',
                  `- ${sections.summary}: ${args.advisorEvaluation.summary}`,
                  `- ${isKorean ? 'Lite 모델 적합' : 'Suitable For Lite Usage'}: ${String(
                      args.advisorEvaluation.suitableForLiteUsage,
                  )}`,
                  `- ${isKorean ? '품질 적합도' : 'Quality Suitability'}: ${args.advisorEvaluation.qualitySuitability}`,
                  `- ${isKorean ? '지연 리스크' : 'Latency Risk'}: ${args.advisorEvaluation.latencyRisk}`,
                  `- ${isKorean ? '전체 시나리오 통과율' : 'Overall Scenario Pass Rate'}: ${
                      args.advisorEvaluation.overallPassRate
                  }`,
                  `- ${isKorean ? 'Lite 직접 판정 비율' : 'Overall Lite Decision Rate'}: ${
                      args.advisorEvaluation.overallLiteDecisionRate
                  }`,
                  `- ${isKorean ? 'Lite 직접 판정 정답률' : 'Overall Lite Pass Rate'}: ${
                      args.advisorEvaluation.overallLitePassRate
                  }`,
                  `- ${isKorean ? '전체 fallback 비율' : 'Overall Fallback Rate'}: ${
                      args.advisorEvaluation.overallFallbackRate
                  }`,
                  `- ${isKorean ? '평균 Lite 응답 시간(ms)' : 'Average Lite Latency (ms)'}: ${
                      args.advisorEvaluation.overallTiming.averageMs ?? 'n/a'
                  }`,
                  `- ${isKorean ? 'P95 Lite 응답 시간(ms)' : 'P95 Lite Latency (ms)'}: ${
                      args.advisorEvaluation.overallTiming.p95Ms ?? 'n/a'
                  }`,
                  `- ${isKorean ? '최대 Lite 응답 시간(ms)' : 'Max Lite Latency (ms)'}: ${
                      args.advisorEvaluation.overallTiming.maxMs ?? 'n/a'
                  }`,
                  ...(args.advisorEvaluation.comparison
                      ? [
                            `- ${isKorean ? '이전 실행 시각' : 'Previous Recorded At'}: ${
                                args.advisorEvaluation.comparison.previousRecordedAt
                            }`,
                            `- ${isKorean ? 'Lite 직접 판정 비율 변화' : 'Delta Lite Decision Rate'}: ${
                                args.advisorEvaluation.comparison.deltaLiteDecisionRate
                            }`,
                            `- ${isKorean ? 'Lite 직접 판정 정답률 변화' : 'Delta Lite Pass Rate'}: ${
                                args.advisorEvaluation.comparison.deltaLitePassRate
                            }`,
                            `- ${isKorean ? 'fallback 비율 변화' : 'Delta Fallback Rate'}: ${
                                args.advisorEvaluation.comparison.deltaFallbackRate
                            }`,
                            `- ${isKorean ? '평균 Lite 응답 시간 변화(ms)' : 'Delta Average Lite Latency (ms)'}: ${
                                args.advisorEvaluation.comparison.deltaAverageLiteDurationMs ?? 'n/a'
                            }`,
                        ]
                      : []),
                  '',
                  ...args.advisorEvaluation.suites.map(
                      suite =>
                          `- ${suite.label}: liteDecisionRate=${suite.liteDecisionRate}, litePassRate=${
                              suite.litePassRate
                          }, fallbackRate=${suite.fallbackRate}, avgLatencyMs=${
                              suite.timing.averageMs ?? 'n/a'
                          }, status=${suite.evaluationStatus}, suitability=${suite.suitability}, latencyRisk=${
                              suite.latencyRisk
                          }`,
                  ),
                  '',
              ]
            : []),
        ...(args.executionTiming
            ? [
                  `## ${sections.executionTiming}`,
                  '',
                  `- ${isKorean ? 'Advisor timing 상태' : 'Advisor Timing Status'}: ${
                      args.executionTiming.advisorTimingStatus
                  }`,
                  `- ${isKorean ? '전체 실행 시간(ms)' : 'Total Run Duration (ms)'}: ${
                      args.executionTiming.totalDurationMs
                  }`,
                  `- ${isKorean ? 'Advisor 호출 수' : 'Advisor Call Count'}: ${args.executionTiming.advisorCallCount}`,
                  `- ${isKorean ? 'Advisor 총 시간(ms)' : 'Advisor Total Duration (ms)'}: ${
                      args.executionTiming.advisorTotalDurationMs
                  }`,
                  `- ${isKorean ? 'Advisor 시간 비중' : 'Advisor Time Share'}: ${
                      args.executionTiming.advisorTimeShare ?? 'not-observed'
                  }`,
                  ...(args.executionTiming.advisorTimingStatus === 'not-observed'
                      ? [
                            `- ${
                                isKorean
                                    ? '이번 실행에서는 advisor timing 이벤트가 관측되지 않았습니다.'
                                    : 'Advisor timing events were not observed during this run.'
                            }`,
                        ]
                      : []),
                  '',
                  ...args.executionTiming.advisors.map(
                      advisor =>
                          `- ${advisor.advisorId}: callCount=${advisor.callCount}, totalDurationMs=${advisor.totalDurationMs}, averageDurationMs=${advisor.averageDurationMs}, maxDurationMs=${advisor.maxDurationMs}`,
                  ),
                  ...args.executionTiming.stages.map(
                      stage =>
                          `- ${isKorean ? '단계' : 'Stage'} ${stage.stageId}: durationMs=${stage.durationMs}`,
                  ),
                  '',
              ]
            : []),
        `## ${sections.selfReview}`,
        '',
        args.selfReview.summary,
        '',
        ...args.selfReview.improvements.map(item => `- ${item}`),
        '',
        `## ${sections.userFeedback}`,
        '',
        args.userFeedback || '(none)',
        '',
        `## ${sections.finalPromptSummary}`,
        '',
        args.codexPrompt.summary,
        '',
    ].join('\n');
}

function buildArtifactPaths(sessionDir: string): PromptLabArtifactPaths {
    return {
        timelinePath: join(sessionDir, 'timeline.ndjson'),
        designPath: join(sessionDir, 'design-events.ndjson'),
        diagnosticsPath: join(sessionDir, 'diagnostics.ndjson'),
        resultPath: join(sessionDir, 'result.json'),
        designedFlowPath: join(sessionDir, 'designed-flow.md'),
        designedFlowYamlPath: join(sessionDir, 'designed-flow.yml'),
        designedFlowGraphPath: join(sessionDir, 'designed-flow.reagraph.html'),
        advisorEvaluationJsonPath: join(sessionDir, 'advisor-evaluation.json'),
        advisorEvaluationMarkdownPath: join(sessionDir, 'advisor-evaluation.md'),
        selfReviewPath: join(sessionDir, 'self-review.json'),
        feedbackPath: join(sessionDir, 'user-feedback.txt'),
        promptJsonPath: join(sessionDir, 'codex-prompt.json'),
        promptMarkdownPath: join(sessionDir, 'codex-prompt.md'),
        summaryPath: join(sessionDir, 'summary.md'),
        executionTimingJsonPath: join(sessionDir, 'execution-timing.json'),
        artifactsPath: join(sessionDir, 'artifacts.json'),
        failureJsonPath: join(sessionDir, 'failure.json'),
        failureTextPath: join(sessionDir, 'failure.txt'),
    };
}

function serializeError(error: unknown): unknown {
    if (!(error instanceof Error)) {
        return {
            message: String(error),
        };
    }

    return {
        name: error.name,
        message: error.message,
        code: error instanceof AgentError ? error.code : undefined,
        stack: error.stack,
        cause: 'cause' in error ? serializeError((error as Error & { cause?: unknown }).cause) : undefined,
    };
}

function formatFailureClipboard(args: {
    session: PromptLabSessionRecord;
    paths: PromptLabArtifactPaths;
    error: unknown;
}): string {
    const message = args.error instanceof Error ? args.error.message : String(args.error);
    const stack = args.error instanceof Error && args.error.stack ? args.error.stack : '(no stack)';
    const causeMessage =
        args.error instanceof Error &&
        'cause' in args.error &&
        (args.error as Error & { cause?: unknown }).cause instanceof Error
            ? (args.error as Error & { cause?: Error }).cause?.message
            : undefined;

    return [
        'PROMPT_LAB_FAILURE',
        `sessionDir=${args.session.sessionDir}`,
        `skill=${args.session.config.skillName}`,
        `provider=${args.session.config.provider}`,
        `mainModel=${args.session.config.mainModel}`,
        `liteModel=${args.session.config.liteModel}`,
        `requirement=${args.session.requirement}`,
        `timeline=${args.paths.timelinePath}`,
        `design=${args.paths.designPath}`,
        `diagnostics=${args.paths.diagnosticsPath}`,
        `failureJson=${args.paths.failureJsonPath}`,
        `failureText=${args.paths.failureTextPath}`,
        `error=${message}`,
        `cause=${causeMessage ?? '(none)'}`,
        'stack<<EOF',
        stack,
        'EOF',
    ].join('\n');
}

export class PromptLabProduct {
    constructor(private readonly options: PromptLabProductOptions = {}) {}

    async runRequirement(args: {
        config: PromptLabSessionConfig;
        requirement: string;
        hooks?: PromptLabEventHooks;
    }): Promise<{
        session: PromptLabSessionRecord;
        result: ProductDesignRunResult;
        gateway: LlmGateway;
    }> {
        const session = await createPromptLabSession(args.config, args.requirement);
        const paths = buildArtifactPaths(session.sessionDir);
        args.hooks?.onSessionPrepared?.({ session, paths });

        let gateway: LlmGateway | undefined;
        let diagnosticListener: DiagnosticListener | undefined;
        const previousRuntimeProvider = process.env.FLOW_RUNTIME_PROVIDER;
        const previousRuntimeMainModel = process.env.FLOW_RUNTIME_MAIN_MODEL;
        const previousRuntimeLiteModel = process.env.FLOW_RUNTIME_LITE_MODEL;
        const skillName = args.config.skillName;

        try {
            if (!skillName) {
                throw new AgentError('Prompt Lab run mode requires a skillName.', {
                    code: 'PROMPT_LAB_SKILL_REQUIRED',
                });
            }
            process.env.FLOW_RUNTIME_PROVIDER = args.config.provider;
            process.env.FLOW_RUNTIME_MAIN_MODEL = args.config.mainModel;
            process.env.FLOW_RUNTIME_LITE_MODEL = args.config.liteModel;
            gateway = createGateway(args.config);
            const product =
                this.options.productFactory?.(gateway) ??
                new FlowDesignProduct({
                    runtimeOptions: {
                        llm: gateway,
                    },
                });

            diagnosticListener = (level, event) => {
                void appendNdjson(paths.diagnosticsPath, { level, event });
                args.hooks?.onDiagnosticEvent?.({ level, event });
            };
            addDiagnosticListener(diagnosticListener);

            const result = await runFlowSkill(product, skillName, args.requirement, {
                onTimelineEvent: event => {
                    void appendNdjson(paths.timelinePath, event);
                    args.hooks?.onTimelineEvent?.(event);
                },
                onDesignEvent: event => {
                    void appendNdjson(paths.designPath, event);
                    args.hooks?.onDesignEvent?.(event);
                },
            });

            await writeJson(paths.resultPath, result);
            await writeText(paths.designedFlowYamlPath, yaml.dump(result.finalFlow ?? null, { noRefs: true }));
            return { session, result, gateway };
        } catch (error) {
            const clipboardText = formatFailureClipboard({ session, paths, error });
            await writeJson(paths.failureJsonPath, {
                error: serializeError(error),
                session,
                paths,
            });
            await writeText(paths.failureTextPath, `${clipboardText}\n`);
            await writeJson(paths.artifactsPath, paths);

            throw new PromptLabRunError('Prompt Lab execution failed.', session, paths, clipboardText, {
                cause: error,
                code: error instanceof AgentError ? error.code : 'PROMPT_LAB_RUN_FAILED',
            });
        } finally {
            if (previousRuntimeProvider === undefined) {
                delete process.env.FLOW_RUNTIME_PROVIDER;
            } else {
                process.env.FLOW_RUNTIME_PROVIDER = previousRuntimeProvider;
            }
            if (previousRuntimeMainModel === undefined) {
                delete process.env.FLOW_RUNTIME_MAIN_MODEL;
            } else {
                process.env.FLOW_RUNTIME_MAIN_MODEL = previousRuntimeMainModel;
            }
            if (previousRuntimeLiteModel === undefined) {
                delete process.env.FLOW_RUNTIME_LITE_MODEL;
            } else {
                process.env.FLOW_RUNTIME_LITE_MODEL = previousRuntimeLiteModel;
            }
            if (diagnosticListener) {
                removeDiagnosticListener(diagnosticListener);
            }
        }
    }

    async createSelfReview(args: {
        session: PromptLabSessionRecord;
        result: ProductDesignRunResult;
        advisorEvaluation?: AdvisorEvaluationReport;
        gateway: LlmGateway;
    }): Promise<PromptLabSelfReview> {
        const selfReview = await args.gateway.generateStructured(
            await buildPromptLabSelfReviewRequest({
                session: args.session,
                result: args.result,
                advisorEvaluation: args.advisorEvaluation,
                language: args.session.config.language,
            }),
        );
        await writeJson(buildArtifactPaths(args.session.sessionDir).selfReviewPath, selfReview);
        return selfReview;
    }

    async evaluateAdvisors(args: {
        session: PromptLabSessionRecord;
        gateway: LlmGateway;
    }): Promise<AdvisorEvaluationReport> {
        const previousHistory = await readPromptLabAdvisorEvaluationHistory(args.session.config);
        const { previousEntry, comparison } = buildAdvisorEvaluationComparison({
            currentProvider: args.session.config.provider,
            currentLiteModel: args.session.config.liteModel,
            history: previousHistory,
        });
        const report = await evaluateFlowDesignAdvisors({
            gateway: args.gateway,
            provider: args.session.config.provider,
            liteModel: args.session.config.liteModel,
            comparison,
        });
        if (report.comparison && previousEntry) {
            report.comparison = {
                ...report.comparison,
                deltaLiteDecisionRate: Number(
                    (report.overallLiteDecisionRate - previousEntry.overallLiteDecisionRate).toFixed(3),
                ),
                deltaLitePassRate: Number((report.overallLitePassRate - previousEntry.overallLitePassRate).toFixed(3)),
                deltaFallbackRate: Number((report.overallFallbackRate - previousEntry.overallFallbackRate).toFixed(3)),
                deltaAverageLiteDurationMs:
                    report.overallTiming.averageMs === null || previousEntry.overallAverageLiteDurationMs === null
                        ? null
                        : Number(
                              (report.overallTiming.averageMs - previousEntry.overallAverageLiteDurationMs).toFixed(3),
                          ),
            };
        }
        const paths = buildArtifactPaths(args.session.sessionDir);
        await writeJson(paths.advisorEvaluationJsonPath, report);
        await writeText(paths.advisorEvaluationMarkdownPath, renderAdvisorEvaluationMarkdown(report));
        await appendPromptLabAdvisorEvaluationHistory({
            config: args.session.config,
            session: args.session,
            report,
        });
        return report;
    }

    async runAdvisorEvaluation(args: { config: PromptLabSessionConfig }): Promise<PromptLabAdvisorEvalArtifacts> {
        const session = await createPromptLabSession(args.config, 'advisor-evaluation');
        const paths = buildArtifactPaths(session.sessionDir);

        try {
            const gateway = createGateway(args.config);
            const advisorEvaluation = await this.evaluateAdvisors({ session, gateway });
            await writeJson(paths.artifactsPath, paths);
            return {
                session,
                advisorEvaluation,
            };
        } catch (error) {
            const clipboardText = formatFailureClipboard({ session, paths, error });
            await writeJson(paths.failureJsonPath, {
                error: serializeError(error),
                session,
                paths,
            });
            await writeText(paths.failureTextPath, `${clipboardText}\n`);
            await writeJson(paths.artifactsPath, paths);
            throw new PromptLabRunError('Prompt Lab advisor evaluation failed.', session, paths, clipboardText, {
                cause: error,
                code: error instanceof AgentError ? error.code : 'PROMPT_LAB_ADVISOR_EVAL_FAILED',
            });
        }
    }

    async finalizeSession(args: {
        session: PromptLabSessionRecord;
        result: ProductDesignRunResult;
        advisorEvaluation?: AdvisorEvaluationReport;
        executionTiming?: PromptLabExecutionTimingSummary;
        selfReview: PromptLabSelfReview;
        userFeedback: string;
        gateway: LlmGateway;
    }): Promise<PromptLabRunArtifacts> {
        const paths = buildArtifactPaths(args.session.sessionDir);
        await writeText(paths.feedbackPath, `${args.userFeedback}\n`);
        if (args.advisorEvaluation) {
            await writeJson(paths.advisorEvaluationJsonPath, args.advisorEvaluation);
            await writeText(
                paths.advisorEvaluationMarkdownPath,
                renderAdvisorEvaluationMarkdown(args.advisorEvaluation),
            );
        }
        if (args.executionTiming) {
            await writeJson(paths.executionTimingJsonPath, args.executionTiming);
        }

        const codexPrompt = await args.gateway.generateStructured(
            await buildPromptLabCodexPromptRequest({
                session: args.session,
                result: args.result,
                advisorEvaluation: args.advisorEvaluation,
                selfReview: args.selfReview,
                userFeedback: args.userFeedback,
                language: args.session.config.language,
            }),
        );
        const rewrittenOrGeneratedCodexPrompt = looksCodeLikeCodexPrompt(codexPrompt.codexPrompt)
            ? await args.gateway.generateStructured(
                  await buildPromptLabCodexPromptRewriteRequest({
                      session: args.session,
                      result: args.result,
                      advisorEvaluation: args.advisorEvaluation,
                      selfReview: args.selfReview,
                      userFeedback: args.userFeedback,
                      language: args.session.config.language,
                      draftPrompt: codexPrompt.codexPrompt,
                  }),
              )
            : codexPrompt;
        const normalizedCodexPrompt = {
            ...rewrittenOrGeneratedCodexPrompt,
            codexPrompt: sanitizeCodexPromptText(
                args.session.requirement,
                args.userFeedback,
                rewrittenOrGeneratedCodexPrompt.codexPrompt,
                args.result,
            ),
        };

        await writeJson(paths.promptJsonPath, normalizedCodexPrompt);
        await writeText(paths.promptMarkdownPath, renderCodexPromptMarkdown(normalizedCodexPrompt));
        await writeText(
            paths.summaryPath,
            renderSummaryMarkdown({
                session: args.session,
                result: args.result,
                advisorEvaluation: args.advisorEvaluation,
                executionTiming: args.executionTiming,
                selfReview: args.selfReview,
                userFeedback: args.userFeedback,
                codexPrompt: normalizedCodexPrompt,
            }),
        );
        await writeJson(paths.artifactsPath, paths);

        return {
            session: args.session,
            result: args.result,
            advisorEvaluation: args.advisorEvaluation,
            executionTiming: args.executionTiming,
            selfReview: args.selfReview,
            userFeedback: args.userFeedback,
            codexPrompt: normalizedCodexPrompt,
        };
    }

    async run(args: {
        config: PromptLabSessionConfig;
        requirement: string;
        userFeedback: string;
        hooks?: PromptLabEventHooks;
    }): Promise<PromptLabRunArtifacts> {
        const { session, result, gateway } = await this.runRequirement(args);
        const selfReview = await this.createSelfReview({ session, result, gateway });
        return await this.finalizeSession({
            session,
            result,
            selfReview,
            userFeedback: args.userFeedback,
            gateway,
        });
    }

    async getDefaults() {
        const manifest = await getPromptLabManifest();
        return manifest.defaults;
    }
}

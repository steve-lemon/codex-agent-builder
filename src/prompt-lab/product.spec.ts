import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { PromptLabProduct, PromptLabRunError, sanitizeCodexPromptText } from './product';

describe('PromptLabProduct', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('runs a prompt-lab session, writes artifacts, and synthesizes a Codex prompt', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-'));
        const product = new PromptLabProduct();

        const artifacts = await product.run({
            config: {
                mode: 'run',
                provider: 'fake',
                mainModel: 'fake-main',
                liteModel: 'fake-lite',
                language: 'ko',
                skillName: 'flow-designer',
                outputRoot,
            },
            requirement: '키워드를 주면 블로그 제목 여러 개를 만들어줘.',
            userFeedback: '결과 수와 품질 기준을 더 분명하게 써줘.',
        });

        expect(artifacts.result.runId).toBeTruthy();
        expect(artifacts.advisorEvaluation).toBeUndefined();
        expect(artifacts.selfReview.improvements.length).toBeGreaterThan(0);
        expect(artifacts.codexPrompt.codexPrompt).toContain('Codex');

        const summary = await readFile(join(artifacts.session.sessionDir, 'summary.md'), 'utf8');
        const promptMarkdown = await readFile(join(artifacts.session.sessionDir, 'codex-prompt.md'), 'utf8');
        const resultJson = JSON.parse(await readFile(join(artifacts.session.sessionDir, 'result.json'), 'utf8'));
        const designedFlowYaml = await readFile(join(artifacts.session.sessionDir, 'designed-flow.yml'), 'utf8');
        const designedFlow = yaml.load(designedFlowYaml) as {
            nodes?: unknown[];
            edges?: unknown[];
            blocks?: unknown[];
        };

        expect(summary).toContain('Prompt Lab 세션');
        expect(summary).toContain('요구 충족도 평가');
        expect(summary).toContain('판단 근거');
        expect(promptMarkdown).toContain('## Prompt');
        expect(resultJson.skillName).toBe('flow-designer');
        expect(resultJson.requirementAssessment).toEqual(
            expect.objectContaining({
                executionSucceeded: true,
                fulfillmentLevel: expect.any(String),
                summary: expect.any(String),
                reasons: expect.any(Array),
            }),
        );
        if (resultJson.requirementAssessment.fulfillmentLevel !== 'fulfilled') {
            expect(resultJson.summary).toContain('Current requirement assessment');
        }
        expect(Array.isArray(designedFlow.nodes)).toBe(true);
        expect(Array.isArray(designedFlow.edges)).toBe(true);
        expect(Array.isArray(designedFlow.blocks)).toBe(true);
    });

    it('writes stage timing details when execution timing is supplied during finalization', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-'));
        const product = new PromptLabProduct();
        const { session, result, gateway } = await product.runRequirement({
            config: {
                mode: 'run',
                provider: 'fake',
                mainModel: 'fake-main',
                liteModel: 'fake-lite',
                language: 'ko',
                skillName: 'flow-designer',
                outputRoot,
            },
            requirement: '키워드를 주면 블로그 제목 여러 개를 만들어줘.',
        });
        const selfReview = await product.createSelfReview({ session, result, gateway });
        const artifacts = await product.finalizeSession({
            session,
            result,
            selfReview,
            userFeedback: '',
            gateway,
            executionTiming: {
                advisorTimingStatus: 'not-observed',
                totalDurationMs: 1234,
                advisorCallCount: 0,
                advisorTotalDurationMs: 0,
                advisorTimeShare: null,
                advisors: [],
                stages: [
                    { stageId: 'agent-run', durationMs: 900 },
                    { stageId: 'self-review', durationMs: 200 },
                    { stageId: 'prompt-finalize', durationMs: 134 },
                ],
            },
        });

        const executionTiming = JSON.parse(
            await readFile(join(artifacts.session.sessionDir, 'execution-timing.json'), 'utf8'),
        );
        expect(Array.isArray(executionTiming.stages)).toBe(true);
        expect(executionTiming.stages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ stageId: 'agent-run' }),
                expect.objectContaining({ stageId: 'self-review' }),
                expect.objectContaining({ stageId: 'prompt-finalize' }),
            ]),
        );
    });

    it('can validate preflight runs through the same prompt-lab workflow', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-'));
        const product = new PromptLabProduct();

        const artifacts = await product.run({
            config: {
                mode: 'run',
                provider: 'fake',
                mainModel: 'fake-main',
                liteModel: 'fake-lite',
                language: 'ko',
                skillName: 'flow-preflight-validator',
                outputRoot,
            },
            requirement: '이메일을 확인해서 답장해줘.',
            userFeedback: '불가능한 capability 설명이 더 직접적이면 좋겠어.',
        });

        expect(artifacts.result.skillName).toBe('flow-preflight-validator');
        expect(artifacts.result.preflightPayload?.feasible).toBe(false);
        expect(artifacts.codexPrompt.codexPrompt).toContain('Codex');
    });

    it('fails early with a clear error when OpenAI is selected without credentials or proxy', async () => {
        vi.stubEnv('OPENAI_API_KEY', '');
        vi.stubEnv('OPENAI_STRUCTURED_PROXY_URL', '');
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-'));
        const product = new PromptLabProduct();

        await expect(
            product.runRequirement({
                config: {
                    mode: 'run',
                    provider: 'openai',
                    mainModel: 'gpt-4.1-mini',
                    liteModel: 'gpt-4.1-mini',
                    language: 'ko',
                    skillName: 'flow-designer',
                    outputRoot,
                },
                requirement: '입력한 텍스트의 오타를 정정해줘',
            }),
        ).rejects.toBeInstanceOf(PromptLabRunError);

        try {
            await product.runRequirement({
                config: {
                    mode: 'run',
                    provider: 'openai',
                    mainModel: 'gpt-4.1-mini',
                    liteModel: 'gpt-4.1-mini',
                    language: 'ko',
                    skillName: 'flow-designer',
                    outputRoot,
                },
                requirement: '입력한 텍스트의 오타를 정정해줘',
            });
        } catch (error) {
            expect(error).toBeInstanceOf(PromptLabRunError);
            const runError = error as PromptLabRunError;
            expect(runError.clipboardText).toContain('PROMPT_LAB_FAILURE');
            expect(runError.paths.failureTextPath).toContain('failure.txt');
            const failureText = await readFile(runError.paths.failureTextPath, 'utf8');
            expect(failureText).toContain('OPENAI_API_KEY');
        }
    });

    it('removes unrequested examples and error-output instructions from the final Codex prompt', () => {
        const sanitized = sanitizeCodexPromptText(
            '자음과 모음의 개수를 분리해서 json으로 출력해',
            '',
            '입력된 한글 문자열에서 자음과 모음의 개수를 각각 계산하세요. 예시 입력과 출력도 포함해 주세요. 오류가 나면 오류 메시지를 JSON으로 반환하세요.',
        );

        expect(sanitized).toContain('입력된 한글 문자열에서 자음과 모음의 개수를 각각 계산하세요.');
        expect(sanitized).not.toContain('예시 입력과 출력');
        expect(sanitized).not.toContain('오류 메시지');
    });

    it('restores a json-only contract when the designed flow expects structured JSON output', () => {
        const sanitized = sanitizeCodexPromptText(
            '자음과 모음의 개수를 분리해서 json으로 출력해',
            '',
            '입력된 한국어 문장에서 각 글자의 자음과 모음을 분리하여 자음의 총 개수와 모음의 총 개수를 계산해 주세요. 출력은 자음 개수와 모음 개수를 명확히 구분하여 알려 주세요.',
            {
                skillName: 'flow-designer',
                runId: 'run_1',
                status: 'completed',
                requirementAssessment: {
                    executionSucceeded: true,
                    fulfillmentLevel: 'uncertain',
                    summary: 'The run completed successfully, but requirement fulfillment is still uncertain.',
                    caveats: [],
                    reasons: [],
                },
                outputContract: {
                    format: 'json',
                    explicitFormat: true,
                    desiredCount: 1,
                    wantsMultiple: false,
                    wantsJson: true,
                },
                nextActions: [],
                flowDesign: {
                    feasible: true,
                    missingCapabilities: [],
                    improvements: [],
                    designPassCount: 0,
                    taskGraphRefinementCount: 0,
                },
                nodeConfiguration: {
                    improvements: [],
                    appliedStrategies: [],
                    nodeStrategyAssignments: [],
                    configuredNodeCount: 0,
                    probeInsightCount: 0,
                },
                trace: [],
                finalFlow: {
                    blocks: [],
                    nodes: [
                        {
                            id: 'ai-node',
                            blockId: 'ai-generate',
                            label: 'AI Generate',
                            config: {
                                jsonOutput: 'true',
                                outputSchema:
                                    'type: object\nproperties:\n  consonants:\n    type: integer\n  vowels:\n    type: integer\nrequired:\n  - consonants\n  - vowels\n',
                            },
                            inputPorts: [],
                            outputPorts: [],
                        },
                    ],
                    edges: [],
                },
            },
        );

        expect(sanitized).toContain('JSON 객체 하나로만 반환');
        expect(sanitized).toContain('{"consonants": 정수, "vowels": 정수}');
        expect(sanitized).toContain('설명이나 추가 텍스트는 포함하지 마세요');
    });

    it('removes leaked prompt-lab wrapper field requirements from the final Codex prompt', () => {
        const sanitized = sanitizeCodexPromptText(
            '그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘',
            '',
            "사용자가 제공한 그래프를 분석해 한국어 마크다운으로 설명하세요. 결과는 반드시 JSON 형식으로, 'title', 'summary', 'codexPrompt', 'usageNotes' 형태로 출력하세요.",
            {
                skillName: 'flow-designer',
                runId: 'run_2',
                status: 'failed',
                requirementAssessment: {
                    executionSucceeded: false,
                    fulfillmentLevel: 'not-fulfilled',
                    summary: 'The run did not complete successfully, so the requirement is not yet fulfilled.',
                    caveats: [],
                    reasons: [],
                },
                outputContract: {
                    format: 'plain-text',
                    explicitFormat: true,
                    desiredCount: 1,
                    wantsMultiple: false,
                    wantsJson: false,
                },
                nextActions: [],
                flowDesign: {
                    feasible: false,
                    missingCapabilities: [],
                    improvements: [],
                    designPassCount: 0,
                    taskGraphRefinementCount: 0,
                },
                nodeConfiguration: {
                    improvements: [],
                    appliedStrategies: [],
                    nodeStrategyAssignments: [],
                    configuredNodeCount: 0,
                    probeInsightCount: 0,
                },
                trace: [],
            },
        );

        expect(sanitized).toContain('한국어 마크다운으로 설명');
        expect(sanitized).not.toContain('codexPrompt');
        expect(sanitized).not.toContain('usageNotes');
        expect(sanitized).not.toContain("'title'");
    });

    it('removes inline graph JSON example scaffolding from the final Codex prompt', () => {
        const sanitized = sanitizeCodexPromptText(
            '그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘',
            '',
            '아래에 그래프 형식의 JSON 데이터가 주어집니다. 결과는 마크다운 형식으로 작성하십시오. { "nodes": [...], "edges": [...] } 위와 같은 그래프 JSON을 보고, 그래프의 목적과 구조를 설명해 주세요.',
            {
                skillName: 'flow-designer',
                runId: 'run_3',
                status: 'completed',
                requirementAssessment: {
                    executionSucceeded: true,
                    fulfillmentLevel: 'uncertain',
                    summary: 'The run completed successfully, but requirement fulfillment is still uncertain.',
                    caveats: [],
                    reasons: [],
                },
                outputContract: {
                    format: 'plain-text',
                    explicitFormat: true,
                    desiredCount: 1,
                    wantsMultiple: false,
                    wantsJson: false,
                },
                nextActions: [],
                flowDesign: {
                    feasible: true,
                    missingCapabilities: [],
                    improvements: [],
                    designPassCount: 0,
                    taskGraphRefinementCount: 0,
                },
                nodeConfiguration: {
                    improvements: [],
                    appliedStrategies: [],
                    nodeStrategyAssignments: [],
                    configuredNodeCount: 0,
                    probeInsightCount: 0,
                },
                trace: [],
            },
        );

        expect(sanitized).not.toContain('{ "nodes": [...], "edges": [...] }');
        expect(sanitized).not.toContain('위와 같은 그래프 JSON');
        expect(sanitized).toContain('그래프 형식의 JSON 데이터');
        expect(sanitized).toContain('마크다운 형식');
    });

    it('can run advisor evaluation as a separate prompt-lab mode', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-'));
        const product = new PromptLabProduct();

        const artifacts = await product.runAdvisorEvaluation({
            config: {
                mode: 'advisor-eval',
                provider: 'fake',
                mainModel: 'fake-main',
                liteModel: 'fake-lite',
                language: 'ko',
                outputRoot,
            },
        });

        expect(artifacts.advisorEvaluation.suiteCount).toBeGreaterThan(0);
        const advisorEvalMarkdown = await readFile(join(artifacts.session.sessionDir, 'advisor-evaluation.md'), 'utf8');
        const advisorEvalJson = JSON.parse(
            await readFile(join(artifacts.session.sessionDir, 'advisor-evaluation.json'), 'utf8'),
        );
        expect(advisorEvalMarkdown).toContain('# Advisor Evaluation');
        expect(advisorEvalJson.suites.length).toBeGreaterThan(0);
        expect(advisorEvalJson.overallTiming).toEqual(
            expect.objectContaining({
                sampleCount: expect.any(Number),
                averageMs: expect.anything(),
                p95Ms: expect.anything(),
                maxMs: expect.anything(),
            }),
        );
        expect(advisorEvalJson).toEqual(
            expect.objectContaining({
                qualitySuitability: expect.any(String),
                latencyRisk: expect.any(String),
            }),
        );
        expect(
            advisorEvalJson.suites.every(
                (suite: { evaluationStatus: string; suitability: string; latencyRisk: string }) =>
                    (suite.evaluationStatus === 'inconclusive' ? suite.suitability === 'inconclusive' : true) &&
                    typeof suite.latencyRisk === 'string',
            ),
        ).toBe(true);
        const historyJson = JSON.parse(await readFile(join(outputRoot, 'advisor-evaluation-history.json'), 'utf8'));
        expect(Array.isArray(historyJson)).toBe(true);
        expect(historyJson[0]).toEqual(
            expect.objectContaining({
                sessionId: artifacts.session.sessionId,
                provider: 'fake',
                liteModel: 'fake-lite',
                overallAverageLiteDurationMs: expect.anything(),
            }),
        );
    });
});

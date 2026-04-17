import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { PromptLabProduct, PromptLabRunError } from './product';

describe('PromptLabProduct', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('runs a prompt-lab session, writes artifacts, and synthesizes a Codex prompt', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-'));
        const product = new PromptLabProduct();

        const artifacts = await product.run({
            config: {
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
        expect(promptMarkdown).toContain('## Prompt');
        expect(resultJson.skillName).toBe('flow-designer');
        expect(resultJson.requirementAssessment).toEqual(
            expect.objectContaining({
                executionSucceeded: true,
                fulfillmentLevel: expect.any(String),
                summary: expect.any(String),
            }),
        );
        if (resultJson.requirementAssessment.fulfillmentLevel !== 'fulfilled') {
            expect(resultJson.summary).toContain('Current requirement assessment');
        }
        expect(Array.isArray(designedFlow.nodes)).toBe(true);
        expect(Array.isArray(designedFlow.edges)).toBe(true);
        expect(Array.isArray(designedFlow.blocks)).toBe(true);
    });

    it('can validate preflight runs through the same prompt-lab workflow', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-'));
        const product = new PromptLabProduct();

        const artifacts = await product.run({
            config: {
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
});

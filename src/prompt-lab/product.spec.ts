import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PromptLabProduct } from './product';

describe('PromptLabProduct', () => {
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

        expect(summary).toContain('Prompt Lab Session');
        expect(promptMarkdown).toContain('## Prompt');
        expect(resultJson.skillName).toBe('flow-designer');
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
});

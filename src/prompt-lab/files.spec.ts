import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cachePromptLabRequirement, createPromptLabSession, readPromptLabLastRun, readPromptLabRequirementHistory } from './files';

describe('prompt-lab requirement history', () => {
    it('stores recent requirements in most-recent-first order', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-history-'));

        await cachePromptLabRequirement({ outputRoot }, '첫 번째 요구사항');
        await cachePromptLabRequirement({ outputRoot }, '두 번째 요구사항');

        const history = await readPromptLabRequirementHistory({ outputRoot });
        expect(history.map(entry => entry.requirement)).toEqual(['두 번째 요구사항', '첫 번째 요구사항']);
    });

    it('deduplicates an existing requirement and moves it to the front', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-history-'));

        await cachePromptLabRequirement({ outputRoot }, '중복 요구사항');
        await cachePromptLabRequirement({ outputRoot }, '다른 요구사항');
        await cachePromptLabRequirement({ outputRoot }, '중복 요구사항');

        const history = await readPromptLabRequirementHistory({ outputRoot });
        expect(history.map(entry => entry.requirement)).toEqual(['중복 요구사항', '다른 요구사항']);

        const raw = JSON.parse(await readFile(join(outputRoot, 'prompt-lab-history.json'), 'utf8')) as Array<{
            requirement: string;
        }>;
        expect(raw).toHaveLength(2);
    });
});

describe('prompt-lab last run cache', () => {
    it('stores and returns the most recent session config and requirement', async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), 'prompt-lab-last-run-'));

        await createPromptLabSession(
            {
                mode: 'run',
                provider: 'openai',
                mainModel: 'gpt-5-mini',
                liteModel: 'gpt-4.1-mini',
                language: 'ko',
                skillName: 'flow-designer',
                outputRoot,
            },
            '그래프 json 설명',
        );

        const lastRun = await readPromptLabLastRun({ outputRoot });
        expect(lastRun?.requirement).toBe('그래프 json 설명');
        expect(lastRun?.config.mode).toBe('run');
        expect(lastRun?.config.provider).toBe('openai');
        expect(lastRun?.config.skillName).toBe('flow-designer');
    });
});

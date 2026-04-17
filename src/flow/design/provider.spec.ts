// Vitest specs for the flow-design provider boundary.
import { describe, expect, it } from 'vitest';
import { defaultFlowDesignProvider } from './provider';

describe('flow-design provider', () => {
    it('uses the deterministic provider by default for analyze/compose/reflect', async () => {
        const intent = await defaultFlowDesignProvider.analyzeRequest('블로그 타이틀 여러개 만들어줘');
        const draft = await defaultFlowDesignProvider.composeDraft({
            userRequest: '블로그 타이틀 여러개 만들어줘',
            sampleInput: intent.sampleInput,
            desiredCount: intent.desiredCount,
            wantsJson: intent.wantsJson,
        });
        const reflection = await defaultFlowDesignProvider.reflectExecution({
            userRequest: '블로그 타이틀 여러개 만들어줘',
            desiredCount: intent.desiredCount,
            wantsJson: intent.wantsJson,
            sampleResult: {
                status: 'completed',
                output: '원격 근무 블로그 타이틀 1\n원격 근무 블로그 타이틀 2\n원격 근무 블로그 타이틀 3\n원격 근무 블로그 타이틀 4\n원격 근무 블로그 타이틀 5',
                logs: [],
            },
        });

        expect(intent.taskType).toBe('blog-title-generation');
        expect(draft.flow.nodes).toHaveLength(4);
        expect(reflection.satisfied).toBe(true);
    });
});

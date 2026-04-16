// Deterministic mock helpers used by flow design wrappers and tests.
import type { FlowDesignAiGenerateRequest } from './types';

/** Default sample inputs used when probing the built-in AI block behavior. */
export const defaultFlowDesignProbeSampleInputs = {
    system: 'You generate clear and catchy blog titles based on one keyword.',
    prompt: 'User request: sample. Sample input: 샘플 입력. Return one result. Return plain text.',
} as const;

/** Default deterministic text/JSON generator used by flow-design example execution. */
export async function defaultMockFlowDesignGenerate(request: FlowDesignAiGenerateRequest): Promise<unknown> {
    const countMatch = request.prompt.match(/exactly\s+(\d+)\s+results?/i);
    const count = countMatch ? Number(countMatch[1]) : 1;
    const sampleInputMatch = request.prompt.match(/Sample input:\s*([^.]+)\./i);
    const sampleInput = sampleInputMatch?.[1]?.trim() ?? '샘플 입력';

    if (request.jsonOutput) {
        return {
            model: request.model,
            items: Array.from({ length: Math.max(1, count) }, (_, index) => `${sampleInput} 아이디어 ${index + 1}`),
        };
    }

    return Array.from({ length: Math.max(1, count) }, (_, index) => `${sampleInput} 블로그 타이틀 ${index + 1}`).join(
        '\n',
    );
}

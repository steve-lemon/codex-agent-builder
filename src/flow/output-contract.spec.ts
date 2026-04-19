import { describe, expect, it } from 'vitest';
import {
    LlmBackedFlowOutputContractAdvisor,
    inferFlowOutputContract,
    inferFlowOutputContractWithAdvisor,
} from './output-contract';
import { normalizeFlowRequest } from './design/core';

describe('flow output contract inference', () => {
    it('treats json mentions as input-only when the request asks for a markdown explanation', () => {
        expect(inferFlowOutputContract('그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘')).toEqual({
            format: 'markdown',
            explicitFormat: true,
            desiredCount: 1,
            wantsMultiple: false,
            wantsJson: false,
        });
    });

    it('uses a model-backed advisor result when one is supplied', async () => {
        const advisor = new LlmBackedFlowOutputContractAdvisor({
            plan: async () => {
                throw new Error('not used');
            },
            reflect: async () => {
                throw new Error('not used');
            },
            finalize: async () => {
                throw new Error('not used');
            },
            generateStructured: async () =>
                ({
                    format: 'json',
                    explicitFormat: true,
                    desiredCount: 3,
                    confidence: 0.91,
                }) as any,
        });

        const contract = await inferFlowOutputContractWithAdvisor({
            userRequest: '블로그 내용을 3줄 json으로 요약해줘',
            advisor,
        });

        expect(contract).toEqual({
            format: 'json',
            explicitFormat: true,
            desiredCount: 3,
            wantsMultiple: true,
            wantsJson: true,
        });
    });

    it('lets normalizeFlowRequest consume a model-backed output contract advisor', async () => {
        const normalized = await normalizeFlowRequest('블로그 내용을 3줄로 요약해줘', {
            outputContractAdvisor: new LlmBackedFlowOutputContractAdvisor({
                plan: async () => {
                    throw new Error('not used');
                },
                reflect: async () => {
                    throw new Error('not used');
                },
                finalize: async () => {
                    throw new Error('not used');
                },
                generateStructured: async () =>
                    ({
                        format: 'plain-text',
                        explicitFormat: true,
                        desiredCount: 3,
                        confidence: 0.88,
                    }) as any,
            }),
        });

        expect(normalized.outputContract).toEqual({
            format: 'plain-text',
            explicitFormat: true,
            desiredCount: 3,
            wantsMultiple: true,
            wantsJson: false,
        });
        expect(normalized.desiredCount).toBe(3);
        expect(normalized.wantsMultiple).toBe(true);
    });

    it('reuses the inferred output contract for repeated calls with the same request', async () => {
        let callCount = 0;
        const advisor = new LlmBackedFlowOutputContractAdvisor({
            plan: async () => {
                throw new Error('not used');
            },
            reflect: async () => {
                throw new Error('not used');
            },
            finalize: async () => {
                throw new Error('not used');
            },
            generateStructured: async () => {
                callCount += 1;
                return {
                    format: 'plain-text',
                    explicitFormat: true,
                    desiredCount: 3,
                    confidence: 0.88,
                } as any;
            },
        });

        await inferFlowOutputContractWithAdvisor({
            userRequest: '블로그 내용을 줄테니 이걸 3줄로 요약해줘',
            advisor,
        });
        await inferFlowOutputContractWithAdvisor({
            userRequest: '블로그 내용을 줄테니 이걸 3줄로 요약해줘',
            advisor,
        });

        expect(callCount).toBe(1);
    });
});

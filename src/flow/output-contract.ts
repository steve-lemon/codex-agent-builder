// Shared inference helpers for output shape/format expectations across flow layers.
import { z } from 'zod';
import type { LlmGateway } from '../llm/types';
import { defineStructuredSchema } from '../llm/structured-schema';
import { runLiteAdvisor } from '../advisors/lite';
import { getLiteAdvisorDefinition } from '../advisors/resources';

export type FlowOutputFormat = 'json' | 'plain-text' | 'markdown' | 'unspecified';

export interface FlowOutputContract {
    format: FlowOutputFormat;
    explicitFormat: boolean;
    desiredCount: number;
    wantsMultiple: boolean;
    wantsJson: boolean;
}

export interface FlowOutputContractRecommendation extends FlowOutputContract {
    confidence?: number;
    rationale?: string;
    source: 'deterministic' | 'model';
}

export interface FlowOutputContractAdvisor {
    recommend(args: { userRequest: string }): Promise<FlowOutputContractRecommendation>;
}

const outputContractRecommendationCache = new Map<string, Promise<FlowOutputContractRecommendation>>();

const OUTPUT_CUE_PATTERNS = [
    /출력/,
    /반환/,
    /응답/,
    /보여/,
    /정리/,
    /작성/,
    /설명/,
    /써줘/,
    /만들어/,
    /render/,
    /write/,
    /return/,
    /respond/,
    /explain/,
    /describe/,
    /format/,
];

const INPUT_CUE_PATTERNS = [
    /입력/,
    /주어/,
    /제공/,
    /받아/,
    /읽/,
    /보고/,
    /파싱/,
    /해석/,
    /분석/,
    /read/,
    /input/,
    /given/,
    /provided/,
    /parse/,
];

function includesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
}

function inferMentionStrength(args: { lowered: string; formatPatterns: RegExp[] }): {
    output: boolean;
    input: boolean;
} {
    const segments = args.lowered.split(/[,.!?()\n]/).map(segment => segment.trim());
    let output = false;
    let input = false;

    for (const segment of segments) {
        if (!segment || !includesAny(segment, args.formatPatterns)) {
            continue;
        }
        if (includesAny(segment, OUTPUT_CUE_PATTERNS)) {
            output = true;
        }
        if (includesAny(segment, INPUT_CUE_PATTERNS)) {
            input = true;
        }
    }

    return { output, input };
}

/** Parses repeated-output intent from a natural-language request. */
export function parseDesiredCount(userRequest: string): number {
    const digitMatch = userRequest.match(/(\d+)/);
    if (digitMatch) {
        const parsed = Number(digitMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    const lowered = userRequest.toLowerCase();
    if (
        lowered.includes('여러') ||
        lowered.includes('several') ||
        lowered.includes('multiple') ||
        lowered.includes('many') ||
        lowered.includes('ideas') ||
        lowered.includes('titles')
    ) {
        return 5;
    }

    return 1;
}

/** Infers the output contract the user appears to want without forcing extra formatting by default. */
export function inferFlowOutputContract(userRequest: string): FlowOutputContract {
    const lowered = userRequest.toLowerCase();
    const desiredCount = parseDesiredCount(userRequest);

    const jsonMention = inferMentionStrength({
        lowered,
        formatPatterns: [/json/, /structured/, /구조화/, /객체/, /스키마/, /schema/],
    });
    const plainTextMention = inferMentionStrength({
        lowered,
        formatPatterns: [/plain text/, /plain-text/, /평문/, /텍스트로만/, /문장으로/, /자연어로/],
    });
    const markdownMention = inferMentionStrength({
        lowered,
        formatPatterns: [/\bmarkdown\b/, /\bmd\b/, /마크다운/],
    });

    const wantsJson =
        jsonMention.output ||
        (!jsonMention.input &&
            (lowered.includes('json만') ||
                lowered.includes('json으로만') ||
                lowered.includes('json object') ||
                lowered.includes('json 객체')));

    const wantsMarkdown =
        markdownMention.output ||
        (!markdownMention.input &&
            (lowered.includes('markdown') || lowered.includes('(md)') || lowered.includes('마크다운')));

    const wantsPlainText =
        plainTextMention.output ||
        (!plainTextMention.input &&
            (lowered.includes('plain text') ||
                lowered.includes('plain-text') ||
                lowered.includes('평문') ||
                lowered.includes('텍스트로만') ||
                lowered.includes('문장으로') ||
                lowered.includes('자연어로')));

    const format: FlowOutputFormat = wantsJson
        ? 'json'
        : wantsMarkdown
        ? 'markdown'
        : wantsPlainText
        ? 'plain-text'
        : 'unspecified';

    return {
        format,
        explicitFormat: format !== 'unspecified',
        desiredCount,
        wantsMultiple: desiredCount > 1,
        wantsJson: format === 'json',
    };
}

function createFlowOutputContractClassificationSchema(includeRationale: boolean) {
    return z.object({
        format: z.enum(['json', 'plain-text', 'markdown', 'unspecified']),
        explicitFormat: z.boolean(),
        desiredCount: z.number().int().positive(),
        confidence: z.number().min(0).max(1).optional(),
        ...(includeRationale ? { rationale: z.string() } : {}),
    });
}

function clampDesiredCount(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return 1;
    }
    return Math.max(1, Math.min(20, Math.trunc(value)));
}

function buildRecommendation(
    contract: FlowOutputContract,
    extras: Partial<Pick<FlowOutputContractRecommendation, 'confidence' | 'rationale'>> & {
        source: FlowOutputContractRecommendation['source'];
    },
): FlowOutputContractRecommendation {
    return {
        ...contract,
        confidence: extras.confidence,
        rationale: extras.rationale,
        source: extras.source,
    };
}

export class DeterministicFlowOutputContractAdvisor implements FlowOutputContractAdvisor {
    async recommend(args: { userRequest: string }): Promise<FlowOutputContractRecommendation> {
        return buildRecommendation(inferFlowOutputContract(args.userRequest), {
            confidence: 0.6,
            rationale: 'Used deterministic output-contract heuristics.',
            source: 'deterministic',
        });
    }
}

export class LlmBackedFlowOutputContractAdvisor implements FlowOutputContractAdvisor {
    constructor(
        private readonly gateway: LlmGateway,
        private readonly fallback: FlowOutputContractAdvisor = new DeterministicFlowOutputContractAdvisor(),
        private readonly options: {
            emitLogs?: boolean;
            onDecision?: (event: {
                type: 'model' | 'fallback-no-gateway' | 'fallback-threshold' | 'fallback-error';
                error?: unknown;
                durationMs?: number;
            }) => void;
        } = {},
    ) {}

    async recommend(args: { userRequest: string }): Promise<FlowOutputContractRecommendation> {
        const advisor = await getLiteAdvisorDefinition('flow-design.advisors', 'flow-design.output-contract');
        const includeRationale = advisor.includeRationale === true;
        return await runLiteAdvisor({
            advisorId: advisor.id,
            scope: 'flow-design',
            gateway: this.gateway,
            systemPrompt: advisor.systemPrompt,
            fallbackNote: advisor.fallbackNote,
            schema: defineStructuredSchema(
                'flow_output_contract_classification',
                createFlowOutputContractClassificationSchema(includeRationale),
            ),
            input: {
                userRequest: args.userRequest,
                deterministicHint: inferFlowOutputContract(args.userRequest),
            },
            emitLogs: this.options.emitLogs,
            onDecision: this.options.onDecision,
            shouldFallback: result =>
                typeof advisor.confidenceThreshold === 'number' &&
                typeof result.confidence === 'number' &&
                result.confidence < advisor.confidenceThreshold,
            mapResult: result => {
                const desiredCount = clampDesiredCount(result.desiredCount);
                const format = result.format;
                return {
                    format,
                    explicitFormat: result.explicitFormat || format !== 'unspecified',
                    desiredCount,
                    wantsMultiple: desiredCount > 1,
                    wantsJson: format === 'json',
                    confidence: result.confidence ?? 0.7,
                    rationale: typeof result.rationale === 'string' ? result.rationale : undefined,
                    source: 'model',
                };
            },
            fallback: () => this.fallback.recommend(args),
        });
    }
}

export function createFlowOutputContractAdvisor(gateway?: LlmGateway): FlowOutputContractAdvisor {
    if (!gateway) {
        return defaultFlowOutputContractAdvisor;
    }
    return new LlmBackedFlowOutputContractAdvisor(gateway, defaultFlowOutputContractAdvisor);
}

export async function inferFlowOutputContractWithAdvisor(args: {
    userRequest: string;
    advisor?: FlowOutputContractAdvisor;
}): Promise<FlowOutputContract> {
    const cacheKey = args.userRequest.trim();
    const cachedRecommendation =
        outputContractRecommendationCache.get(cacheKey) ??
        Promise.resolve((args.advisor ?? defaultFlowOutputContractAdvisor).recommend({ userRequest: args.userRequest }));
    outputContractRecommendationCache.set(cacheKey, cachedRecommendation);
    const recommendation = await cachedRecommendation;
    return {
        format: recommendation.format,
        explicitFormat: recommendation.explicitFormat,
        desiredCount: recommendation.desiredCount,
        wantsMultiple: recommendation.wantsMultiple,
        wantsJson: recommendation.wantsJson,
    };
}

export const defaultFlowOutputContractAdvisor = new DeterministicFlowOutputContractAdvisor();

/** Produces a minimal output-format instruction only when the request makes one necessary or explicit. */
export function buildFlowOutputFormatInstruction(contract: FlowOutputContract): string {
    if (contract.format === 'json') {
        return 'Return JSON only.';
    }
    if (contract.format === 'markdown') {
        return 'Return markdown only.';
    }
    if (contract.format === 'plain-text') {
        return 'Return plain text only.';
    }
    return '';
}

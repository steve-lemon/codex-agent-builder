// Shared inference helpers for output shape/format expectations across flow layers.

export type FlowOutputFormat = 'json' | 'plain-text' | 'unspecified';

export interface FlowOutputContract {
    format: FlowOutputFormat;
    explicitFormat: boolean;
    desiredCount: number;
    wantsMultiple: boolean;
    wantsJson: boolean;
}

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

    const wantsPlainText =
        plainTextMention.output ||
        markdownMention.output ||
        (!plainTextMention.input &&
            (lowered.includes('plain text') ||
                lowered.includes('plain-text') ||
                lowered.includes('평문') ||
                lowered.includes('텍스트로만') ||
                lowered.includes('문장으로') ||
                lowered.includes('자연어로'))) ||
        (!markdownMention.input &&
            (lowered.includes('markdown') || lowered.includes('(md)') || lowered.includes('마크다운')));

    const format: FlowOutputFormat = wantsJson ? 'json' : wantsPlainText ? 'plain-text' : 'unspecified';

    return {
        format,
        explicitFormat: format !== 'unspecified',
        desiredCount,
        wantsMultiple: desiredCount > 1,
        wantsJson: format === 'json',
    };
}

/** Produces a minimal output-format instruction only when the request makes one necessary or explicit. */
export function buildFlowOutputFormatInstruction(contract: FlowOutputContract): string {
    if (contract.format === 'json') {
        return 'Return JSON only.';
    }
    if (contract.format === 'plain-text') {
        return 'Return plain text only.';
    }
    return '';
}

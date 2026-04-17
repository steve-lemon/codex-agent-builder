// Shared inference helpers for output shape/format expectations across flow layers.

export type FlowOutputFormat = 'json' | 'plain-text' | 'unspecified';

export interface FlowOutputContract {
    format: FlowOutputFormat;
    explicitFormat: boolean;
    desiredCount: number;
    wantsMultiple: boolean;
    wantsJson: boolean;
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

    const wantsJson =
        lowered.includes('json') ||
        lowered.includes('structured') ||
        lowered.includes('구조화') ||
        lowered.includes('객체') ||
        lowered.includes('스키마') ||
        lowered.includes('schema');

    const wantsPlainText =
        lowered.includes('plain text') ||
        lowered.includes('plain-text') ||
        lowered.includes('평문') ||
        lowered.includes('텍스트로만') ||
        lowered.includes('문장으로') ||
        lowered.includes('자연어로');

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

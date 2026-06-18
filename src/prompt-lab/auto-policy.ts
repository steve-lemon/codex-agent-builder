import { loadResource } from '../resources/loader';
import type { ProductDesignRunResult } from '../product/types';
import type { PromptLabAutoPolicyRecord } from './auto-policy-schemas';

let policyPromise: Promise<PromptLabAutoPolicyRecord> | undefined;

export async function getPromptLabAutoPolicy(): Promise<PromptLabAutoPolicyRecord> {
    policyPromise ??= loadResource('prompt-lab.auto-policy');
    return await policyPromise;
}

export interface PromptLabAutoPolicyDecision {
    stopMatches: string[];
    warnMatches: string[];
    shouldStop: boolean;
}

function evaluateSignal(args: {
    labelPrefix: string;
    signal: PromptLabAutoPolicyRecord['auto']['stop'];
    result: ProductDesignRunResult;
    synthesizedDesignSnapshot: boolean;
}): string[] {
    const matches: string[] = [];

    if (args.signal.runStatuses.includes(args.result.status)) {
        matches.push(`${args.labelPrefix}:run-status=${args.result.status}`);
    }

    if (args.signal.fulfillmentLevels.includes(args.result.requirementAssessment.fulfillmentLevel)) {
        matches.push(`${args.labelPrefix}:fulfillment=${args.result.requirementAssessment.fulfillmentLevel}`);
    }

    const reasonCodes = new Set(args.result.requirementAssessment.reasons.map(reason => reason.code));
    for (const reasonCode of args.signal.reasonCodes) {
        if (reasonCodes.has(reasonCode)) {
            matches.push(`${args.labelPrefix}:reason=${reasonCode}`);
        }
    }

    if (args.signal.synthesizedDesignSnapshot && args.synthesizedDesignSnapshot) {
        matches.push(`${args.labelPrefix}:synthesized-design-snapshot`);
    }

    return matches;
}

export function evaluatePromptLabAutoPolicy(args: {
    policy: PromptLabAutoPolicyRecord;
    result: ProductDesignRunResult;
    synthesizedDesignSnapshot: boolean;
}): PromptLabAutoPolicyDecision {
    const stopMatches = evaluateSignal({
        labelPrefix: 'stop',
        signal: args.policy.auto.stop,
        result: args.result,
        synthesizedDesignSnapshot: args.synthesizedDesignSnapshot,
    });
    const warnMatches = evaluateSignal({
        labelPrefix: 'warn',
        signal: args.policy.auto.warn,
        result: args.result,
        synthesizedDesignSnapshot: args.synthesizedDesignSnapshot,
    });

    return {
        stopMatches,
        warnMatches,
        shouldStop: stopMatches.length > 0,
    };
}
